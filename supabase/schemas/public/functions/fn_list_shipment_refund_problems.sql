CREATE OR REPLACE FUNCTION public.fn_list_shipment_refund_problems()
  RETURNS TABLE (
    shipment_id           uuid,
    order_id              uuid,
    buyer_id              uuid,
    shipment_status       text,
    kind                  text,
    refund_id             text,
    refund_failure_reason text,
    amount_owed_cents     bigint,
    payment_intent_id     text,
    since                 timestamp with time zone
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
  SELECT p.shipment_id, p.order_id, p.buyer_id, p.shipment_status, p.kind, p.refund_id,
         p.refund_failure_reason, p.amount_owed_cents, p.payment_intent_id, p.since
  FROM (
    SELECT o.shipment_id,
           o.order_id,
           ord.buyer_id,
           s.status::TEXT AS shipment_status,
           CASE
             WHEN o.refund_status = 'failed' THEN 'refund_failed'
             WHEN o.refund_status = 'canceled' THEN 'refund_canceled'
             WHEN o.recovery_escalation_reason = 'refund_not_found' THEN 'refund_not_found'
             ELSE 'refund_ambiguous'
           END AS kind,
           o.refund_id,
           o.refund_failure_reason,
           (o.refund_request->>'amount')::BIGINT AS amount_owed_cents,
           o.refund_request->>'payment_intent' AS payment_intent_id,
           CASE WHEN o.refund_status IS NULL THEN o.recovery_escalated_at ELSE o.refund_status_updated_at END AS since
    FROM public.shipment_cancellation_operations o
    JOIN public.shipments s ON s.id = o.shipment_id
    JOIN public.orders ord ON ord.id = o.order_id
    WHERE o.refund_resolved_at IS NULL
      AND o.external_started_at IS NOT NULL
      AND (
        o.refund_status IN ('failed', 'canceled')
        OR (o.refund_id IS NULL AND o.refund_status IS NULL AND o.recovery_escalated_at IS NOT NULL)
      )
  ) p
  ORDER BY p.since ASC, p.shipment_id ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_list_shipment_refund_problems"() TO "service_role";

COMMENT ON FUNCTION "public"."fn_list_shipment_refund_problems"() IS 'Service-only (SECURITY DEFINER): unresolved shipment refund problems for admin review (failed or canceled refunds, escalated operations with no refund), oldest first. Amount owed is the frozen request amount.';

REVOKE ALL ON FUNCTION "public"."fn_list_shipment_refund_problems"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_shipment_refund_problems"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_list_shipment_refund_problems"() FROM PUBLIC, "anon", "authenticated";
