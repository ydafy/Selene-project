CREATE OR REPLACE FUNCTION public.fn_on_dispute_opened()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
    -- Cambiar estado de la orden
    UPDATE public.orders
    SET status = 'dispute',
        updated_at = now()
    WHERE id = NEW.order_id;

    -- Log de auditoría automático
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('INFO', 'Disputa abierta para orden', jsonb_build_object('order_id', NEW.order_id, 'dispute_id', NEW.id, 'buyer_id', NEW.buyer_id));

    RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_on_dispute_opened"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_on_dispute_opened"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_on_dispute_opened"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_on_dispute_opened"() FROM PUBLIC, "anon", "authenticated";
