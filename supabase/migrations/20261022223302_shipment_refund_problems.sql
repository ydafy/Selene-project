-- B2.4a: admin resolution also accepts an escalated operation with no recorded refund
-- (refund_not_found / refund_ambiguous), and a service-only list of unresolved refund problems.
-- Requires the B2.2.1 escalation and B2.3.1 refund resolution migrations first.
-- Canonical copies: queries/orders/shipment_cancellation_refund_resolution.sql (function, status CHECK)
-- and queries/orders/shipment_refund_problems.sql.
BEGIN;

-- The resolution columns may now also be set on an escalated operation with no recorded refund.
ALTER TABLE public.shipment_cancellation_operations
  DROP CONSTRAINT shipment_cancellation_operations_refund_resolution_status,
  ADD CONSTRAINT shipment_cancellation_operations_refund_resolution_status CHECK (
    refund_resolved_at IS NULL
    OR COALESCE(refund_status IN ('failed', 'canceled'), FALSE)
    OR (refund_id IS NULL AND refund_status IS NULL AND recovery_escalated_at IS NOT NULL)
  );

-- Marks a failed/canceled shipment refund, or an escalated operation with no recorded refund
-- (refund_not_found / refund_ambiguous), as resolved, once, with the admin's reference.
--   refuses (REFUND_NOT_RESOLVABLE)    unstarted, or started without a refund and not escalated,
--                                      or a recorded refund that is not failed/canceled (even if escalated)
--   already resolved                   {resolved: false} with the stored reference; nothing is overwritten
--   shipment already cancelled         only the resolution and its audit row are written (late failure)
--   shipment still open (paid/preparing) the cancellation completes with the stored winner,
--                                      reason and frozen loss, exactly like the refund-event RPC
--   any other shipment status          SHIPMENT_STATUS_UNEXPECTED; nothing commits
-- Any error rolls everything back, including the audit row.
CREATE OR REPLACE FUNCTION public.fn_resolve_shipment_cancellation_refund(
  p_shipment_id UUID,
  p_admin_id UUID,
  p_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reference TEXT := btrim(p_reference);
  v_shipment_status TEXT;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_amount_owed BIGINT;
  v_unrecorded_escalated BOOLEAN;
  v_cancelled BOOLEAN := FALSE;
  v_cancel_success BOOLEAN;
  v_cancel_error TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Defense in depth: the admin id is written to the audit log, so it must be an
  -- active admin by the same rule as is_admin(), not only what the caller checked.
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF v_reference IS NULL OR v_reference = '' OR char_length(v_reference) > 200 THEN
    RAISE EXCEPTION 'INVALID_RESOLUTION_REFERENCE';
  END IF;

  -- Same lock order as claim/start, record and fn_cancel_shipment: shipment first.
  SELECT status::text INTO v_shipment_status
    FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE'; END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.external_started_at IS NULL OR v_operation.refund_request IS NULL THEN
    RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE';
  END IF;
  -- Escalation markers stay as history: this function never clears them.
  v_unrecorded_escalated := v_operation.refund_id IS NULL AND v_operation.refund_status IS NULL
    AND v_operation.recovery_escalated_at IS NOT NULL;
  IF NOT v_unrecorded_escalated AND (v_operation.refund_id IS NULL OR v_operation.refund_status IS NULL) THEN
    RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE';
  END IF;
  v_amount_owed := (v_operation.refund_request->>'amount')::BIGINT;

  -- Idempotent: a second resolve never overwrites the first admin or reference.
  IF v_operation.refund_resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('resolved', FALSE, 'shipment_cancelled', FALSE,
      'amount_owed_cents', v_amount_owed, 'reference', v_operation.refund_resolution_reference);
  END IF;

  IF NOT v_unrecorded_escalated AND v_operation.refund_status NOT IN ('failed', 'canceled') THEN
    RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE';
  END IF;
  IF v_shipment_status NOT IN ('paid', 'preparing', 'cancelled') THEN
    RAISE EXCEPTION 'SHIPMENT_STATUS_UNEXPECTED: %', v_shipment_status;
  END IF;

  UPDATE public.shipment_cancellation_operations
    SET refund_resolved_at = clock_timestamp(),
        refund_resolved_by = p_admin_id,
        refund_resolution_reference = v_reference
    WHERE shipment_id = p_shipment_id;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (p_admin_id, 'SHIPMENT_REFUND_RESOLVED', p_shipment_id,
    jsonb_build_object(
      'refund_id', v_operation.refund_id,
      'refund_status', v_operation.refund_status,
      'amount_owed_cents', v_amount_owed,
      'reference', v_reference,
      'shipment_status_before', v_shipment_status)
    || CASE WHEN v_operation.recovery_escalation_reason IS NULL THEN '{}'::JSONB
            ELSE jsonb_build_object('escalation_reason', v_operation.recovery_escalation_reason) END);

  IF v_shipment_status IN ('paid', 'preparing') THEN
    -- Complete with the stored winner, reason and frozen loss, never the admin's.
    SELECT c.success, c.error_message INTO v_cancel_success, v_cancel_error
      FROM public.fn_cancel_shipment(
        p_shipment_id,
        CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source ELSE 'system' END,
        v_operation.reason,
        v_operation.cancellation_loss_cents) AS c;
    IF v_cancel_success IS NOT TRUE OR v_cancel_error IS NOT NULL THEN
      RAISE EXCEPTION 'CANCELLATION_COMPLETE_FAILED: %', COALESCE(v_cancel_error, 'UNKNOWN');
    END IF;
    v_cancelled := TRUE;
  END IF;

  RETURN jsonb_build_object('resolved', TRUE, 'shipment_cancelled', v_cancelled,
    'amount_owed_cents', v_amount_owed, 'reference', v_reference);
END;
$$;

COMMENT ON FUNCTION public.fn_resolve_shipment_cancellation_refund(UUID, UUID, TEXT) IS
  'Service-only (SECURITY DEFINER): an admin marks a failed or canceled shipment refund, or an escalated operation without a refund, as resolved with a reference (audited) and, when the shipment is still open, completes the cancellation. The caller must have verified the admin; the amount owed is the frozen request amount.';

-- Service-only: the resolve-shipment-refund Edge Function verifies the caller is an admin
-- through profiles_private.role. The definer bypasses RLS to cancel and audit, and the
-- admin id is a parameter, so anon/authenticated must never reach it.
REVOKE EXECUTE ON FUNCTION public.fn_resolve_shipment_cancellation_refund(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_shipment_cancellation_refund(UUID, UUID, TEXT) TO service_role;

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
