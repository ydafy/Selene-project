CREATE OR REPLACE FUNCTION public.fn_record_shipment_cancellation_refund (
  p_shipment_id       uuid,
  p_refund_id         text,
  p_payment_intent_id text,
  p_amount_cents      bigint,
  p_status            text,
  p_failure_reason    text   DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_record_shipment_cancellation_refund"(uuid, text, text, bigint, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_record_shipment_cancellation_refund"(uuid, text, text, bigint, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_record_shipment_cancellation_refund"(uuid, text, text, bigint, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_record_shipment_cancellation_refund"(uuid, text, text, bigint, text, text) FROM PUBLIC, "anon", "authenticated";
