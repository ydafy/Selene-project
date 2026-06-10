
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    -- A. SEGURIDAD: Obtener ID desde JWT
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins (usa is_admin() — roles en profiles_private)
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- C. ACTUALIZAR PERFIL
    UPDATE public.profiles
    SET status = p_new_status,
        status_reason = p_reason,
        status_updated_by = v_auth_user_id::text,
        status_updated_at = now()
    WHERE id = p_target_user_id;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
        RETURN false;
    END IF;

    -- D. EFECTO DOMINÓ: Gestión de Inventario
    IF p_new_status IN ('suspended', 'banned') THEN
        UPDATE public.products
        SET status = 'HIDDEN'::public.product_status_enum,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = ANY(ARRAY['VERIFIED','PENDING_VERIFICATION','IN_REVIEW']::public.product_status_enum[]);

    ELSIF p_new_status = 'active' THEN
        UPDATE public.products
        SET status = 'VERIFIED'::public.product_status_enum,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'HIDDEN'::public.product_status_enum
        AND deleted_at IS NULL;            -- FIX: exclude soft-deleted products
    END IF;

    -- E. REGISTRO EN BITÁCORA DE ADMINISTRACIÓN
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,
           jsonb_build_object('new_status', p_new_status, 'reason', p_reason));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_update_user_status', jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
