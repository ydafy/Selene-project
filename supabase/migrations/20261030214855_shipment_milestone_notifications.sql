-- ============================================================================
-- shipment.in_transit and shipment.delivered: buyer notices for the shipment
-- milestones (expo-push-notifications T4, S4).
--
-- Why: the buyer learned that a shipment left or arrived only by opening the
-- order. The two producers that move a shipment to shipped or delivered now
-- write a typed notice to the buyer of the order, in the same transaction and
-- only on the branch that moves the status:
--   fn_record_tracking_event    preparing -> shipped    shipment.in_transit
--                               shipped -> delivered    shipment.delivered
--   fn_mark_shipment_delivered  shipped or preparing -> delivered
--                                                       shipment.delivered
-- A replayed carrier event, a return (dispute) event, a scan after a
-- cancellation refund started and a cancelled shipment write no notice. The
-- source_event_key is '<kind>:<shipment_id>', so both delivered paths write at
-- most one notice per shipment. The seller gets no notice: the seller already
-- drives these steps (label, handover). Both kinds are pushed to the buyer on
-- the orders channel (L4).
--
-- Catalogue: the remote project is shared by all branches, so the list keeps
-- every kind allowed there (read through the Supabase MCP on 2026-10-30).
-- Never drop a kind when adding one.
--
-- Grant review (AGENTS.md):
-- * fn_notify_shipment_milestone is SECURITY DEFINER because it reads the order
--   of any shipment and writes a notice for another user. Only the two
--   SECURITY DEFINER producers below call it, so EXECUTE is revoked from
--   PUBLIC, anon, authenticated and service_role (which Supabase's default
--   privileges would grant) and granted to no role; no client may fabricate
--   a notice.
-- * fn_record_tracking_event and fn_mark_shipment_delivered keep their
--   signatures and their service-only grants, restated below.
--
-- Canonical definitions: supabase/queries/shipments/fn_notify_shipment_milestone.sql,
-- supabase/queries/tracking/fn_record_tracking_event.sql and
-- supabase/queries/shipments/fn_mark_shipment_delivered.sql
-- ============================================================================
BEGIN;

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_event_kind_catalogue_chk,
  ADD CONSTRAINT notifications_event_kind_catalogue_chk
    CHECK (event_kind IS NULL OR event_kind IN (
      'order.payment_confirmed',
      'shipment.cancelled',
      'shipment.refund_failed',
      'dispute.opened',
      'dispute.verdict',
      'product.approved',
      'product.approved_with_note',
      'product.rejected',
      'return.seller_evidence_submitted',
      'return.delivered',
      'product.available',
      'product.interest',
      'shipment.in_transit',
      'shipment.delivered'
    ));

