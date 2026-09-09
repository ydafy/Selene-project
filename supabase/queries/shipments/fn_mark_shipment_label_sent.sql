
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments SET label_generation_state = 'generation_sent', claim_expires_at = now() + interval '15 minutes', updated_at = now()
  WHERE id = p_shipment_id AND label_generation_state = 'claimed' AND claim_token = p_claim_token
    AND lower(label_quote_carrier) = 'paquetexpress'
    AND lower(regexp_replace(label_quote_service, '\s+', ' ', 'g')) = 'ground'
    AND label_quote_cost_cents IS NOT NULL AND label_quote_input_hash IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type) VALUES (p_shipment_id, 'sent');
  RETURN true;
END;
