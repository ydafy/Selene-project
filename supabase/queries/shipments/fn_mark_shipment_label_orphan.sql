
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments
    SET label_generation_state = 'orphan_pending', claim_expires_at = NULL, updated_at = now()
    WHERE id = p_shipment_id
      AND label_generation_state IN ('claimed', 'generation_sent')
      AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, metadata)
    VALUES (p_shipment_id, 'orphaned', jsonb_build_object('errorClass', p_error_class));
  RETURN true;
END;
