CREATE OR REPLACE FUNCTION public.fn_record_shipment_carrier_cancellation (
  p_shipment_id         uuid,
  p_claim_token         uuid,
  p_outcome             text,
  p_balance_returned    boolean                  DEFAULT NULL::boolean,
  p_balance_returned_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_loss BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted', 'refused', 'ambiguous')
     OR (p_outcome = 'accepted' AND p_balance_returned IS NULL)
     OR (p_outcome <> 'accepted' AND (p_balance_returned IS NOT NULL OR p_balance_returned_at IS NOT NULL))
     OR (p_balance_returned IS NOT TRUE AND p_balance_returned_at IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_CARRIER_CANCELLATION_OUTCOME';
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

  IF v_operation.carrier_cancellation_outcome IS NOT NULL THEN
    IF v_operation.carrier_cancellation_outcome = p_outcome
       AND v_operation.carrier_balance_returned IS NOT DISTINCT FROM p_balance_returned
       AND v_operation.carrier_balance_returned_at IS NOT DISTINCT FROM p_balance_returned_at THEN
      RETURN jsonb_build_object(
        'carrier_cancellation_outcome', v_operation.carrier_cancellation_outcome,
        'carrier_cancellation_recorded_at', v_operation.carrier_cancellation_recorded_at,
        'carrier_balance_returned', v_operation.carrier_balance_returned,
        'carrier_balance_returned_at', v_operation.carrier_balance_returned_at,
        'label_cost_loss_cents', v_operation.label_cost_loss_cents,
        'changed', FALSE);
    END IF;
    RAISE EXCEPTION 'CARRIER_CANCELLATION_ALREADY_RECORDED';
  END IF;

  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_operation.claim_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_CLAIM_EXPIRED'; END IF;
  IF v_shipment.status IS DISTINCT FROM 'preparing' THEN RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE'; END IF;

  v_loss := CASE
    WHEN p_outcome <> 'accepted' THEN NULL
    WHEN p_balance_returned THEN 0
    ELSE v_shipment.label_provider_cost_cents
  END;

  UPDATE public.shipment_cancellation_operations
    SET carrier_cancellation_outcome = p_outcome,
        carrier_cancellation_recorded_at = clock_timestamp(),
        carrier_balance_returned = p_balance_returned,
        carrier_balance_returned_at = p_balance_returned_at,
        label_cost_loss_cents = v_loss
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;

  RETURN jsonb_build_object(
    'carrier_cancellation_outcome', v_operation.carrier_cancellation_outcome,
    'carrier_cancellation_recorded_at', v_operation.carrier_cancellation_recorded_at,
    'carrier_balance_returned', v_operation.carrier_balance_returned,
    'carrier_balance_returned_at', v_operation.carrier_balance_returned_at,
    'label_cost_loss_cents', v_operation.label_cost_loss_cents,
    'changed', TRUE);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_record_shipment_carrier_cancellation"(uuid, uuid, text, boolean, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_record_shipment_carrier_cancellation"(uuid, uuid, text, boolean, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_record_shipment_carrier_cancellation"(uuid, uuid, text, boolean, timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_record_shipment_carrier_cancellation"(uuid, uuid, text, boolean, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";
