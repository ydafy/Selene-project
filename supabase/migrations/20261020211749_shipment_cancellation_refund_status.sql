-- B2.1: per-shipment refund identity/status and fn_cancel_shipment's refund guard.
-- Canonical copies: supabase/queries/orders/shipment_cancellation_refund_status.sql
-- and supabase/queries/orders/fn_cancel_shipment.sql. Apply this OR those, not both.
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN refund_id TEXT,
  ADD COLUMN refund_status TEXT
    CHECK (refund_status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  ADD COLUMN refund_failure_reason TEXT,
  ADD COLUMN refund_status_updated_at TIMESTAMPTZ,
  ADD CONSTRAINT shipment_cancellation_operations_refund_recorded CHECK (
    (refund_id IS NULL) = (refund_status IS NULL)
    AND (refund_status IS NULL) = (refund_status_updated_at IS NULL)
  );

-- One Stripe refund belongs to exactly one shipment.
CREATE UNIQUE INDEX shipment_cancellation_operations_refund_id_key
  ON public.shipment_cancellation_operations (refund_id)
  WHERE refund_id IS NOT NULL;

COMMENT ON TABLE public.shipment_cancellation_operations IS
  'One durable cancellation identity per shipment. Claim/start RPCs own the fence; fn_record_shipment_cancellation_refund records the Stripe refund. TTL never clears external_started_at.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_id IS
  'Stripe refund ID for this shipment''s frozen refund request. Written only by fn_record_shipment_cancellation_refund.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_status IS
  'Last accepted Stripe refund status. Only succeeded allows fn_cancel_shipment; succeeded may still move to failed later.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_failure_reason IS
  'Stripe failure_reason, kept only while refund_status is failed.';

-- Records what Stripe returned (or later reports) for the started operation.
-- Replays and stale or impossible transitions return the stored state with
-- changed = false instead of failing, so provider retries and out-of-order
-- webhooks are safe. A refund that does not match the frozen request fails.
CREATE OR REPLACE FUNCTION public.fn_record_shipment_cancellation_refund(
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
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_changed BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_refund_id IS NULL OR btrim(p_refund_id) = '' THEN RAISE EXCEPTION 'INVALID_REFUND_ID'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'INVALID_REFUND_STATUS';
  END IF;

  -- Same lock order as claim/start and fn_cancel_shipment: shipment first.
  PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.external_started_at IS NULL OR v_operation.refund_request IS NULL THEN
    RAISE EXCEPTION 'CANCELLATION_NOT_STARTED';
  END IF;

  IF p_payment_intent_id IS DISTINCT FROM v_operation.refund_request->>'payment_intent' THEN
    RAISE EXCEPTION 'REFUND_PAYMENT_INTENT_MISMATCH';
  END IF;
  IF p_amount_cents IS DISTINCT FROM (v_operation.refund_request->>'amount')::BIGINT THEN
    RAISE EXCEPTION 'REFUND_AMOUNT_MISMATCH';
  END IF;
  IF v_operation.refund_id IS NOT NULL AND v_operation.refund_id <> p_refund_id THEN
    RAISE EXCEPTION 'REFUND_ID_MISMATCH';
  END IF;
  IF v_operation.refund_id IS NULL AND EXISTS (
    SELECT 1 FROM public.shipment_cancellation_operations WHERE refund_id = p_refund_id
  ) THEN
    RAISE EXCEPTION 'REFUND_ID_ALREADY_LINKED';
  END IF;

  -- Stripe's refund lifecycle; failed and canceled are terminal.
  v_changed := v_operation.refund_status IS NULL
    OR (v_operation.refund_status = 'requires_action' AND p_status IN ('pending', 'succeeded', 'failed', 'canceled'))
    OR (v_operation.refund_status = 'pending' AND p_status IN ('succeeded', 'failed', 'canceled'))
    OR (v_operation.refund_status = 'succeeded' AND p_status = 'failed');

  IF v_changed THEN
    UPDATE public.shipment_cancellation_operations
      SET refund_id = p_refund_id,
          refund_status = p_status,
          refund_failure_reason = CASE WHEN p_status = 'failed' THEN NULLIF(btrim(p_failure_reason), '') END,
          refund_status_updated_at = clock_timestamp()
      WHERE shipment_id = p_shipment_id
      RETURNING * INTO v_operation;
  END IF;

  RETURN jsonb_build_object('refund_id', v_operation.refund_id,
    'refund_status', v_operation.refund_status,
    'refund_failure_reason', v_operation.refund_failure_reason,
    'changed', v_changed);
END;
$$;

-- Service-only: Edge Functions and the Stripe webhook record provider results.
REVOKE EXECUTE ON FUNCTION public.fn_record_shipment_cancellation_refund(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_shipment_cancellation_refund(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role;


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
  v_wallet_id UUID;
  v_wallet_pending NUMERIC;
  v_wallet_available NUMERIC;
  v_total_refund NUMERIC;
  v_item RECORD;
  v_actual_stripe_fee_cents BIGINT;
  v_cancellation_loss_cents BIGINT;
  v_loss_update_cents BIGINT;
  v_next_cancellation_loss_cents BIGINT;
  v_refund_status TEXT;
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

  -- A recorded refund must have succeeded before the business cancellation.
  -- NULL is still accepted while pre-B2.1 handlers, which never record, run.
  SELECT refund_status INTO v_refund_status
  FROM public.shipment_cancellation_operations
  WHERE shipment_id = p_shipment_id;

  IF v_refund_status IS NOT NULL AND v_refund_status <> 'succeeded' THEN
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

  -- 4. Sum the shipment's seller refund basis.
  SELECT COALESCE(SUM(COALESCE(net_payout, 0)), 0)
    INTO v_total_refund
  FROM public.order_items
  WHERE shipment_id = p_shipment_id;

  -- 5. Revert the seller wallet once.
  SELECT id, pending_balance, available_balance
    INTO v_wallet_id, v_wallet_pending, v_wallet_available
  FROM public.wallets
  WHERE user_id = v_seller_id
  FOR UPDATE;

  IF v_wallet_id IS NOT NULL THEN
    UPDATE public.wallets
    SET pending_balance = GREATEST(0, pending_balance - v_total_refund),
        updated_at = now()
    WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id,
      order_id,
      shipment_id,
      amount,
      net_amount,
      balance_after,
      type,
      description
    )
    VALUES (
      v_wallet_id,
      v_order_id,
      p_shipment_id,
      0,
      -v_total_refund,
      v_wallet_available,
      'adjustment',
      'Cancelación (' || p_cancelled_by_role || '): ' || p_reason
    );
  END IF;

  -- 6. Release products before publishing the shipment transition.
  FOR v_item IN
    SELECT oi.product_id
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.shipment_id = p_shipment_id
  LOOP
    UPDATE public.products
    SET status = 'VERIFIED', reserved_at = NULL, updated_at = now()
    WHERE id = v_item.product_id;
  END LOOP;

  -- 7. Mark the shipment cancelled and persist any reconciled loss.
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

REVOKE EXECUTE ON FUNCTION public.fn_cancel_shipment(UUID, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cancel_shipment(UUID, TEXT, TEXT, BIGINT) TO service_role;

COMMIT;
