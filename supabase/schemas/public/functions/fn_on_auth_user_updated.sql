CREATE OR REPLACE FUNCTION public.fn_on_auth_user_updated()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  UPDATE public.profiles_private
  SET email = NEW.email,
      updated_at = now()
  WHERE id = NEW.id;

  IF NOT FOUND THEN
    RAISE WARNING 'profiles_private row missing for user %', NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_on_auth_user_updated"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_on_auth_user_updated"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_on_auth_user_updated"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_on_auth_user_updated"() FROM PUBLIC, "anon", "authenticated";