CREATE OR REPLACE FUNCTION public.fn_notify_shipment_milestone(p_shipment_id uuid, p_event_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order_id uuid;
  v_buyer_id uuid;
BEGIN
  IF p_event_kind IS NULL OR p_event_kind NOT IN ('shipment.in_transit', 'shipment.delivered') THEN
    RAISE EXCEPTION 'INVALID_SHIPMENT_MILESTONE';
  END IF;

  SELECT s.order_id, o.buyer_id INTO v_order_id, v_buyer_id
  FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.id = p_shipment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;

  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    type, title, message, action_path
  ) VALUES (
    v_buyer_id,
    p_event_kind,
    p_event_kind || ':' || p_shipment_id::text,
    jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id,
                       'recipient_role', 'buyer'),
    CASE WHEN p_event_kind = 'shipment.in_transit' THEN 'info' ELSE 'success' END,
    CASE WHEN p_event_kind = 'shipment.in_transit' THEN 'Tu envío va en camino'
         ELSE 'Tu envío fue entregado' END,
    CASE WHEN p_event_kind = 'shipment.in_transit'
         THEN 'La paquetería ya lleva un envío de tu pedido. Puedes seguirlo desde tu pedido.'
         ELSE 'Revisa tus productos. Tienes 48 horas desde la entrega para reportar un problema.' END,
    '/profile/orders/' || v_order_id::text
  )
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notify_shipment_milestone(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_record_tracking_event(p_shipment_id uuid, p_dispute_id uuid, p_event_type public.shipment_tracking_event_type, p_event_at timestamp with time zone, p_raw_status text, p_location text, p_status_description text, p_carrier_name text, p_webhook_delivery_id uuid, p_polling_run_id uuid, p_transition public.order_status_enum)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_status public.order_status_enum;
  v_event_id UUID;
  v_refund_started BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT status INTO v_status FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;

  -- A started cancellation operation means a refund was requested: the shipment must end
  -- cancelled, so no scan moves its status. Same predicate as fn_begin_shipment_transfer,
  -- read after the shipment lock.
  SELECT EXISTS (
    SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id AND external_started_at IS NOT NULL
  ) INTO v_refund_started;

  INSERT INTO public.shipment_tracking_events (
    shipment_id,
    dispute_id,
    event_type,
    event_at,
    raw_status,
    location,
    status_description,
    carrier_name,
    webhook_delivery_id,
    polling_run_id
  ) VALUES (
    p_shipment_id,
    p_dispute_id,
    p_event_type,
    p_event_at,
    p_raw_status,
    p_location,
    p_status_description,
    p_carrier_name,
    p_webhook_delivery_id,
    p_polling_run_id
  ) ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'shipment_status', v_status);
  END IF;

  IF p_dispute_id IS NULL AND v_refund_started THEN
    -- No status change. The first scan that would have moved the shipment is recorded once on
    -- the operation so an admin can review the package that moved.
    IF v_status IN ('preparing', 'shipped') AND p_transition IN ('shipped', 'delivered') THEN
      UPDATE public.shipment_cancellation_operations
      SET late_carrier_activity_at = clock_timestamp(),
          late_carrier_activity_event_type = p_event_type
      WHERE shipment_id = p_shipment_id AND late_carrier_activity_at IS NULL;
    END IF;
  ELSIF p_dispute_id IS NULL AND v_status = 'preparing' AND p_transition = 'shipped' THEN
    UPDATE public.shipments
    SET status = 'shipped', shipped_at = p_event_at, updated_at = now()
    WHERE id = p_shipment_id;
    v_status := 'shipped';
    PERFORM public.fn_notify_shipment_milestone(p_shipment_id, 'shipment.in_transit');
  ELSIF p_dispute_id IS NULL AND v_status = 'shipped' AND p_transition = 'delivered' THEN
    UPDATE public.shipments
    SET status = 'delivered', delivered_at = p_event_at, updated_at = now()
    WHERE id = p_shipment_id;
    v_status := 'delivered';
    PERFORM public.fn_notify_shipment_milestone(p_shipment_id, 'shipment.delivered');
  ELSIF v_status = 'cancelled' THEN
    NULL;
  END IF;

  RETURN jsonb_build_object('inserted', true, 'event_id', v_event_id, 'shipment_status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_tracking_event(uuid, uuid, public.shipment_tracking_event_type, timestamp with time zone, text, text, text, text, uuid, uuid, public.order_status_enum) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_tracking_event(uuid, uuid, public.shipment_tracking_event_type, timestamp with time zone, text, text, text, text, uuid, uuid, public.order_status_enum) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_mark_shipment_delivered(p_shipment_id uuid)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  -- 1. Validar shipment y aplicar Bloqueo Pesimista (FOR UPDATE)
  -- Esto evita condiciones de carrera si el comprador confirma manualmente al mismo milisegundo que corre el cron.
  SELECT status::TEXT INTO v_current_status
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE; -- ← FIX CRÍTICO: Previene la sobreescritura destructiva de estados

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 1b. Un reembolso de cancelación ya iniciado: la cancelación debe terminar, el envío no avanza.
  -- Mismo predicado que fn_begin_shipment_transfer, leído tras el bloqueo del envío.
  IF EXISTS (
    SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id AND external_started_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'::TEXT; RETURN;
  END IF;

  -- 2. Solo avanzar si está en tránsito (o empaque si se saltó el scan de tránsito)
  IF v_current_status NOT IN ('shipped', 'preparing') THEN
    RETURN QUERY SELECT false, format('INVALID_SHIPMENT_STATUS: %s', v_current_status); RETURN;
  END IF;

  -- 3. Marcar como entregado — SOLO inicia el reloj de 48h, NO libera fondos
  UPDATE public.shipments
  SET status = 'delivered',
      delivered_at = now(),
      updated_at = now()
  WHERE id = p_shipment_id;

  -- 4. Buyer notice, once per shipment (the carrier delivered scan writes the same key).
  PERFORM public.fn_notify_shipment_milestone(p_shipment_id, 'shipment.delivered');

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_mark_shipment_delivered',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_mark_shipment_delivered(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mark_shipment_delivered(uuid) TO service_role;

INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES
  ('shipment.in_transit', 'buyer', 'orders'),
  ('shipment.delivered', 'buyer', 'orders');

COMMIT;
