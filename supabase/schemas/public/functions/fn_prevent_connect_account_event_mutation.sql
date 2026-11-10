CREATE OR REPLACE FUNCTION public.fn_prevent_connect_account_event_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
BEGIN
  RAISE EXCEPTION 'connect_account_events is append-only and immutable';
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_prevent_connect_account_event_mutation"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_prevent_connect_account_event_mutation"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_prevent_connect_account_event_mutation"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_prevent_connect_account_event_mutation"() FROM PUBLIC, "anon", "authenticated";
