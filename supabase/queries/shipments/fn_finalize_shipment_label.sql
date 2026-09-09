
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_envia_shipment_id IS NULL OR p_tracking_number IS NULL OR p_label_url IS NULL OR p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0 OR lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress' OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) <> 'ground' THEN RAISE EXCEPTION 'INVALID_PROVIDER_RESULT'; END IF;
  UPDATE public.shipments SET envia_shipment_id = p_envia_shipment_id, tracking_number = p_tracking_number, label_url = p_label_url, carrier = p_carrier, service = p_service, print_format = p_print_format, print_size = p_print_size, label_provider_cost_cents = p_provider_cost_cents, label_generation_state = 'generated', status = 'preparing', label_generated_at = now(), claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = p_shipment_id AND status = 'paid' AND label_generation_state = 'generation_sent' AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type) VALUES (p_shipment_id, 'generated');
  RETURN true;
END;
