CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation (
  p_shipment_id uuid,
  p_claim_token uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_operation.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'STALE_CANCELLATION_CLAIM';
  END IF;
  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_operation.claim_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_CLAIM_EXPIRED'; END IF;
  IF v_operation.order_id IS DISTINCT FROM v_shipment.order_id THEN RAISE EXCEPTION 'SHIPMENT_ORDER_MISMATCH'; END IF;
  IF (v_operation.source IN ('buyer', 'seller', 'paid_timeout') AND v_shipment.status IS DISTINCT FROM 'paid')
     OR (v_operation.source = 'preparing_timeout' AND v_shipment.status IS DISTINCT FROM 'preparing') THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  IF v_shipment.label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')
     OR (v_shipment.status = 'paid' AND v_shipment.label_generation_state = 'generated') THEN
    RAISE EXCEPTION 'SHIPMENT_LABEL_OPERATION_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  UPDATE public.shipment_cancellation_operations SET external_started_at = clock_timestamp()
    WHERE shipment_id = p_shipment_id AND claim_token = p_claim_token;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_start_shipment_cancellation"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_start_shipment_cancellation"(uuid, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_start_shipment_cancellation"(uuid, uuid) FROM PUBLIC, "service_role", "anon", "authenticated";
