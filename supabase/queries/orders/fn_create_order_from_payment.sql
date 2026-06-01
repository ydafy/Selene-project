
DECLARE
  v_order_id UUID;
  v_addr_snapshot JSONB;
  v_prod RECORD;
  v_seller RECORD;
  v_wallet_id UUID;
  v_wallet_pending NUMERIC;
  v_net_payout NUMERIC;
  v_commission_pct NUMERIC;
  v_isr_pct NUMERIC;
  v_iva_pct NUMERIC;
  v_sat_withholding NUMERIC;
  v_shipment_id UUID;
  v_shipments_cache JSONB := '{}'::JSONB; -- {seller_id: shipment_id}
  v_wallet_available NUMERIC;
BEGIN
  -- 1. Idempotencia
  IF EXISTS (SELECT 1 FROM public.orders WHERE stripe_payment_intent_id = p_stripe_intent_id) THEN
    RETURN QUERY SELECT true, 'ALREADY_PROCESSED'::TEXT; RETURN;
  END IF;

  -- 2. Config
  SELECT service_fee_pct, isr_withholding_pct, iva_withholding_pct
    INTO v_commission_pct, v_isr_pct, v_iva_pct
  FROM public.system_settings LIMIT 1;

  -- 3. Snapshot de dirección
  SELECT to_jsonb(a.*) INTO v_addr_snapshot FROM public.addresses a
  WHERE id = p_address_id AND user_id = p_buyer_id;

  IF v_addr_snapshot IS NULL THEN
    RETURN QUERY SELECT false, 'ADDRESS_NOT_FOUND_OR_UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 4. Crear la orden
  INSERT INTO public.orders (buyer_id, stripe_payment_intent_id, total_amount, status, shipping_address, service_fee_amount)
  VALUES (p_buyer_id, p_stripe_intent_id, p_total_amount, 'paid', v_addr_snapshot, p_service_fee)
  RETURNING id INTO v_order_id;

  -- 5. Crear shipments: uno por seller distinto
  FOR v_seller IN
    SELECT DISTINCT seller_id FROM public.products WHERE id = ANY(p_product_ids)
  LOOP
    INSERT INTO public.shipments (order_id, seller_id, status)
    VALUES (v_order_id, v_seller.seller_id, 'paid')
    RETURNING id INTO v_shipment_id;

    v_shipments_cache := jsonb_set(
      v_shipments_cache,
      ARRAY[v_seller.seller_id::TEXT],
      to_jsonb(v_shipment_id)
    );
  END LOOP;

  -- 6. Procesar cada producto
  FOR v_prod IN
    SELECT id, name, price, seller_id, shipping_cost, status
    FROM public.products
    WHERE id = ANY(p_product_ids)
    FOR UPDATE
  LOOP
    IF v_prod.status IS DISTINCT FROM 'VERIFIED' THEN
      RETURN QUERY SELECT false, format('PRODUCT_NOT_AVAILABLE: %s (status: %s)', v_prod.name, v_prod.status); RETURN;
    END IF;

    v_sat_withholding := v_prod.price * (v_isr_pct + v_iva_pct);
    v_net_payout := v_prod.price - (v_prod.price * v_commission_pct) - v_sat_withholding - COALESCE(v_prod.shipping_cost, 0);

    -- Asignar shipment_id según el seller
    v_shipment_id := (v_shipments_cache ->> v_prod.seller_id::TEXT)::UUID;

    INSERT INTO public.order_items (
      order_id, product_id, seller_id, price_at_purchase,
      commission_amount, shipping_amount, net_payout, shipment_id, sat_tax_withholding
    )
    VALUES (
      v_order_id, v_prod.id, v_prod.seller_id, v_prod.price,
      (v_prod.price * v_commission_pct), COALESCE(v_prod.shipping_cost, 0),
      v_net_payout, v_shipment_id, v_sat_withholding
    );

    -- Wallet
    SELECT id, pending_balance, available_balance
      INTO v_wallet_id, v_wallet_pending, v_wallet_available
    FROM public.wallets WHERE user_id = v_prod.seller_id FOR UPDATE;

    UPDATE public.wallets
    SET pending_balance = pending_balance + v_net_payout,
        updated_at = now()
    WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description, tax_withholding
    )
    VALUES (
      v_wallet_id, v_order_id, v_shipment_id, v_prod.price, v_net_payout,
      v_wallet_available,  -- available_balance intacto (el cobro entra a pending)
      'sale_proceeds',
      'Venta: ' || v_prod.name,
      v_sat_withholding
    );

    -- Marcar vendido
    UPDATE public.products SET status = 'SOLD', updated_at = now() WHERE id = v_prod.id;

    -- Notificación vendedor
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (v_prod.seller_id, 'success', '¡Vendido!', 'Has vendido: ' || v_prod.name, '/profile/orders/' || v_order_id);
  END LOOP;

  -- 7. Notificación comprador
  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES (p_buyer_id, 'success', '¡Compra Exitosa!', 'Tu pedido ha sido confirmado.', '/profile/orders/' || v_order_id);

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
