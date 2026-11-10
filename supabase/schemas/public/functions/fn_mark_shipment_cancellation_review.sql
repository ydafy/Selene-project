CREATE OR REPLACE FUNCTION public.fn_mark_shipment_cancellation_review (
  p_shipment_id uuid,
  p_claim_token uuid,
  p_reason      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('tracking_unknown', 'carrier_refused', 'carrier_ambiguous') THEN
    RAISE EXCEPTION 'INVALID_REVIEW_REASON';
  END IF;

  -- Same lock order as the other cancellation RPCs: shipment first, then the operation.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_operation.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'STALE_CANCELLATION_CLAIM';
  END IF;
  IF v_operation.source IS DISTINCT FROM 'preparing_timeout' THEN
    RAISE EXCEPTION 'INVALID_CARRIER_CANCELLATION_SOURCE';
  END IF;

  IF v_operation.review_required_at IS NOT NULL THEN
    RETURN jsonb_build_object('marked', FALSE,
      'review_reason', v_operation.review_reason,
      'review_required_at', v_operation.review_required_at);
  END IF;

  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_operation.claim_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_CLAIM_EXPIRED'; END IF;
  IF v_shipment.status IS DISTINCT FROM 'preparing' THEN RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE'; END IF;

  UPDATE public.shipment_cancellation_operations
    SET review_reason = p_reason, review_required_at = clock_timestamp()
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;

  RETURN jsonb_build_object('marked', TRUE,
    'review_reason', v_operation.review_reason,
    'review_required_at', v_operation.review_required_at);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_mark_shipment_cancellation_review"(uuid, uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_mark_shipment_cancellation_review"(uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_mark_shipment_cancellation_review"(uuid, uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_mark_shipment_cancellation_review"(uuid, uuid, text) FROM PUBLIC, "anon", "authenticated";
