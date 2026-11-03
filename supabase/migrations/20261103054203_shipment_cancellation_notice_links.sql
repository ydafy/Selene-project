-- T13 (expo-push-notifications): a shipment cancellation notice links to that shipment.
-- A shipment holds one product, so one order can have several shipments for the
-- buyer and for one seller; without the shipment the app opens the order summary.
-- fn_cancel_shipment (shipment.cancelled) and fn_apply_shipment_cancellation_refund_event
-- (shipment.refund_failed) now write
--   /profile/orders/<order_id>?shipment_id=<shipment_id>
-- and fall back to /profile/orders/<order_id> if the shipment id is NULL. Only the
-- action_path expression changes: no cancellation, refund or inventory step does.
-- CREATE OR REPLACE keeps each function's owner and grants.

BEGIN;

-- fn_cancel_shipment: from 20261030130000_release_listings_helper.sql, body from supabase/queries/orders/fn_cancel_shipment.sql.
CREATE OR REPLACE FUNCTION public.fn_cancel_shipment(
  p_shipment_id UUID,
  p_cancelled_by_role TEXT,
  p_reason TEXT,
  p_cancellation_loss_cents BIGINT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status public.order_status_enum;
  v_buyer_id UUID;
  v_actual_stripe_fee_cents BIGINT;
  v_cancellation_loss_cents BIGINT;
  v_loss_update_cents BIGINT;
  v_next_cancellation_loss_cents BIGINT;
  v_refund_status TEXT;
  v_refund_resolved_at TIMESTAMPTZ;
BEGIN
  -- 1. Lock shipment and validate eligibility.
  SELECT order_id, seller_id, status
    INTO v_order_id, v_seller_id, v_status
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT true, 'ALREADY_CANCELLED'::TEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('paid', 'preparing') THEN
    RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT;
    RETURN;
  END IF;

  -- 2. Service-role-only mutation; Edge Functions/crons validate the actor.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT;
    RETURN;
  END IF;

  IF p_cancelled_by_role NOT IN ('buyer', 'seller', 'system') THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT;
    RETURN;
  END IF;

  -- The Stripe refund must be recorded as succeeded before the business
  -- cancellation: every caller records it first, so a missing operation or a
  -- NULL status means no confirmed refund. The one exception is a failed or
  -- canceled refund an admin resolved (fn_resolve_shipment_cancellation_refund).
  SELECT refund_status, refund_resolved_at INTO v_refund_status, v_refund_resolved_at
  FROM public.shipment_cancellation_operations
  WHERE shipment_id = p_shipment_id;

  IF v_refund_status IS DISTINCT FROM 'succeeded' AND v_refund_resolved_at IS NULL THEN
    RETURN QUERY SELECT false, 'REFUND_NOT_SUCCEEDED'::TEXT;
    RETURN;
  END IF;

  -- 3. Lock order for refund-loss reconciliation.
  SELECT buyer_id, actual_stripe_fee_cents, cancellation_loss_cents
    INTO v_buyer_id, v_actual_stripe_fee_cents, v_cancellation_loss_cents
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  -- 4. Release products before publishing the shipment transition.
  PERFORM public.fn_release_listings(
    ARRAY(
      SELECT oi.product_id
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.shipment_id = p_shipment_id
    ),
    false,
    false
  );

  -- 5. Mark the shipment cancelled and persist any reconciled loss.
  UPDATE public.shipments
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_shipment_id;

  IF p_cancellation_loss_cents IS NOT NULL AND v_actual_stripe_fee_cents IS NOT NULL THEN
    v_loss_update_cents := p_cancellation_loss_cents;
    v_next_cancellation_loss_cents := LEAST(
      COALESCE(v_actual_stripe_fee_cents, 0),
      COALESCE(v_cancellation_loss_cents, 0) + v_loss_update_cents
    );

    UPDATE public.orders
    SET cancellation_loss_cents = v_next_cancellation_loss_cents,
        updated_at = now()
    WHERE id = v_order_id;
  END IF;

  -- One notice per distinct recipient for this committed shipment transition.
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    type, title, message, action_path
  )
  SELECT recipients.user_id,
         'shipment.cancelled',
         'shipment.cancelled:' || p_shipment_id::text,
         jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id,
                            'recipient_role', recipients.recipient_role),
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'info' ELSE 'warning' END,
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'Pedido cancelado'
              ELSE 'Venta cancelada' END,
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'Se canceló un envío de tu pedido.'
              ELSE 'Se canceló tu envío; los productos regresaron a tu inventario.' END,
         '/profile/orders/' || v_order_id::text
           || COALESCE('?shipment_id=' || p_shipment_id::text, '')
  -- WHERE true disambiguates INSERT ... SELECT from JOIN ON before ON CONFLICT.
  FROM (
    SELECT v_buyer_id AS user_id, 'buyer' AS recipient_role
    UNION ALL
    SELECT v_seller_id, 'seller' WHERE v_seller_id IS DISTINCT FROM v_buyer_id
  ) recipients
  WHERE true
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'CRITICAL',
    'Fallo en fn_cancel_shipment',
    jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM)
  );
  RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

