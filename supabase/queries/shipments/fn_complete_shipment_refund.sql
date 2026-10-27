
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_buyer_id UUID;
  v_shipment_status TEXT;
  v_stripe_payment_intent_id TEXT;
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
  -- resolve-dispute-refund. For Connect-era shipments this function only marks
  -- the shipment refunded.
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

  -- 3. Liberar productos de este shipment
  UPDATE public.products SET status = 'IN_REVIEW', updated_at = now()
  WHERE id IN (SELECT product_id FROM public.order_items WHERE shipment_id = p_shipment_id);

  -- 4. Marcar shipment como refunded (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'refunded', updated_at = now()
  WHERE id = p_shipment_id;

  -- 5. Resolver la disputa si existe
  IF v_dispute_id IS NOT NULL THEN
    UPDATE public.disputes
    SET status = 'resolved', resolution_type = 'buyer', updated_at = now()
    WHERE id = v_dispute_id;
  END IF;

  -- 6. Notificaciones
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
