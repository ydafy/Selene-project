-- B5.8 (S8): carrier activity after a cancellation refund has started must not move the shipment.
--
-- A shipment whose cancellation operation has external_started_at set has a Stripe refund
-- requested or made. Until now fn_record_tracking_event, fn_mark_shipment_delivered and
-- fn_confirm_shipment_delivery still advanced such a shipment (shipped, delivered, completed),
-- after which fn_cancel_shipment answered CANNOT_CANCEL_IN_THIS_STATUS and the cancellation
-- could never finish. Now all three leave the status alone when the operation has started
-- (the same predicate as fn_begin_shipment_transfer, read after the shared shipment lock):
--   fn_record_tracking_event          still stores the tracking event; no status change; records
--                                     the first such scan on the operation (late_carrier_activity_*).
--   fn_mark_shipment_delivered        returns (false, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE').
--   fn_confirm_shipment_delivery      returns (false, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE').
-- A live claim whose refund has not started is deliberately NOT a guard: a scan that moves the
-- shipment then makes the start refuse (SHIPMENT_NOT_CANCELABLE) before any money moves, which
-- is the intended outcome for a package that is on its way.
--
-- fn_list_shipment_late_carrier_activity is the service-only read for an admin to review the
-- package that moved. It moves no money and changes no shipment.
--
-- Grant review: the three redefined functions keep their signatures and their service-only
-- grants (restated below). The new list function is SECURITY DEFINER because it reads
-- operations and shipments across users; it is limited to service_role (PUBLIC, anon and
-- authenticated revoked) and checks auth.role() itself.
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN late_carrier_activity_at TIMESTAMPTZ,
  ADD COLUMN late_carrier_activity_event_type public.shipment_tracking_event_type,
  ADD CONSTRAINT shipment_cancellation_operations_late_activity_recorded CHECK (
    (late_carrier_activity_at IS NULL) = (late_carrier_activity_event_type IS NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_late_activity_after_start CHECK (
    late_carrier_activity_at IS NULL OR external_started_at IS NOT NULL
  );

COMMENT ON COLUMN public.shipment_cancellation_operations.late_carrier_activity_at IS
  'When the first carrier scan that would have advanced the shipment arrived after the refund started. Set once by fn_record_tracking_event; NULL together with late_carrier_activity_event_type. The shipment status is not changed by the scan.';
COMMENT ON COLUMN public.shipment_cancellation_operations.late_carrier_activity_event_type IS
  'Event type of that first scan. Kept together with late_carrier_activity_at.';

CREATE OR REPLACE FUNCTION public.fn_confirm_shipment_delivery(p_shipment_id uuid, p_source text, p_actor_id uuid, p_idempotency_key text)
 RETURNS TABLE(success boolean, error text, completion_source text, idempotent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_order_id uuid;
  v_buyer_id uuid;
  v_status public.order_status_enum;
  v_delivered_at timestamptz;
  v_buyer_confirmed_at timestamptz;
  v_is_connect BOOLEAN;
  v_completion_source text;
  v_completed_at timestamptz := now();
BEGIN
  IF coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  ) <> 'service_role' THEN
    RETURN QUERY SELECT false, 'SERVICE_ROLE_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('buyer', 'auto') THEN
    RETURN QUERY SELECT false, 'INVALID_COMPLETION_SOURCE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN QUERY SELECT false, 'IDEMPOTENCY_KEY_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer'
    AND p_idempotency_key <> 'confirm_shipment_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'auto'
    AND p_idempotency_key <> 'auto_completion_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  SELECT
    s.order_id,
    s.status,
    s.delivered_at,
    s.buyer_confirmed_at,
    s.stripe_payment_intent_id IS NOT NULL
  INTO
    v_order_id,
    v_status,
    v_delivered_at,
    v_buyer_confirmed_at,
    v_is_connect
  FROM public.shipments AS s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::text, NULL::text, false;
    RETURN;
  END IF;

  IF v_status = 'completed' THEN
    SELECT event.source
    INTO v_completion_source
    FROM public.shipment_completion_events AS event
    WHERE event.shipment_id = p_shipment_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'COMPLETION_AUDIT_MISSING'::text, NULL::text, false;
      RETURN;
    END IF;

    RETURN QUERY SELECT true, NULL::text, v_completion_source, true;
    RETURN;
  END IF;

  -- Read after the shipment lock, like fn_begin_shipment_transfer: a started cancellation
  -- operation means a refund was requested, so the shipment must end cancelled, never completed.
  IF EXISTS (
    SELECT 1
    FROM public.shipment_cancellation_operations AS operation
    WHERE operation.shipment_id = p_shipment_id
      AND operation.external_started_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF NOT v_status = 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.disputes AS dispute
    WHERE dispute.shipment_id = p_shipment_id
      AND dispute.status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_HAS_ACTIVE_DISPUTE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer' THEN
    SELECT buyer_id INTO v_buyer_id
    FROM public.orders
    WHERE id = v_order_id;

    IF p_actor_id IS NULL OR v_buyer_id IS DISTINCT FROM p_actor_id THEN
      RETURN QUERY SELECT false, 'BUYER_REQUIRED'::text, NULL::text, false;
      RETURN;
    END IF;
  ELSIF p_actor_id IS NOT NULL OR v_buyer_confirmed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  ELSIF v_delivered_at IS NULL
    OR NOT (v_delivered_at <= now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  END IF;

  -- Shipments without a Stripe payment intent have no payout path since the
  -- internal balance was removed: refuse them before any state changes.
  IF NOT v_is_connect THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::text, NULL::text, false;
    RETURN;
  END IF;

  INSERT INTO public.shipment_completion_events (
    shipment_id,
    order_id,
    source,
    actor_id,
    idempotency_key,
    completed_at,
    is_connect
  ) VALUES (
    p_shipment_id,
    v_order_id,
    p_source,
    p_actor_id,
    p_idempotency_key,
    v_completed_at,
    v_is_connect
  );

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'INFO',
    'Connect shipment completion skipped deprecated wallet release',
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'source', p_source,
      'is_connect', true
    )
  );

  UPDATE public.shipments
  SET status = 'completed',
      completed_at = v_completed_at,
      buyer_confirmed_at = CASE
        WHEN p_source = 'buyer' THEN v_completed_at
        ELSE buyer_confirmed_at
      END,
      updated_at = v_completed_at
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::text, p_source, false;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'ERROR',
    'Shipment completion RPC failed',
    jsonb_build_object('shipment_id', p_shipment_id, 'sqlstate', SQLSTATE)
  );
  RETURN QUERY SELECT false, 'INTERNAL_ERROR'::text, NULL::text, false;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_confirm_shipment_delivery(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirm_shipment_delivery(uuid, text, uuid, text) TO service_role;

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
  ELSIF p_dispute_id IS NULL AND v_status = 'shipped' AND p_transition = 'delivered' THEN
    UPDATE public.shipments
    SET status = 'delivered', delivered_at = p_event_at, updated_at = now()
    WHERE id = p_shipment_id;
    v_status := 'delivered';
  ELSIF v_status = 'cancelled' THEN
    NULL;
  END IF;

  RETURN jsonb_build_object('inserted', true, 'event_id', v_event_id, 'shipment_status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_tracking_event(uuid, uuid, public.shipment_tracking_event_type, timestamp with time zone, text, text, text, text, uuid, uuid, public.order_status_enum) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_tracking_event(uuid, uuid, public.shipment_tracking_event_type, timestamp with time zone, text, text, text, text, uuid, uuid, public.order_status_enum) TO service_role;

-- Cancellations whose shipment saw carrier activity after the refund started, oldest first.
-- Read-only; the review of the package itself is manual. A TABLE keeps the columns typed.
CREATE OR REPLACE FUNCTION public.fn_list_shipment_late_carrier_activity()
RETURNS TABLE (
  shipment_id UUID,
  order_id UUID,
  seller_id UUID,
  tracking_number TEXT,
  carrier TEXT,
  shipment_status public.order_status_enum,
  source TEXT,
  refund_status TEXT,
  late_carrier_activity_at TIMESTAMPTZ,
  late_carrier_activity_event_type public.shipment_tracking_event_type
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  RETURN QUERY
  SELECT o.shipment_id, o.order_id, s.seller_id, s.tracking_number, s.carrier, s.status,
         o.source, o.refund_status, o.late_carrier_activity_at, o.late_carrier_activity_event_type
  FROM public.shipment_cancellation_operations o
  JOIN public.shipments s ON s.id = o.shipment_id
  WHERE o.late_carrier_activity_at IS NOT NULL
  ORDER BY o.late_carrier_activity_at ASC, o.shipment_id ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_list_shipment_late_carrier_activity() IS
  'Service-only (SECURITY DEFINER): cancellations whose shipment saw a carrier scan after the refund started, oldest first. Read-only.';

REVOKE EXECUTE ON FUNCTION public.fn_list_shipment_late_carrier_activity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_shipment_late_carrier_activity() TO service_role;

COMMIT;
