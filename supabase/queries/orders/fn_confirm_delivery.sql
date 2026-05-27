
DECLARE
  v_buyer_id UUID;
  v_status public.order_status_enum;
  v_item RECORD;
  v_wallet_id UUID;
  v_wallet_balance NUMERIC;
BEGIN
  -- 1. Bloquear fila de la orden
  SELECT status, buyer_id INTO v_status, v_buyer_id
  FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_buyer_id IS NULL THEN
    RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'::TEXT; RETURN;
  END IF;
  -- 2. Validar caller es el comprador
  IF v_buyer_id IS DISTINCT FROM auth.uid() THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;
  -- 3. Validar estatus (flexibilidad paquetería México)
  IF v_status NOT IN ('shipped', 'delivered') THEN
    RETURN QUERY SELECT false, 'ORDER_NOT_IN_CONFIRMABLE_STATE'::TEXT; RETURN;
  END IF;
  -- 4. Validar que no haya disputa activa
  IF EXISTS (
    SELECT 1 FROM public.disputes
    WHERE order_id = p_order_id AND status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'ORDER_HAS_ACTIVE_DISPUTE'::TEXT; RETURN;
  END IF;
  -- 5. PRE-VALIDACIÓN multi-seller
  FOR v_item IN
    SELECT seller_id FROM public.order_items
    WHERE order_id = p_order_id GROUP BY seller_id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_item.seller_id) THEN
      RETURN QUERY SELECT false, format('SELLER_WALLET_NOT_FOUND: %s', v_item.seller_id); RETURN;
    END IF;
  END LOOP;
  -- 6. MUTACIÓN FINANCIERA
  FOR v_item IN
    SELECT seller_id, SUM(net_payout) as total_payout
    FROM public.order_items WHERE order_id = p_order_id GROUP BY seller_id
  LOOP
    SELECT id, available_balance INTO v_wallet_id, v_wallet_balance
    FROM public.wallets WHERE user_id = v_item.seller_id FOR UPDATE;
    UPDATE public.wallets
    SET pending_balance = GREATEST(0, pending_balance - v_item.total_payout),
        available_balance = available_balance + v_item.total_payout,
        updated_at = now()
    WHERE id = v_wallet_id;
    INSERT INTO public.wallet_transactions
      (wallet_id, order_id, amount, net_amount, balance_after, type, description)
    VALUES (
      v_wallet_id, p_order_id, v_item.total_payout, v_item.total_payout,
      v_wallet_balance + v_item.total_payout, 'release',
      'Liberación por confirmación del comprador'
    );
  END LOOP;
  -- 7. Marcar orden completada
  UPDATE public.orders
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_order_id;
  RETURN QUERY SELECT true, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_confirm_delivery',
          jsonb_build_object('order_id', p_order_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
