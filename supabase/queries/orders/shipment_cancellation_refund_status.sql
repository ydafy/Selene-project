-- B2.1: per-shipment Stripe refund identity and status on the existing
-- cancellation operation. Requires the B1.1 and B1.2 coordination SQL first.
-- Apply the matching migration OR this identical canonical copy, not both.
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN refund_id TEXT,
  ADD COLUMN refund_status TEXT
    CHECK (refund_status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  ADD COLUMN refund_failure_reason TEXT,
  ADD COLUMN refund_status_updated_at TIMESTAMPTZ,
  ADD CONSTRAINT shipment_cancellation_operations_refund_recorded CHECK (
    (refund_id IS NULL) = (refund_status IS NULL)
    AND (refund_status IS NULL) = (refund_status_updated_at IS NULL)
  );

-- One Stripe refund belongs to exactly one shipment.
CREATE UNIQUE INDEX shipment_cancellation_operations_refund_id_key
  ON public.shipment_cancellation_operations (refund_id)
  WHERE refund_id IS NOT NULL;

COMMENT ON TABLE public.shipment_cancellation_operations IS
  'One durable cancellation identity per shipment. Claim/start RPCs own the fence; fn_record_shipment_cancellation_refund records the Stripe refund. TTL never clears external_started_at.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_id IS
  'Stripe refund ID for this shipment''s frozen refund request. Written only by fn_record_shipment_cancellation_refund.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_status IS
  'Last accepted Stripe refund status. Only succeeded allows fn_cancel_shipment; succeeded may still move to failed later.';
COMMENT ON COLUMN public.shipment_cancellation_operations.refund_failure_reason IS
  'Stripe failure_reason, kept only while refund_status is failed.';

-- Records what Stripe returned (or later reports) for the started operation.
-- Replays and stale or impossible transitions return the stored state with
-- changed = false instead of failing, so provider retries and out-of-order
-- webhooks are safe. A refund that does not match the frozen request fails.
CREATE OR REPLACE FUNCTION public.fn_record_shipment_cancellation_refund(
  p_shipment_id UUID,
  p_refund_id TEXT,
  p_payment_intent_id TEXT,
  p_amount_cents BIGINT,
  p_status TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_changed BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_refund_id IS NULL OR btrim(p_refund_id) = '' THEN RAISE EXCEPTION 'INVALID_REFUND_ID'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'INVALID_REFUND_STATUS';
  END IF;

  -- Same lock order as claim/start and fn_cancel_shipment: shipment first.
  PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.external_started_at IS NULL OR v_operation.refund_request IS NULL THEN
    RAISE EXCEPTION 'CANCELLATION_NOT_STARTED';
  END IF;

  IF p_payment_intent_id IS DISTINCT FROM v_operation.refund_request->>'payment_intent' THEN
    RAISE EXCEPTION 'REFUND_PAYMENT_INTENT_MISMATCH';
  END IF;
  IF p_amount_cents IS DISTINCT FROM (v_operation.refund_request->>'amount')::BIGINT THEN
    RAISE EXCEPTION 'REFUND_AMOUNT_MISMATCH';
  END IF;
  IF v_operation.refund_id IS NOT NULL AND v_operation.refund_id <> p_refund_id THEN
    RAISE EXCEPTION 'REFUND_ID_MISMATCH';
  END IF;
  IF v_operation.refund_id IS NULL AND EXISTS (
    SELECT 1 FROM public.shipment_cancellation_operations WHERE refund_id = p_refund_id
  ) THEN
    RAISE EXCEPTION 'REFUND_ID_ALREADY_LINKED';
  END IF;

  -- Stripe's refund lifecycle; failed and canceled are terminal.
  v_changed := v_operation.refund_status IS NULL
    OR (v_operation.refund_status = 'requires_action' AND p_status IN ('pending', 'succeeded', 'failed', 'canceled'))
    OR (v_operation.refund_status = 'pending' AND p_status IN ('succeeded', 'failed', 'canceled'))
    OR (v_operation.refund_status = 'succeeded' AND p_status = 'failed');

  IF v_changed THEN
    UPDATE public.shipment_cancellation_operations
      SET refund_id = p_refund_id,
          refund_status = p_status,
          refund_failure_reason = CASE WHEN p_status = 'failed' THEN NULLIF(btrim(p_failure_reason), '') END,
          refund_status_updated_at = clock_timestamp()
      WHERE shipment_id = p_shipment_id
      RETURNING * INTO v_operation;
  END IF;

  RETURN jsonb_build_object('refund_id', v_operation.refund_id,
    'refund_status', v_operation.refund_status,
    'refund_failure_reason', v_operation.refund_failure_reason,
    'changed', v_changed);
END;
$$;

-- Service-only: Edge Functions and the Stripe webhook record provider results.
REVOKE EXECUTE ON FUNCTION public.fn_record_shipment_cancellation_refund(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_shipment_cancellation_refund(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role;

COMMIT;
