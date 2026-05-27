
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    -- A. SEGURIDAD: Validar Admin
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

      IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- B. EJECUCIÓN: Solo desbloquea si soy yo o si ya expiró
    UPDATE public.products
    SET locked_by = NULL,
        locked_at = NULL
    WHERE id = p_product_id
    AND (locked_by = v_auth_user_id OR locked_at < (now() - interval '10 minutes'));

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    -- C. AUDITORÍA: Si se desbloqueó, dejamos rastro
    IF v_rows_affected > 0 THEN
        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'PRODUCT_UNLOCK', p_product_id, jsonb_build_object('timestamp', now()));
        RETURN true;
    END IF;

    RETURN false;
END;
