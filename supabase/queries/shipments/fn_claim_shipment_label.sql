
DECLARE v_seller_id UUID; v_state TEXT; v_token UUID; v_origin JSONB; v_claim_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT seller_id, label_generation_state, origin_address, claim_expires_at
    INTO v_seller_id, v_state, v_origin, v_claim_expires_at
    FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_seller_id IS DISTINCT FROM p_seller_id THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF v_state = 'generated' THEN RETURN jsonb_build_object('status', 'generated'); END IF;
  IF v_state = 'orphan_pending' THEN RETURN jsonb_build_object('status', 'orphan_pending'); END IF;
  IF v_state IN ('claimed', 'generation_sent') AND v_claim_expires_at <= now() THEN
    UPDATE public.shipments SET label_generation_state = 'orphan_pending', claim_expires_at = NULL,
      updated_at = now() WHERE id = p_shipment_id;
    INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id, metadata)
      VALUES (p_shipment_id, 'orphaned', p_seller_id,
        jsonb_build_object('errorClass', 'stale_claim_requires_reconciliation'));
    RETURN jsonb_build_object('status', 'orphan_pending', 'reconciliation_required', true);
  END IF;
  IF v_state IN ('claimed', 'generation_sent') THEN RETURN jsonb_build_object('status', 'claimed_conflict'); END IF;
  IF v_origin IS NULL THEN
    SELECT jsonb_build_object('full_name', a.full_name, 'phone', a.phone,
      'street_line1', a.street_line1, 'street_number', a.street_number,
      'district', a.district, 'city', a.city, 'state', a.state,
      'country', a.country, 'zip_code', a.zip_code)
    INTO v_origin FROM public.addresses a
    WHERE a.id = p_origin_address_id AND a.user_id = v_seller_id AND a.deleted_at IS NULL;
    IF v_origin IS NULL OR COALESCE(btrim(v_origin ->> 'street_number'), '') = '' THEN
      RAISE EXCEPTION 'SELLER_ORIGIN_CORRECTION_REQUIRED';
    END IF;
    UPDATE public.shipments SET origin_address_id = p_origin_address_id, origin_address = v_origin
      WHERE id = p_shipment_id AND origin_address IS NULL;
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.shipments SET label_generation_state = 'claimed', claim_token = v_token,
    claim_expires_at = now() + interval '15 minutes', updated_at = now()
    WHERE id = p_shipment_id AND status = 'paid'
      AND label_generation_state IN ('unclaimed', 'retryable_rejected');
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'ineligible'); END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id)
    VALUES (p_shipment_id, 'claimed', p_seller_id);
  RETURN jsonb_build_object('status', 'claimed', 'claim_token', v_token, 'origin_address', v_origin);
END;
