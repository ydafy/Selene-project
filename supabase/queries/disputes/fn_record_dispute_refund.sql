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

  -- The buyer notice is best effort: a failing insert must never undo the
  -- recorded refund, so it runs in its own subtransaction.
  BEGIN
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload, type, title, message, action_path
    )
    SELECT o.buyer_id,
           'shipment.refunded',
           'shipment.refunded:' || v_shipment_id::text,
           jsonb_build_object('shipment_id', v_shipment_id, 'order_id', s.order_id,
             'dispute_id', p_dispute_id, 'recipient_role', 'buyer'),
           'success',
           'Te devolvimos tu dinero',
           'Reembolsamos tu compra a tu método de pago. Puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.',
           '/profile/orders/' || s.order_id::text
             || COALESCE('?shipment_id=' || v_shipment_id::text, '')
    FROM public.shipments AS s
    JOIN public.orders AS o ON o.id = s.order_id
    WHERE s.id = v_shipment_id
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('WARNING', 'Refund notice failed',
              jsonb_build_object('dispute_id', p_dispute_id, 'shipment_id', v_shipment_id,
                'sqlstate', SQLSTATE, 'error', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Refund notice failed and could not be logged: %', SQLERRM;
    END;
  END;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