-- fn_apply_shipment_cancellation_refund_event: from 20261025234907_shipment_refund_failure_realert.sql, body from supabase/queries/orders/shipment_cancellation_refund_events.sql.
CREATE OR REPLACE FUNCTION public.fn_apply_shipment_cancellation_refund_event(
  p_shipment_id UUID,
  p_refund_id TEXT,
  p_payment_intent_id TEXT,
  p_amount_cents BIGINT,
  p_status TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shipment_status TEXT;
  v_order_id UUID;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_recorded JSONB;
  v_outcome TEXT;
  v_buyer_id UUID;
  v_cancel_success BOOLEAN;
  v_cancel_error TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- Same lock order as claim/start, record and fn_cancel_shipment: shipment first.
  SELECT status::text, order_id INTO v_shipment_status, v_order_id
    FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'ignored'); END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  IF NOT FOUND OR v_operation.external_started_at IS NULL OR v_operation.refund_request IS NULL THEN
    RETURN jsonb_build_object('outcome', 'ignored');
  END IF;

  -- A resolved operation is settled by hand (the buyer may already have been paid another way):
  -- never write to it. Validate against the frozen request first so a foreign event is not accepted.
  IF v_operation.refund_resolved_at IS NOT NULL THEN
    IF p_refund_id IS NULL OR btrim(p_refund_id) = '' THEN RAISE EXCEPTION 'INVALID_REFUND_ID'; END IF;
    IF p_status IS NULL OR p_status NOT IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') THEN
      RAISE EXCEPTION 'INVALID_REFUND_STATUS';
    END IF;
    IF p_payment_intent_id IS DISTINCT FROM v_operation.refund_request->>'payment_intent' THEN
      RAISE EXCEPTION 'REFUND_PAYMENT_INTENT_MISMATCH';
    END IF;
    IF p_amount_cents IS DISTINCT FROM (v_operation.refund_request->>'amount')::BIGINT THEN
      RAISE EXCEPTION 'REFUND_AMOUNT_MISMATCH';
    END IF;
    IF p_refund_id = v_operation.refund_id AND p_status = v_operation.refund_status THEN
      RETURN jsonb_build_object(
        'refund_id', v_operation.refund_id,
        'refund_status', v_operation.refund_status,
        'refund_failure_reason', v_operation.refund_failure_reason,
        'amount_owed_cents', (v_operation.refund_request->>'amount')::BIGINT,
        'outcome', 'unchanged');
    END IF;
    RETURN jsonb_build_object(
      'refund_id', p_refund_id,
      'refund_status', p_status,
      'refund_failure_reason', p_failure_reason,
      'amount_owed_cents', (v_operation.refund_request->>'amount')::BIGINT,
      'resolution_reference', v_operation.refund_resolution_reference,
      'outcome', 'after_resolution');
  END IF;

  v_recorded := public.fn_record_shipment_cancellation_refund(
    p_shipment_id, p_refund_id, p_payment_intent_id, p_amount_cents, p_status, p_failure_reason);

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  v_outcome := CASE WHEN (v_recorded->>'changed')::BOOLEAN THEN 'recorded' ELSE 'unchanged' END;

  IF v_operation.refund_status = 'succeeded' AND v_shipment_status IN ('paid', 'preparing') THEN
    -- Complete with the stored winner, reason and frozen loss, never the event's.
    SELECT c.success, c.error_message INTO v_cancel_success, v_cancel_error
      FROM public.fn_cancel_shipment(
        p_shipment_id,
        CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source ELSE 'system' END,
        v_operation.reason,
        v_operation.cancellation_loss_cents) AS c;
    IF v_cancel_success IS NOT TRUE OR v_cancel_error IS NOT NULL THEN
      RAISE EXCEPTION 'CANCELLATION_COMPLETE_FAILED: %', COALESCE(v_cancel_error, 'UNKNOWN');
    END IF;
    v_outcome := 'completed';
  -- A redelivered failure event reports again while the operation is unresolved (resolved ones
  -- returned above): the webhook alerts after this commits, so a crash in between must not lose
  -- the alert. The buyer notice below is idempotent, so a redelivery never adds a second one.
  ELSIF v_operation.refund_status IN ('failed', 'canceled')
        AND ((v_recorded->>'changed')::BOOLEAN OR p_status IN ('failed', 'canceled')) THEN
    SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_order_id;
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload,
      type, title, message, action_path
    )
    VALUES (
      v_buyer_id,
      'shipment.refund_failed',
      'shipment.refund_failed:' || p_shipment_id::text || ':' || v_operation.refund_id,
      jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id,
                         'refund_id', v_operation.refund_id, 'recipient_role', 'buyer'),
      'error',
      'Reembolso con problemas',
      CASE WHEN v_shipment_status = 'cancelled'
        THEN 'No pudimos completar el reembolso de un envío cancelado de tu pedido. Nuestro equipo se pondrá en contacto contigo para devolverte tu dinero.'
        ELSE 'El reembolso de la cancelación de un envío de tu pedido no se completó. Nuestro equipo lo está revisando y se pondrá en contacto contigo.'
      END,
      '/profile/orders/' || v_order_id::text
        || COALESCE('?shipment_id=' || p_shipment_id::text, '')
    )
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    v_outcome := CASE WHEN v_shipment_status = 'cancelled'
      THEN 'failed_after_cancellation' ELSE 'failed_before_cancellation' END;
  END IF;

  RETURN jsonb_build_object(
    'refund_id', v_operation.refund_id,
    'refund_status', v_operation.refund_status,
    'refund_failure_reason', v_operation.refund_failure_reason,
    'amount_owed_cents', (v_operation.refund_request->>'amount')::BIGINT,
    'outcome', v_outcome);
END;
$$;

COMMIT;
