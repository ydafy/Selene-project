DECLARE
  v_shipment_id UUID;
  v_dispute_status TEXT;
  v_shipment_status TEXT;
  v_payment_intent TEXT;
  v_resolution TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fn_record_dispute_refund is service-role only' USING ERRCODE = '42501';
  END IF;

  SELECT d.shipment_id INTO v_shipment_id
  FROM public.disputes AS d
  WHERE d.id = p_dispute_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  -- The shipment lock serializes this with the completion and release paths.
  SELECT s.status::TEXT, s.stripe_payment_intent_id
  INTO v_shipment_status, v_payment_intent
  FROM public.shipments AS s
  WHERE s.id = v_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_payment_intent IS NULL THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::TEXT;
    RETURN;
  END IF;

  SELECT d.status::TEXT, d.resolution_type
  INTO v_dispute_status, v_resolution
  FROM public.disputes AS d
  WHERE d.id = p_dispute_id
  FOR UPDATE;

  -- A repeated call after the refund was recorded changes nothing.
  IF v_shipment_status = 'refunded'
     AND v_dispute_status = 'resolved'
     AND v_resolution = 'buyer' THEN
    RETURN QUERY SELECT true, 'ALREADY_RECORDED'::TEXT;
    RETURN;
  END IF;

  IF v_dispute_status NOT IN ('waiting_return', 'return_delivered') THEN
    RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT;
    RETURN;
  END IF;

  IF v_shipment_status NOT IN ('shipped', 'delivered') THEN
    RETURN QUERY SELECT false, ('SHIPMENT_NOT_REFUNDABLE:' || v_shipment_status)::TEXT;
    RETURN;
  END IF;

  UPDATE public.shipments
  SET status = 'refunded',
      updated_at = now()
  WHERE id = v_shipment_id;

  UPDATE public.disputes
  SET status = 'resolved',
      resolution_type = 'buyer',
      admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Reembolso Stripe ' || COALESCE(p_stripe_refund_id, 'unknown') || ' registrado.',
      updated_at = now()
  WHERE id = p_dispute_id;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Dispute refund recorded',
          jsonb_build_object(
            'dispute_id', p_dispute_id,
            'shipment_id', v_shipment_id,
            'stripe_refund_id', p_stripe_refund_id));

  RETURN QUERY SELECT true, NULL::TEXT;
END;
