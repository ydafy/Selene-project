CREATE OR REPLACE FUNCTION public.fn_get_shipment_cancellation_summary (
  p_shipment_id uuid
)
  RETURNS TABLE (
    source            text,
    refund_state      text,
    refund_updated_at timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  SELECT o.source,
         CASE
           WHEN o.refund_status = 'succeeded' OR o.refund_resolved_at IS NOT NULL THEN 'refunded'
           WHEN o.refund_status IN ('failed', 'canceled')
             OR o.recovery_escalated_at IS NOT NULL
             OR (o.review_required_at IS NOT NULL AND o.review_resolution IS NULL)
             OR o.review_resolution = 'closed_no_refund' THEN 'delayed'
           ELSE 'processing'
         END,
         o.refund_status_updated_at
  FROM public.shipment_cancellation_operations o
  JOIN public.shipments s ON s.id = o.shipment_id
  -- The buyer comes from the order recorded on the operation, not the shipment's current link.
  JOIN public.orders ord ON ord.id = o.order_id
  WHERE o.shipment_id = p_shipment_id
    AND auth.uid() IS NOT NULL
    AND (ord.buyer_id = auth.uid() OR s.seller_id = auth.uid());
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_get_shipment_cancellation_summary"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_get_shipment_cancellation_summary"(uuid) TO "service_role";

COMMENT ON FUNCTION "public"."fn_get_shipment_cancellation_summary"(uuid) IS 'Participant read (SECURITY DEFINER): source and coarse refund state of one shipment cancellation, only for its buyer or seller; zero rows for anyone else.';

REVOKE ALL ON FUNCTION "public"."fn_get_shipment_cancellation_summary"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_get_shipment_cancellation_summary"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_get_shipment_cancellation_summary"(uuid) FROM PUBLIC, "anon";
