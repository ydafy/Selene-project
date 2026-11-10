CREATE OR REPLACE FUNCTION public.fn_admin_toggle_verified_seller (
  p_target_user_id uuid,
  p_admin_id       uuid,
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

GRANT EXECUTE ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, uuid, boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, uuid, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, uuid, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_admin_toggle_verified_seller"(uuid, uuid, boolean) FROM PUBLIC, "anon";
