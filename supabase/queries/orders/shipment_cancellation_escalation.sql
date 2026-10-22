-- B2.2.1: once-only escalation marker on the cancellation operation, so a stuck
-- shipment costs one Stripe list and one Sentry alert instead of one per cron run.
-- Requires the B2.1 refund status SQL first.
-- Apply the matching migration OR this identical canonical copy, not both.
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN recovery_escalated_at TIMESTAMPTZ,
  ADD COLUMN recovery_escalation_reason TEXT
    CHECK (recovery_escalation_reason IN ('refund_not_found', 'refund_ambiguous')),
  ADD CONSTRAINT shipment_cancellation_operations_escalation_recorded CHECK (
    (recovery_escalated_at IS NULL) = (recovery_escalation_reason IS NULL)
  );

COMMENT ON COLUMN public.shipment_cancellation_operations.recovery_escalated_at IS
  'When automatic recovery gave up on this operation (no or several Stripe refunds found). Set once by fn_escalate_shipment_cancellation; clearing it is admin work.';
COMMENT ON COLUMN public.shipment_cancellation_operations.recovery_escalation_reason IS
  'Why recovery escalated: refund_not_found or refund_ambiguous. Kept together with recovery_escalated_at.';

-- Marks a started operation as escalated the first time only. Returns
-- {escalated: true} when this call set the marker and {escalated: false} when
-- it was already set, so callers alert exactly once per stuck operation.
CREATE OR REPLACE FUNCTION public.fn_escalate_shipment_cancellation(p_shipment_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_escalated BOOLEAN := FALSE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('refund_not_found', 'refund_ambiguous') THEN
    RAISE EXCEPTION 'INVALID_ESCALATION_REASON';
  END IF;

  -- Same lock order as the record RPC: shipment first, then the operation.
  PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.external_started_at IS NULL THEN
    RAISE EXCEPTION 'CANCELLATION_NOT_STARTED';
  END IF;

  IF v_operation.recovery_escalated_at IS NULL THEN
    UPDATE public.shipment_cancellation_operations
      SET recovery_escalated_at = clock_timestamp(),
          recovery_escalation_reason = p_reason
      WHERE shipment_id = p_shipment_id;
    v_escalated := TRUE;
  END IF;

  RETURN jsonb_build_object('escalated', v_escalated);
END;
$$;

-- Service-only: the marker gates Stripe lookups and alerts, so clients must never write it.
REVOKE EXECUTE ON FUNCTION public.fn_escalate_shipment_cancellation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_escalate_shipment_cancellation(UUID, TEXT) TO service_role;

COMMIT;
