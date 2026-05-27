
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status public.order_status_enum;
  v_buyer_id UUID;
  v_wallet_id UUID;
  v_wallet_balance NUMERIC;
  v_net_payout NUMERIC;
BEGIN
  -- 1. Bloquear shipment
  SELECT order_id, seller_id, status INTO v_order_id, v_seller_id, v_status
  FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Validar caller es el comprador
  SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_order_id;
  IF v_buyer_id IS DISTINCT FROM auth.uid() THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 3. Validar status del shipment
  IF v_status NOT IN ('shipped', 'delivered') THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE'::TEXT; RETURN;
  END IF;

  -- 4. Validar que no haya disputa activa en este shipment
  IF EXISTS (
    SELECT 1 FROM public.disputes
    WHERE shipment_id = p_shipment_id AND status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_HAS_ACTIVE_DISPUTE'::TEXT; RETURN;
  END IF;

  -- 5. Validar wallet del seller
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_seller_id) THEN
    RETURN QUERY SELECT false, format('SELLER_WALLET_NOT_FOUND: %s', v_seller_id); RETURN;
  END IF;

  -- 6. Calcular net_payout de este shipment
  SELECT COALESCE(SUM(net_payout), 0) INTO v_net_payout
  FROM public.order_items
  WHERE shipment_id = p_shipment_id;

  -- 7. Mutación financiera (solo este shipment)
  SELECT id, available_balance INTO v_wallet_id, v_wallet_balance
  FROM public.wallets WHERE user_id = v_seller_id FOR UPDATE;

  UPDATE public.wallets
  SET pending_balance = GREATEST(0, pending_balance - v_net_payout),
      available_balance = available_balance + v_net_payout,
      updated_at = now()
  WHERE id = v_wallet_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'WALLET_UPDATE_FAILED'::TEXT; RETURN;
  END IF;

  INSERT INTO public.wallet_transactions
    (wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description)
  VALUES (
    v_wallet_id, v_order_id, p_shipment_id, v_net_payout, v_net_payout,
    v_wallet_balance + v_net_payout, 'release',
    'Liberación por confirmación del comprador — Shipment ' || p_shipment_id
  );

  -- 8. Marcar shipment completado (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_confirm_shipment_delivery',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
