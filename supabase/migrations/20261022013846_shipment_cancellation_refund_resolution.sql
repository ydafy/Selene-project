-- B2.3.1: admin resolution of a failed/canceled shipment refund (service-only RPC + audit) and
-- fn_cancel_shipment accepting a resolved refund. Same signature, no DROP.
-- Canonical copies: supabase/queries/orders/shipment_cancellation_refund_resolution.sql
-- and supabase/queries/orders/fn_cancel_shipment.sql. Apply this OR those, not both.
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN refund_resolved_at TIMESTAMPTZ,
  ADD COLUMN refund_resolved_by UUID,
  ADD COLUMN refund_resolution_reference TEXT,
  ADD CONSTRAINT shipment_cancellation_operations_refund_resolution_recorded CHECK (
    (refund_resolved_at IS NULL) = (refund_resolved_by IS NULL)
    AND (refund_resolved_at IS NULL) = (refund_resolution_reference IS NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_refund_resolution_status CHECK (
    refund_resolved_at IS NULL OR COALESCE(refund_status IN ('failed', 'canceled'), FALSE)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_refund_resolution_reference CHECK (
    refund_resolution_reference IS NULL
    OR (refund_resolution_reference = btrim(refund_resolution_reference)
        AND char_length(refund_resolution_reference) BETWEEN 1 AND 200)
  );

COMMENT ON COLUMN public.shipment_cancellation_operations.refund_resolved_at IS
  'When an admin marked a failed or canceled refund as resolved (money returned outside Stripe). Set once by fn_resolve_shipment_cancellation_refund.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_resolved_by IS
  'Admin profile that resolved the refund. Kept together with refund_resolved_at.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_resolution_reference IS
  'Admin-provided proof of the manual repayment (for example a SPEI tracking key), 1-200 characters, trimmed.';

-- Marks a failed/canceled shipment refund as resolved, once, with the admin's reference.
--   refuses (REFUND_NOT_RESOLVABLE)    no recorded refund, or one that is not failed/canceled
--   already resolved                   {resolved: false} with the stored reference; nothing is overwritten
--   shipment already cancelled         only the resolution and its audit row are written (late failure)
--   shipment still open (paid/preparing) the cancellation completes with the stored winner,
--                                      reason and frozen loss, exactly like the refund-event RPC
--   any other shipment status          SHIPMENT_STATUS_UNEXPECTED; nothing commits
-- Any error rolls everything back, including the audit row.
CREATE OR REPLACE FUNCTION public.fn_resolve_shipment_cancellation_refund(
  p_shipment_id UUID,
  p_admin_id UUID,
  p_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reference TEXT := btrim(p_reference);
  v_shipment_status TEXT;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_amount_owed BIGINT;
  v_cancelled BOOLEAN := FALSE;
  v_cancel_success BOOLEAN;
  v_cancel_error TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Defense in depth: the admin id is written to the audit log, so it must be an
  -- active admin by the same rule as is_admin(), not only what the caller checked.
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF v_reference IS NULL OR v_reference = '' OR char_length(v_reference) > 200 THEN
    RAISE EXCEPTION 'INVALID_RESOLUTION_REFERENCE';
  END IF;

  -- Same lock order as claim/start, record and fn_cancel_shipment: shipment first.
  SELECT status::text INTO v_shipment_status
    FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE'; END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.external_started_at IS NULL OR v_operation.refund_request IS NULL
     OR v_operation.refund_id IS NULL OR v_operation.refund_status IS NULL THEN
    RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE';
  END IF;
  v_amount_owed := (v_operation.refund_request->>'amount')::BIGINT;

  -- Idempotent: a second resolve never overwrites the first admin or reference.
  IF v_operation.refund_resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('resolved', FALSE, 'shipment_cancelled', FALSE,
      'amount_owed_cents', v_amount_owed, 'reference', v_operation.refund_resolution_reference);
  END IF;

  IF v_operation.refund_status NOT IN ('failed', 'canceled') THEN
    RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE';
  END IF;
  IF v_shipment_status NOT IN ('paid', 'preparing', 'cancelled') THEN
    RAISE EXCEPTION 'SHIPMENT_STATUS_UNEXPECTED: %', v_shipment_status;
  END IF;

  UPDATE public.shipment_cancellation_operations
    SET refund_resolved_at = clock_timestamp(),
        refund_resolved_by = p_admin_id,
        refund_resolution_reference = v_reference
    WHERE shipment_id = p_shipment_id;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (p_admin_id, 'SHIPMENT_REFUND_RESOLVED', p_shipment_id,
    jsonb_build_object(
      'refund_id', v_operation.refund_id,
      'refund_status', v_operation.refund_status,
      'amount_owed_cents', v_amount_owed,
      'reference', v_reference,
      'shipment_status_before', v_shipment_status));

  IF v_shipment_status IN ('paid', 'preparing') THEN
    -- Complete with the stored winner, reason and frozen loss, never the admin's.
    SELECT c.success, c.error_message INTO v_cancel_success, v_cancel_error
      FROM public.fn_cancel_shipment(
        p_shipment_id,
        CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source ELSE 'system' END,
        v_operation.reason,
        v_operation.cancellation_loss_cents) AS c;
    IF v_cancel_success IS NOT TRUE OR v_cancel_error IS NOT NULL THEN
      RAISE EXCEPTION 'CANCELLATION_COMPLETE_FAILED: %', COALESCE(v_cancel_error, 'UNKNOWN');
    END IF;
    v_cancelled := TRUE;
  END IF;

  RETURN jsonb_build_object('resolved', TRUE, 'shipment_cancelled', v_cancelled,
    'amount_owed_cents', v_amount_owed, 'reference', v_reference);
END;
$$;

COMMENT ON FUNCTION public.fn_resolve_shipment_cancellation_refund(UUID, UUID, TEXT) IS
  'Service-only (SECURITY DEFINER): an admin marks a failed or canceled shipment refund as resolved with a reference (audited) and, when the shipment is still open, completes the cancellation. The caller must have verified the admin; the amount owed is the frozen request amount.';

-- Service-only: the resolve-shipment-refund Edge Function verifies the caller is an admin
-- through profiles_private.role. The definer bypasses RLS to cancel and audit, and the
-- admin id is a parameter, so anon/authenticated must never reach it.
REVOKE EXECUTE ON FUNCTION public.fn_resolve_shipment_cancellation_refund(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_shipment_cancellation_refund(UUID, UUID, TEXT) TO service_role;

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
