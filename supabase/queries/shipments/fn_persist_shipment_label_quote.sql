
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress'
     OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) <> 'ground'
     OR p_quote_cost_cents IS NULL OR p_quote_cost_cents < 0
     OR p_input_hash IS NULL OR btrim(p_input_hash) = '' THEN
    RAISE EXCEPTION 'INVALID_ACCEPTED_RATE';
  END IF;
  UPDATE public.shipments
  SET label_quote_carrier = p_carrier,
      label_quote_service = p_service,
      label_quote_cost_cents = p_quote_cost_cents,
      label_quote_reference = NULLIF(btrim(p_quote_reference), ''),
      label_quote_rated_at = now(),
      label_quote_input_hash = p_input_hash,
      updated_at = now()
  WHERE id = p_shipment_id
    AND label_generation_state = 'claimed'
    AND claim_token = p_claim_token;
  RETURN FOUND;
END;
