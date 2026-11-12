CREATE OR REPLACE FUNCTION public.fn_shipments_status_trigger()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  -- Actualiza el estado de la orden global reactivamente tras cada cambio en shipments
  UPDATE public.orders
  SET status = internal.fn_derive_order_status(NEW.order_id),
      updated_at = now()
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_shipments_status_trigger"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."fn_shipments_status_trigger"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_shipments_status_trigger"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_shipments_status_trigger"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_shipments_status_trigger"() FROM "anon", "authenticated";
