CREATE OR REPLACE FUNCTION internal.is_admin()
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  RETURN (SELECT (role = 'admin') FROM public.profiles WHERE id = auth.uid());
END; $function$;

GRANT EXECUTE ON FUNCTION "internal"."is_admin"() TO "service_role";

REVOKE ALL ON FUNCTION "internal"."is_admin"() FROM PUBLIC;
