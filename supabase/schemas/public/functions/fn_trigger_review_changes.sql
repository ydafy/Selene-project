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

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en trigger tr_after_review_change',
            jsonb_build_object(
                'operation', TG_OP,
                'seller_id', COALESCE(NEW.seller_id, OLD.seller_id),
                'error', SQLERRM
            ));
    RAISE; -- Forzamos rollback para evitar inconsistencia
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_trigger_review_changes"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_trigger_review_changes"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_trigger_review_changes"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_trigger_review_changes"() FROM PUBLIC, "anon", "authenticated";
