CREATE OR REPLACE FUNCTION public.fn_get_shipment_carrier_cancellation (
  p_shipment_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_operation public.shipment_cancellation_operations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shipments WHERE id = p_shipment_id) THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CANCELLATION_OPERATION_NOT_FOUND'; END IF;

  RETURN jsonb_build_object(
    'carrier_cancellation_outcome', v_operation.carrier_cancellation_outcome,
    'carrier_cancellation_recorded_at', v_operation.carrier_cancellation_recorded_at,
    'carrier_balance_returned', v_operation.carrier_balance_returned,
    'carrier_balance_returned_at', v_operation.carrier_balance_returned_at,
    'label_cost_loss_cents', v_operation.label_cost_loss_cents,
    'review_reason', v_operation.review_reason,
    'review_required_at', v_operation.review_required_at,
    'review_resolution', v_operation.review_resolution,
    'review_resolved_at', v_operation.review_resolved_at,
    'review_resolved_by', v_operation.review_resolved_by,
    'review_resolution_note', v_operation.review_resolution_note);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_get_shipment_carrier_cancellation"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_get_shipment_carrier_cancellation"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_get_shipment_carrier_cancellation"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_get_shipment_carrier_cancellation"(uuid) FROM PUBLIC, "anon", "authenticated";
