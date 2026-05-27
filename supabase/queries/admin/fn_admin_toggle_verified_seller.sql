
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    -- A. SEGURIDAD: Obtener ID desde JWT y validar sesión
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- C. ACTUALIZAR PERFIL
    UPDATE public.profiles
    SET is_verified_seller = p_is_verified,
        updated_at = now() -- Asumiendo que agregamos esta columna o usamos el trigger de updated_at
    WHERE id = p_target_user_id;

    -- Capturamos si el usuario realmente existía (Fix Sugerido por IA Local)
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
        RETURN false; -- Usuario no encontrado
    END IF;

    -- D. AUDITORÍA: Rastro del Admin en admin_audit_logs
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_VERIFICATION_TOGGLE', p_target_user_id,
           jsonb_build_object('is_verified', p_is_verified, 'timestamp', now()));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico con metadatos (Aprovechando la nueva columna metadata)
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_toggle_verified_seller',
            jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN false;
END;
