CREATE OR REPLACE FUNCTION public.fn_current_account_is_active()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
SELECT NOT EXISTS (
    SELECT 1
    FROM public.profiles_private
    WHERE id = (SELECT auth.uid())
    AND status IN ('suspended', 'banned')
);
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_current_account_is_active"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_current_account_is_active"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_current_account_is_active"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_current_account_is_active"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_current_account_is_active"() FROM PUBLIC, "anon";
