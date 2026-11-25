CREATE OR REPLACE FUNCTION public.fn_lock_product (
  p_product_id uuid
)
  RETURNS TABLE (
    success            boolean,
    locked_by_username text,
    locked_at          timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
    v_auth_user_id UUID;
    v_verification_id UUID;
    v_locker_id UUID;
    v_locker_name TEXT;
    v_lock_time TIMESTAMPTZ;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- The review lock lives on the listing's open verification attempt
    -- (odd/tasks/verification-history.md S4).
    SELECT v.id, v.locked_by, v.locked_at
    INTO v_verification_id, v_locker_id, v_lock_time
    FROM public.product_verifications v
    WHERE v.product_id = p_product_id
      AND v.decision IS NULL
    FOR UPDATE;

    IF v_verification_id IS NULL THEN
        RAISE EXCEPTION 'VERIFICATION_NOT_OPEN';
    END IF;

    IF v_locker_id IS NOT NULL THEN
        SELECT username INTO v_locker_name
        FROM public.profiles
        WHERE id = v_locker_id;
    END IF;

    IF v_locker_id IS NULL OR v_lock_time < (now() - interval '10 minutes') THEN
        UPDATE public.product_verifications
        SET locked_by = v_auth_user_id, locked_at = now()
        WHERE id = v_verification_id;
        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;
    ELSIF v_locker_id = v_auth_user_id THEN
        UPDATE public.product_verifications
        SET locked_at = now()
        WHERE id = v_verification_id;
        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;
    ELSE
        RETURN QUERY SELECT false, v_locker_name, v_lock_time;
    END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_lock_product"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_lock_product"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_lock_product"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_lock_product"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_lock_product"(uuid) FROM PUBLIC, "anon";
