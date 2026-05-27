
DECLARE
v_buyer_id UUID;
v_auth_user_id UUID;
v_status public.dispute_status;
BEGIN
-- 1. Identidad
v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    -- 2. Bloqueo y Validación
    SELECT buyer_id, status INTO v_buyer_id, v_status
    FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;

    IF NOT FOUND THEN RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN; END IF;
    IF v_buyer_id != v_auth_user_id THEN RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN; END IF;
    IF v_status != 'waiting_return' THEN RETURN QUERY SELECT false, 'INVALID_STATUS_FOR_EVIDENCE'::TEXT; RETURN; END IF;

    -- 3. Validar input
    IF p_images IS NULL OR array_length(p_images, 1) < 1 THEN
        RETURN QUERY SELECT false, 'AT_LEAST_ONE_IMAGE_REQUIRED'::TEXT; RETURN;
    END IF;

    -- 4. Ejecutar
    UPDATE public.disputes
    SET buyer_evidence = buyer_evidence || jsonb_build_object('return_images', p_images),
        updated_at = now()
    WHERE id = p_dispute_id;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
INSERT INTO public.system_logs (level, message, metadata)
VALUES ('ERROR', 'Fallo en fn_buyer_submit_return_evidence', jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
RETURN QUERY SELECT false, SQLERRM;
END;
