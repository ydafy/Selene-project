CREATE OR REPLACE FUNCTION public.fn_escalate_shipment_cancellation (
  p_shipment_id uuid,
  p_reason      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_escalate_shipment_cancellation"(uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_escalate_shipment_cancellation"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_escalate_shipment_cancellation"(uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_escalate_shipment_cancellation"(uuid, text) FROM PUBLIC, "anon", "authenticated";
