CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation_refund (
  p_shipment_id             uuid,
  p_claim_token             uuid,
  p_refund_request          jsonb,
  p_cancellation_loss_cents bigint DEFAULT NULL::bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_payment_intent_id TEXT;
  v_metadata JSONB;
  v_amount NUMERIC;
  v_share NUMERIC;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- The definer can call the private original entry point. Any later rejection
  -- rolls this mark back, including malformed payloads or failed persistence.
  PERFORM public.fn_start_shipment_cancellation(p_shipment_id, p_claim_token);
  SELECT * INTO STRICT v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  IF v_operation.source = 'preparing_timeout'
     AND (
       (v_operation.carrier_cancellation_outcome IS DISTINCT FROM 'accepted'
        AND v_operation.review_resolution IS DISTINCT FROM 'refund_approved')
       -- Resolutions are final: an operation marked for review needs the approval even when
       -- the outcome is accepted, so a live token cannot refund while pending or after closing.
       OR (v_operation.review_required_at IS NOT NULL
           AND v_operation.review_resolution IS DISTINCT FROM 'refund_approved')
     ) THEN
    RAISE EXCEPTION 'CARRIER_CANCELLATION_NOT_CONFIRMED';
  END IF;
  SELECT COALESCE(s.stripe_payment_intent_id, o.stripe_payment_intent_id)
    INTO v_payment_intent_id
    FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = p_shipment_id;

  IF jsonb_typeof(p_refund_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_refund_request)) <> 4
     OR jsonb_typeof(p_refund_request->'payment_intent') IS DISTINCT FROM 'string'
     OR v_payment_intent_id IS NULL OR btrim(v_payment_intent_id) = ''
     OR p_refund_request->>'payment_intent' IS DISTINCT FROM v_payment_intent_id
     OR p_refund_request->>'reason' IS DISTINCT FROM 'requested_by_customer'
     OR jsonb_typeof(p_refund_request->'amount') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_refund_request->'metadata') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  v_amount := (p_refund_request->>'amount')::numeric;
  IF v_amount <= 0 OR v_amount > 9007199254740991 OR trunc(v_amount) <> v_amount THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;

  v_metadata := p_refund_request->'metadata';
  IF (SELECT count(*) FROM jsonb_object_keys(v_metadata)) <> 5
     OR v_metadata->>'shipment_id' IS DISTINCT FROM p_shipment_id::text
     OR v_metadata->>'order_id' IS DISTINCT FROM v_operation.order_id::text
     OR v_metadata->>'caller_role' IS DISTINCT FROM
       (CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source ELSE 'system' END)
     OR jsonb_typeof(v_metadata->'reason') IS DISTINCT FROM 'string'
     OR v_metadata->>'reason' IS DISTINCT FROM v_operation.reason
     OR jsonb_typeof(v_metadata->'seguro_share_cents') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  v_share := (v_metadata->>'seguro_share_cents')::numeric;
  IF v_share < 0 OR v_share > v_amount OR trunc(v_share) <> v_share THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  IF p_cancellation_loss_cents < 0 OR p_cancellation_loss_cents > 9007199254740991 THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_LOSS';
  END IF;

  UPDATE public.shipment_cancellation_operations
    SET refund_request = p_refund_request, cancellation_loss_cents = p_cancellation_loss_cents
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;
  RETURN jsonb_build_object('operation_key', v_operation.operation_key,
    'refund_request', v_operation.refund_request,
    'cancellation_loss_cents', v_operation.cancellation_loss_cents);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_start_shipment_cancellation_refund"(uuid, uuid, jsonb, bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_start_shipment_cancellation_refund"(uuid, uuid, jsonb, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_start_shipment_cancellation_refund"(uuid, uuid, jsonb, bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_start_shipment_cancellation_refund"(uuid, uuid, jsonb, bigint) FROM PUBLIC, "anon", "authenticated";
