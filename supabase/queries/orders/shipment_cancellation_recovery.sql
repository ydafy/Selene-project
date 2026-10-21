-- B2.2: read-only view of a started shipment cancellation, so the Edge Functions
-- can recover the frozen refund without trusting the current caller.
-- Requires the B2.1 refund status SQL first.
-- Apply the matching migration OR this identical canonical copy, not both.
BEGIN;

-- Returns NULL for a missing or merely claimed (not started) operation. Never
-- writes: recovery decisions and the Stripe calls live in the Edge Functions.
CREATE OR REPLACE FUNCTION public.fn_get_shipment_cancellation_recovery(p_shipment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation public.shipment_cancellation_operations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  IF NOT FOUND OR v_operation.external_started_at IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'operation_key', v_operation.operation_key,
    'order_id', v_operation.order_id,
    'source', v_operation.source,
    'actor_id', v_operation.actor_id,
    'reason', v_operation.reason,
    'refund_request', v_operation.refund_request,
    'cancellation_loss_cents', v_operation.cancellation_loss_cents,
    'refund_id', v_operation.refund_id,
    'refund_status', v_operation.refund_status,
    'external_started_at', v_operation.external_started_at
  );
END;
$$;

-- Service-only: the frozen request and actor are internal money-flow state.
REVOKE EXECUTE ON FUNCTION public.fn_get_shipment_cancellation_recovery(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_shipment_cancellation_recovery(UUID) TO service_role;

COMMIT;
