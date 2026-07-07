
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_buyer_id UUID;
  v_shipment_status TEXT;
  v_stripe_payment_intent_id TEXT;
  v_net_payout NUMERIC;
  v_wallet_id UUID;
  v_wallet_available NUMERIC;
  v_dispute_id UUID;
BEGIN
  -- 1. Validar shipment y obtener datos (Usa public.shipments y public.orders)
  SELECT s.order_id, s.seller_id, s.status::TEXT, s.stripe_payment_intent_id, o.buyer_id
  INTO v_order_id, v_seller_id, v_shipment_status, v_stripe_payment_intent_id, v_buyer_id
  FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- Connect guard: Connect refunds are handled by Stripe reverse_transfer in
  -- resolve-dispute-refund. This legacy wallet rollback function must not write
  -- wallets or wallet_transactions for Connect-era shipments.
  IF v_stripe_payment_intent_id IS NOT NULL THEN
    UPDATE public.shipments
    SET status = 'refunded', updated_at = now()
    WHERE id = p_shipment_id;
    RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET_REFUND'::TEXT; RETURN;
  END IF;

  -- 1b. No reembolsar shipments ya refunded o completed (fondos ya liberados)
  IF v_shipment_status IN ('refunded', 'completed', 'cancelled', 'pending') THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_REFUNDABLE'::TEXT; RETURN;
  END IF;

  -- 2. Obtener dispute asociado
  SELECT id INTO v_dispute_id FROM public.disputes
  WHERE shipment_id = p_shipment_id AND status NOT IN ('resolved', 'rejected')
  LIMIT 1;

  -- 3. Calcular net_payout de este shipment (COALESCE por defensa ante NULL)
  SELECT COALESCE(SUM(net_payout), 0) INTO v_net_payout
  FROM public.order_items WHERE shipment_id = p_shipment_id;

  -- 4. Revertir pending_balance del seller
  UPDATE public.wallets
  SET pending_balance = GREATEST(0, pending_balance - v_net_payout),
      updated_at = now()
  WHERE user_id = v_seller_id
  RETURNING id, available_balance INTO v_wallet_id, v_wallet_available;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'WALLET_UPDATE_FAILED'::TEXT; RETURN;
  END IF;

  -- 5. Ledger
  INSERT INTO public.wallet_transactions (wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description)
  VALUES (v_wallet_id, v_order_id, p_shipment_id, -v_net_payout, -v_net_payout, v_wallet_available, 'refund', 'Reembolso por disputa resuelta — Shipment ' || p_shipment_id);

  -- 6. Liberar productos de este shipment
  UPDATE public.products SET status = 'IN_REVIEW', updated_at = now()
  WHERE id IN (SELECT product_id FROM public.order_items WHERE shipment_id = p_shipment_id);

  -- 7. Marcar shipment como refunded (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'refunded', updated_at = now()
  WHERE id = p_shipment_id;

  -- 8. Resolver la disputa si existe
  IF v_dispute_id IS NOT NULL THEN
    UPDATE public.disputes
    SET status = 'resolved', resolution_type = 'buyer', updated_at = now()
    WHERE id = v_dispute_id;
  END IF;

  -- 9. Notificaciones
  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES
    (v_buyer_id, 'success', 'Reembolso Finalizado', 'Tu dinero ha sido devuelto.', '/profile/orders/' || v_order_id),
    (v_seller_id, 'warning', 'Producto Reembolsado', 'El producto está en revisión técnica.', '/profile/orders/' || v_order_id);

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_complete_shipment_refund',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
