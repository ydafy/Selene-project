CREATE OR REPLACE FUNCTION internal.fn_set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  -- An update that sets updated_at on purpose (a cron or Edge Function stamping
  -- the time of the event it records) keeps that value; any other update moves
  -- it to now().
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "internal"."fn_set_updated_at"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "internal"."fn_set_updated_at"() TO "postgres";

REVOKE ALL ON FUNCTION "internal"."fn_set_updated_at"() FROM PUBLIC, "anon", "authenticated";
