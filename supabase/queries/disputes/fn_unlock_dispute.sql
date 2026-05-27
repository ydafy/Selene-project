
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION'; END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- FIX APLICADO: Manejo explícito de NULL en el tiempo de bloqueo
    UPDATE public.disputes
    SET locked_by = NULL,
        locked_at = NULL
    WHERE id = p_dispute_id
    AND (
        locked_by = v_auth_user_id
        OR locked_at IS NULL
        OR locked_at < (now() - interval '10 minutes')
    );

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected > 0 THEN
        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'DISPUTE_UNLOCK', p_dispute_id, jsonb_build_object('timestamp', now()));
        RETURN true;
    END IF;

    RETURN false;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_unlock_dispute', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
