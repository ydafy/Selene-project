CREATE OR REPLACE FUNCTION public.fn_claim_shipment_cancellation (
  p_shipment_id uuid,
  p_order_id    uuid,
  p_actor_id    uuid,
  p_source      text,
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
  v_buyer_id UUID;
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('buyer', 'seller', 'paid_timeout', 'preparing_timeout')
     OR p_reason IS NULL OR btrim(p_reason) = ''
     OR (p_source IN ('buyer', 'seller') AND p_actor_id IS NULL)
     OR (p_source IN ('paid_timeout', 'preparing_timeout') AND p_actor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_CONTEXT';
  END IF;

  -- Every future participating writer must lock this same shipment first.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  IF v_shipment.order_id IS DISTINCT FROM p_order_id THEN RAISE EXCEPTION 'SHIPMENT_ORDER_MISMATCH'; END IF;
  SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_shipment.order_id;
  IF p_source = 'buyer' AND p_actor_id IS DISTINCT FROM v_buyer_id THEN RAISE EXCEPTION 'ORDER_BUYER_MISMATCH'; END IF;
  IF p_source = 'seller' AND p_actor_id IS DISTINCT FROM v_shipment.seller_id THEN RAISE EXCEPTION 'SHIPMENT_SELLER_MISMATCH'; END IF;

  IF (p_source IN ('buyer', 'seller', 'paid_timeout') AND v_shipment.status IS DISTINCT FROM 'paid')
     OR (p_source = 'preparing_timeout' AND v_shipment.status IS DISTINCT FROM 'preparing') THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  -- Do not weaken the label system's orphan fence. A generated preparing label
  -- is not an in-flight generation; carrier cancellation policy remains B4.
  IF v_shipment.label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')
     OR (v_shipment.status = 'paid' AND v_shipment.label_generation_state = 'generated') THEN
    RAISE EXCEPTION 'SHIPMENT_LABEL_OPERATION_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF FOUND THEN
    -- B4.4a: an admin decides first. A pending review or a review closed without refund never
    -- rotates the token; an approved refund claims normally and then passes the start guard.
    IF v_operation.review_required_at IS NOT NULL AND v_operation.review_resolution IS NULL THEN
      RAISE EXCEPTION 'SHIPMENT_CANCELLATION_UNDER_REVIEW';
    END IF;
    IF v_operation.review_resolution = 'closed_no_refund' THEN
      RAISE EXCEPTION 'SHIPMENT_CANCELLATION_REVIEW_CLOSED';
    END IF;
    -- Later callers cannot change the winning source, actor, reason or key.
    v_result := jsonb_build_object('operation_key', v_operation.operation_key,
      'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason);
    IF v_operation.external_started_at IS NOT NULL THEN
      RETURN v_result || jsonb_build_object('status', 'recovery_required');
    END IF;
    IF v_operation.claim_expires_at > clock_timestamp() THEN
      RETURN v_result || jsonb_build_object('status', 'busy');
    END IF;
    -- A stale pre-call worker can no longer pass start after token rotation.
    -- B4.4b: a preparing_timeout takeover of an expired pre-start operation that belongs to
    -- another source re-owns it. That operation never authorized an external call, and its
    -- source (buyer, seller, paid_timeout) can no longer act on a preparing shipment, so
    -- keeping that context would make the carrier outcome and review RPCs reject it forever.
    IF p_source = 'preparing_timeout' AND v_operation.source <> 'preparing_timeout' THEN
      UPDATE public.shipment_cancellation_operations
        SET claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '15 minutes',
            source = 'preparing_timeout', actor_id = NULL, reason = p_reason
        WHERE shipment_id = p_shipment_id
        RETURNING * INTO v_operation;
    ELSE
      UPDATE public.shipment_cancellation_operations
        SET claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '15 minutes'
        WHERE shipment_id = p_shipment_id
        RETURNING * INTO v_operation;
    END IF;
  ELSE
    INSERT INTO public.shipment_cancellation_operations
      (shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at)
      VALUES (p_shipment_id, p_order_id, p_source, p_actor_id, p_reason,
        gen_random_uuid(), clock_timestamp() + interval '15 minutes')
      RETURNING * INTO v_operation;
  END IF;

  RETURN jsonb_build_object('status', 'claimed', 'operation_key', v_operation.operation_key,
    'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason,
    'claim_token', v_operation.claim_token, 'claim_expires_at', v_operation.claim_expires_at);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_shipment_cancellation"(uuid, uuid, uuid, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_claim_shipment_cancellation"(uuid, uuid, uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_shipment_cancellation"(uuid, uuid, uuid, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_shipment_cancellation"(uuid, uuid, uuid, text, text) FROM PUBLIC, "anon", "authenticated";
