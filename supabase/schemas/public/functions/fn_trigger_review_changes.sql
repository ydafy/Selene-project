CREATE OR REPLACE FUNCTION public.fn_trigger_review_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
    -- Llamamos al trabajador que actualizamos en el Paso 1
    PERFORM internal.fn_refresh_seller_stats(COALESCE(NEW.seller_id, OLD.seller_id));
    
    RETURN NULL; -- Correcto para triggers AFTER
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_trigger_review_changes"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_trigger_review_changes"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_trigger_review_changes"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_trigger_review_changes"() FROM PUBLIC, "anon", "authenticated";
