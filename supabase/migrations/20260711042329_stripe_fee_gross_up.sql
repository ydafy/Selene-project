BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS actual_stripe_fee_cents BIGINT,
  ADD COLUMN IF NOT EXISTS stripe_fee_reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_loss_cents BIGINT;

DROP FUNCTION IF EXISTS public.fn_cancel_shipment(UUID, TEXT, TEXT);

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

  -- 6. Release products and notify the seller.
  FOR v_item IN
    SELECT oi.product_id, p.name AS prod_name
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.shipment_id = p_shipment_id
  LOOP
    UPDATE public.products
    SET status = 'VERIFIED', reserved_at = NULL, updated_at = now()
    WHERE id = v_item.product_id;

    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      message,
      action_path
    )
    VALUES (
      v_seller_id,
      'warning',
      'Venta Cancelada',
      'Tu producto "' || v_item.prod_name || '" ha regresado a tu inventario por cancelación.',
      '/profile/listings'
    );
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

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    action_path
  )
  VALUES (
    v_buyer_id,
    'info',
    'Pedido Cancelado',
    'Tu reembolso ha sido procesado. El dinero regresará a tu cuenta según los tiempos de tu banco.',
    '/profile/orders'
  );

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
