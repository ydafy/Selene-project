
DECLARE
    v_auth_user_id UUID;
    v_current_locker_id UUID;
    v_current_locker_name TEXT;
    v_current_locked_at TIMESTAMPTZ;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION'; END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    SELECT d.locked_by, p.username, d.locked_at
    INTO v_current_locker_id, v_current_locker_name, v_current_locked_at
    FROM public.disputes d
    LEFT JOIN public.profiles p ON p.id = d.locked_by
    WHERE d.id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'DISPUTE_NOT_FOUND'; END IF;

    -- Caso 1: Libre o expirado
    IF v_current_locker_id IS NULL OR v_current_locked_at < (now() - interval '10 minutes') THEN
        UPDATE public.disputes SET locked_by = v_auth_user_id, locked_at = now() WHERE id = p_dispute_id;

        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'DISPUTE_LOCK_ACQUIRED', p_dispute_id, jsonb_build_object('prev_locker', v_current_locker_id));

        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;

    -- Caso 2: Ya es mío (Renovación - FIX APLICADO)
    ELSIF v_current_locker_id = v_auth_user_id THEN
        UPDATE public.disputes SET locked_at = now() WHERE id = p_dispute_id;

        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'DISPUTE_LOCK_RENEWED', p_dispute_id, jsonb_build_object('timestamp', now()));

        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;

    -- Caso 3: Ocupado
    ELSE
        RETURN QUERY SELECT false, v_current_locker_name, v_current_locked_at;
    END IF;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_lock_dispute', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
