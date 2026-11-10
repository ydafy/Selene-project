CREATE OR REPLACE FUNCTION public.fn_unlock_product (
  p_product_id uuid
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
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- Active admins only: is_admin() reads profiles_private.role and status.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    UPDATE public.products
    SET locked_by = NULL, locked_at = NULL
    WHERE id = p_product_id
    AND (locked_by = v_auth_user_id OR locked_at < (now() - interval '10 minutes'));

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected > 0 THEN
        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'PRODUCT_UNLOCK', p_product_id, jsonb_build_object('timestamp', now()));
        RETURN true;
    END IF;

    RETURN false;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_unlock_product"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_unlock_product"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_unlock_product"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_unlock_product"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_unlock_product"(uuid) FROM PUBLIC, "anon";
