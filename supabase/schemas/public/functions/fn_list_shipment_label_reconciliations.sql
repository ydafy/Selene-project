CREATE OR REPLACE FUNCTION public.fn_list_shipment_label_reconciliations()
  RETURNS TABLE (
    shipment_id             uuid,
    order_id                uuid,
    seller_id               uuid,
    seller_name             text,
    buyer_id                uuid,
    buyer_name              text,
    shipment_created_at     timestamp with time zone,
    label_generation_state  text,
    stuck_at                timestamp with time zone,
    claim_expires_at        timestamp with time zone,
    last_label_event_at     timestamp with time zone,
    quote_carrier           text,
    quote_service           text,
    quote_cost_cents        bigint,
    quote_rated_at          timestamp with time zone,
    origin_postal_code      text,
    origin_city             text,
    destination_postal_code text,
    destination_city        text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  RETURN QUERY
  SELECT stuck.* FROM (
    SELECT s.id, s.order_id, s.seller_id, sp.username, o.buyer_id, bp.username, s.created_at,
           s.label_generation_state,
           CASE WHEN s.label_generation_state = 'orphan_pending'
                THEN COALESCE(e.orphaned_at, e.last_at, s.updated_at)
                ELSE s.claim_expires_at END AS stuck_at,
           s.claim_expires_at, e.last_at,
           s.label_quote_carrier, s.label_quote_service, s.label_quote_cost_cents, s.label_quote_rated_at,
           s.origin_address ->> 'zip_code', s.origin_address ->> 'city',
           o.shipping_address ->> 'zip_code', o.shipping_address ->> 'city'
    FROM public.shipments s
    JOIN public.orders o ON o.id = s.order_id
    LEFT JOIN public.profiles sp ON sp.id = s.seller_id
    LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
    LEFT JOIN LATERAL (
      SELECT max(le.created_at) FILTER (WHERE le.event_type = 'orphaned') AS orphaned_at,
             max(le.created_at) AS last_at
      FROM public.shipment_label_events le WHERE le.shipment_id = s.id
    ) e ON true
    WHERE public.fn_shipment_label_is_stuck(s.status, s.label_generation_state, s.claim_expires_at)
  ) stuck
  ORDER BY stuck.stuck_at ASC, stuck.id ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_list_shipment_label_reconciliations"() TO "service_role";

COMMENT ON FUNCTION "public"."fn_list_shipment_label_reconciliations"() IS 'Service-only (SECURITY DEFINER): paid shipments whose label outcome is unproven (orphan_pending, or claimed/generation_sent with an expired claim), oldest first, with the seller, buyer, frozen quote and postal codes an admin needs to find the label in the Envia panel. Read-only.';

REVOKE ALL ON FUNCTION "public"."fn_list_shipment_label_reconciliations"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_shipment_label_reconciliations"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_list_shipment_label_reconciliations"() FROM PUBLIC, "anon", "authenticated";
