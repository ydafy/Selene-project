CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$

DECLARE
    v_role TEXT;
    v_status public.account_status;
BEGIN
    SELECT role, status
    INTO v_role, v_status
    FROM public.profiles_private
    WHERE id = auth.uid();

    -- Suspended or banned admins lose admin authority
    RETURN COALESCE(v_role = 'admin' AND COALESCE(v_status, 'active') = 'active', false);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_admin"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
