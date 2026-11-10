CREATE OR REPLACE FUNCTION public.fn_list_shipment_late_carrier_activity()
  RETURNS TABLE (
    shipment_id                      uuid,
    order_id                         uuid,
    seller_id                        uuid,
    tracking_number                  text,
    carrier                          text,
    shipment_status                  public.order_status_enum,
    source                           text,
    refund_status                    text,
    late_carrier_activity_at         timestamp with time zone,
    late_carrier_activity_event_type public.shipment_tracking_event_type
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  RETURN QUERY
  SELECT o.shipment_id, o.order_id, s.seller_id, s.tracking_number, s.carrier, s.status,
         o.source, o.refund_status, o.late_carrier_activity_at, o.late_carrier_activity_event_type
  FROM public.shipment_cancellation_operations o
  JOIN public.shipments s ON s.id = o.shipment_id
  WHERE o.late_carrier_activity_at IS NOT NULL
    AND o.late_carrier_activity_acknowledged_at IS NULL
  ORDER BY o.late_carrier_activity_at ASC, o.shipment_id ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_list_shipment_late_carrier_activity"() TO "service_role";

COMMENT ON FUNCTION "public"."fn_list_shipment_late_carrier_activity"() IS 'Service-only (SECURITY DEFINER): cancellations whose shipment saw a carrier scan after the refund started and that no admin has acknowledged yet, oldest first. Read-only.';

REVOKE ALL ON FUNCTION "public"."fn_list_shipment_late_carrier_activity"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_shipment_late_carrier_activity"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_list_shipment_late_carrier_activity"() FROM PUBLIC, "anon", "authenticated";
