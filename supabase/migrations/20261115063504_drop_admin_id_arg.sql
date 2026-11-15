SET local check_function_bodies = off;

DROP FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, uuid, boolean);

DROP FUNCTION "public"."fn_admin_update_user_status"(uuid, uuid, public.account_status, text);

CREATE OR REPLACE FUNCTION public.fn_admin_toggle_verified_seller (
  p_target_user_id uuid,
  p_is_verified    boolean
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    -- 1. SEGURIDAD: Obtener ID desde JWT autenticado
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- 2. VALIDACIÓN DE ROL: Buscar en profiles_private vía is_admin()
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- 3. ACTUALIZAR SELLO EN PROFILES (is_verified_seller vive en profiles)
    UPDATE public.profiles
    SET is_verified_seller = p_is_verified,
        updated_at = now()
    WHERE id = p_target_user_id;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
        RETURN false;
    END IF;

    -- 4. AUDITORÍA: Registrar cambio en bitácora
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_VERIFICATION_TOGGLE', p_target_user_id,
           jsonb_build_object('is_verified', p_is_verified, 'timestamp', now()));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_toggle_verified_seller',
            jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.fn_admin_update_user_status (
  p_target_user_id uuid,
  p_new_status     public.account_status,
  p_reason         text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$

DECLARE
    v_auth_user_id UUID;
    v_previous_status public.account_status;
BEGIN
    -- A. SECURITY: the actor is the authenticated JWT subject
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. ROLE CHECK: active admins only
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    IF p_target_user_id = v_auth_user_id THEN
        RAISE EXCEPTION 'CANNOT_CHANGE_OWN_STATUS';
    END IF;

    -- A NULL status reads as active everywhere, so it would silently lift bans and holds
    IF p_new_status IS NULL THEN
        RAISE EXCEPTION 'INVALID_ACCOUNT_STATUS';
    END IF;

    -- C. LOCK TARGET: serialize concurrent status changes for the same account
    SELECT COALESCE(status, 'active')
    INTO v_previous_status
    FROM public.profiles_private
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Banned is final; same-status updates only refresh reason and audit
    IF v_previous_status = 'banned' AND p_new_status <> 'banned' THEN
        RAISE EXCEPTION 'BANNED_IS_FINAL';
    END IF;

    UPDATE public.profiles_private
    SET status = p_new_status,
        status_reason = p_reason,
        status_updated_by = v_auth_user_id::text,
        status_updated_at = now()
    WHERE id = p_target_user_id;

    -- D. INVENTORY: hold listings and remember their prior status
    IF p_new_status IN ('suspended', 'banned') THEN
        UPDATE public.products
        SET status_before_account_hold = COALESCE(status_before_account_hold, status),
            status = 'HIDDEN'::public.product_status_enum,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND deleted_at IS NULL
        AND status = ANY(ARRAY['VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW']::public.product_status_enum[]);

    -- Lifting a suspension restores only listings this hold hid; other HIDDEN listings stay hidden
    ELSIF p_new_status = 'active' AND v_previous_status = 'suspended' THEN
        UPDATE public.products
        SET status = status_before_account_hold,
            status_before_account_hold = NULL,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'HIDDEN'::public.product_status_enum
        AND status_before_account_hold IS NOT NULL
        AND deleted_at IS NULL;

        -- Listings an admin moved out of HIDDEN during the suspension keep no stale hold
        UPDATE public.products
        SET status_before_account_hold = NULL
        WHERE seller_id = p_target_user_id
        AND status_before_account_hold IS NOT NULL
        AND status <> 'HIDDEN'::public.product_status_enum;
    END IF;

    -- E. ADMIN AUDIT LOG
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,
           jsonb_build_object('previous_status', v_previous_status::text, 'new_status', p_new_status::text, 'reason', p_reason));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_update_user_status', jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_admin_update_user_status"(uuid, public.account_status, text) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_update_user_status"(uuid, public.account_status, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."fn_admin_update_user_status"(uuid, public.account_status, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_update_user_status"(uuid, public.account_status, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_update_user_status"(uuid, public.account_status, text) TO "service_role";
