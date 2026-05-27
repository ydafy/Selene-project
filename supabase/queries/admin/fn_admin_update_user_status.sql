
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    -- A. SEGURIDAD: Obtener ID desde JWT
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins pueden banear
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- C. ACTUALIZAR PERFIL
    UPDATE public.profiles
    SET status = p_new_status,
        status_reason = p_reason,
        status_updated_by = v_auth_user_id::text, -- Guardamos quién lo hizo
        status_updated_at = now()
    WHERE id = p_target_user_id;

    -- Capturamos si el usuario realmente existía
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
        RETURN false;
    END IF;

    -- D. EFECTO DOMINÓ (MVP++): Gestión de Inventario
    IF p_new_status IN ('suspended', 'banned') THEN
        -- Si sancionamos, ocultamos TODO su hardware activo o en revisión
        UPDATE public.products
        SET status = 'HIDDEN',
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status IN ('VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW');

    ELSIF p_new_status = 'active' THEN
        -- Si lo perdonamos, regresamos a VERIFIED solo lo que estaba oculto
        -- (Nota: No regresamos a VERIFIED lo que estaba en revisión por seguridad)
        UPDATE public.products
        SET status = 'VERIFIED',
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'HIDDEN';
    END IF;

    -- E. REGISTRO EN BITÁCORA DE ADMINISTRACIÓN
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,
           jsonb_build_object('new_status', p_new_status, 'reason', p_reason));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico en logs del sistema
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_update_user_status', jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
