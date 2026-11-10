CREATE OR REPLACE FUNCTION public.handle_update_user_email()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  IF (OLD.email IS DISTINCT FROM NEW.email) THEN
    -- Actualizamos el perfil
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
    
    -- Guardamos el rastro en la bitácora que creamos antes
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (
      NULL, 
      'USER_EMAIL_CHANGED', 
      NEW.id, 
      jsonb_build_object('old_email', OLD.email, 'new_email', NEW.email)
    );
  END IF;
  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."handle_update_user_email"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_update_user_email"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_update_user_email"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."handle_update_user_email"() FROM PUBLIC, "anon", "authenticated";
