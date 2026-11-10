CREATE OR REPLACE FUNCTION public.update_updated_at_column()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."update_updated_at_column"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."update_updated_at_column"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_updated_at_column"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."update_updated_at_column"() FROM PUBLIC, "anon", "authenticated";
