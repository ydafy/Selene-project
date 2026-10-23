-- B2.3.1: admin "mark resolved with reference" for a shipment refund that failed or was
-- canceled, audited in admin_audit_logs. Resolving a refund that failed before success
-- also completes the cancellation. Requires the B2.1 refund status SQL and the B2.3 refund
-- events SQL first; fn_cancel_shipment (same migration) then accepts a resolved refund.
-- B2.4a extends it: an operation that recovery escalated (B2.2.1) with no recorded refund is
-- resolvable too. The matching migrations are 20261022013846 (original) and the B2.4a
-- shipment_refund_problems one, which replaces the status CHECK and this function.
-- Apply the matching migration OR this identical canonical copy plus fn_cancel_shipment.sql, not both.
-- Requires the B2.2.1 escalation SQL first (recovery_escalated_at).
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN refund_resolved_at TIMESTAMPTZ,
  ADD COLUMN refund_resolved_by UUID,
  ADD COLUMN refund_resolution_reference TEXT,
  ADD CONSTRAINT shipment_cancellation_operations_refund_resolution_recorded CHECK (
    (refund_resolved_at IS NULL) = (refund_resolved_by IS NULL)
    AND (refund_resolved_at IS NULL) = (refund_resolution_reference IS NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_refund_resolution_status CHECK (
    refund_resolved_at IS NULL
    OR COALESCE(refund_status IN ('failed', 'canceled'), FALSE)
    OR (refund_id IS NULL AND refund_status IS NULL AND recovery_escalated_at IS NOT NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_refund_resolution_reference CHECK (
    refund_resolution_reference IS NULL
    OR (refund_resolution_reference = btrim(refund_resolution_reference)
        AND char_length(refund_resolution_reference) BETWEEN 1 AND 200)
  );

COMMENT ON COLUMN public.shipment_cancellation_operations.refund_resolved_at IS
  'When an admin marked a failed or canceled refund as resolved (money returned outside Stripe). Set once by fn_resolve_shipment_cancellation_refund.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_resolved_by IS
  'Admin profile that resolved the refund. Kept together with refund_resolved_at.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_resolution_reference IS
  'Admin-provided proof of the manual repayment (for example a SPEI tracking key), 1-200 characters, trimmed.';

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

COMMIT;
