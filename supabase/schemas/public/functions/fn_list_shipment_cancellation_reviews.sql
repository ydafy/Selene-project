CREATE OR REPLACE FUNCTION public.fn_list_shipment_cancellation_reviews()
  RETURNS TABLE (
    shipment_id                  uuid,
    order_id                     uuid,
    seller_id                    uuid,
    tracking_number              text,
    carrier                      text,
    label_provider_cost_cents    bigint,
    review_reason                text,
    carrier_cancellation_outcome text,
    review_required_at           timestamp with time zone
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
  SELECT p.shipment_id, p.order_id, p.seller_id, p.tracking_number, p.carrier,
         p.label_provider_cost_cents, p.review_reason, p.carrier_cancellation_outcome,
         p.review_required_at
  FROM (
    SELECT o.shipment_id,
           o.order_id,
           s.seller_id,
           s.tracking_number,
           s.carrier,
           s.label_provider_cost_cents,
           o.review_reason,
           o.carrier_cancellation_outcome,
           o.review_required_at
    FROM public.shipment_cancellation_operations o
    JOIN public.shipments s ON s.id = o.shipment_id
    WHERE o.review_required_at IS NOT NULL
      AND o.review_resolution IS NULL
  ) p
  ORDER BY p.review_required_at ASC, p.shipment_id ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_list_shipment_cancellation_reviews"() TO "service_role";

COMMENT ON FUNCTION "public"."fn_list_shipment_cancellation_reviews"() IS 'Service-only (SECURITY DEFINER): preparing-timeout cancellations waiting for an admin to approve the refund or close them, oldest first.';

REVOKE ALL ON FUNCTION "public"."fn_list_shipment_cancellation_reviews"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_shipment_cancellation_reviews"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_list_shipment_cancellation_reviews"() FROM PUBLIC, "anon", "authenticated";
