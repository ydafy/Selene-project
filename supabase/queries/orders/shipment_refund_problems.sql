-- B2.4a: unresolved shipment refund problems for the admin "Reembolsos" bucket.
-- Requires the B2.2.1 escalation SQL and the B2.3.1 refund resolution SQL first.
-- Apply the matching migration OR this identical canonical copy, not both.
BEGIN;

-- Returns one row per started cancellation operation that needs an admin and is not resolved:
--   refund_failed / refund_canceled   the recorded refund ended failed / canceled (since = refund_status_updated_at)
--   refund_not_found / refund_ambiguous  recovery escalated and no refund is recorded (since = recovery_escalated_at)
-- An escalated operation whose refund was later recorded as failed/canceled is one refund_failed/refund_canceled
-- row; pending, requires_action and succeeded refunds are never problems. Oldest first, then shipment_id.
-- A TABLE (not jsonb) keeps the columns typed for the generated database types.
-- No pagination: every row waits for a manual admin action, so the set stays small, and the
-- filter scans shipment_cancellation_operations (one row per cancelled shipment) and joins by primary key.
CREATE OR REPLACE FUNCTION public.fn_list_shipment_refund_problems()
RETURNS TABLE (
  shipment_id UUID,
  order_id UUID,
  buyer_id UUID,
  shipment_status TEXT,
  kind TEXT,
  refund_id TEXT,
  refund_failure_reason TEXT,
  amount_owed_cents BIGINT,
  payment_intent_id TEXT,
  since TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.fn_list_shipment_refund_problems() IS
  'Service-only (SECURITY DEFINER): unresolved shipment refund problems for admin review (failed or canceled refunds, escalated operations with no refund), oldest first. Amount owed is the frozen request amount.';

-- Service-only: the list-shipment-refund-problems Edge Function verifies the caller is an admin
-- through profiles_private.role. The definer bypasses RLS to read orders and operations, so
-- anon/authenticated must never reach it.
REVOKE EXECUTE ON FUNCTION public.fn_list_shipment_refund_problems() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_shipment_refund_problems() TO service_role;

COMMIT;
