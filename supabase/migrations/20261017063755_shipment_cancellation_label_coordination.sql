-- B1.3 label half only; cancellation/transfer integration remains separately gated.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_claim_shipment_label(
  p_shipment_id UUID, p_seller_id UUID, p_origin_address_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_seller_id UUID; v_state TEXT; v_token UUID; v_origin JSONB; v_claim_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT seller_id, label_generation_state, origin_address, claim_expires_at
    INTO v_seller_id, v_state, v_origin, v_claim_expires_at
    FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_seller_id IS DISTINCT FROM p_seller_id THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Cancellation writers hold this same shipment lock before touching their row.
  -- Keep expired pre-start context: its owner cannot start while a label owns it.
  IF EXISTS (SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id
      AND (external_started_at IS NOT NULL OR claim_expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE';
  END IF;
  IF v_state = 'generated' THEN RETURN jsonb_build_object('status', 'generated'); END IF;
  IF v_state = 'orphan_pending' THEN RETURN jsonb_build_object('status', 'orphan_pending'); END IF;
  IF v_state IN ('claimed', 'generation_sent') AND v_claim_expires_at <= clock_timestamp() THEN
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
    claim_expires_at = clock_timestamp() + interval '15 minutes', updated_at = now()
    WHERE id = p_shipment_id AND status = 'paid'
      AND label_generation_state IN ('unclaimed', 'retryable_rejected');
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'ineligible'); END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id)
    VALUES (p_shipment_id, 'claimed', p_seller_id);
  RETURN jsonb_build_object('status', 'claimed', 'claim_token', v_token, 'origin_address', v_origin);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mark_shipment_label_sent(p_shipment_id UUID, p_claim_token UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Serialize the final pre-provider boundary with cancellation claim/start.
  PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id
      AND (external_started_at IS NOT NULL OR claim_expires_at > clock_timestamp())) THEN
    RETURN false;
  END IF;
  UPDATE public.shipments SET label_generation_state = 'generation_sent', claim_expires_at = clock_timestamp() + interval '15 minutes', updated_at = now()
  WHERE id = p_shipment_id AND label_generation_state = 'claimed' AND claim_token = p_claim_token
    AND claim_expires_at > clock_timestamp()
    AND lower(label_quote_carrier) = 'paquetexpress'
    AND lower(regexp_replace(label_quote_service, '\s+', ' ', 'g')) = 'ground'
    AND label_quote_cost_cents IS NOT NULL AND label_quote_input_hash IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type) VALUES (p_shipment_id, 'sent');
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_claim_shipment_label(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_mark_shipment_label_sent(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_shipment_label(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mark_shipment_label_sent(UUID, UUID) TO service_role;

COMMIT;
