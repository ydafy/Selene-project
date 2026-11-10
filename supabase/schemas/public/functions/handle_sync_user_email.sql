CREATE OR REPLACE FUNCTION public.handle_sync_user_email()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  UPDATE public.profiles 
  SET email = NEW.email,
      last_sign_in_at = NEW.last_sign_in_at -- <--- SINCRONIZACIÓN DE LOGIN
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."handle_sync_user_email"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_sync_user_email"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_sync_user_email"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."handle_sync_user_email"() FROM PUBLIC, "anon", "authenticated";
