CREATE OR REPLACE FUNCTION public.fn_get_shipment_cancellation_recovery (
  p_shipment_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
    'external_started_at', v_operation.external_started_at,
    'recovery_escalated_at', v_operation.recovery_escalated_at
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_get_shipment_cancellation_recovery"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_get_shipment_cancellation_recovery"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_get_shipment_cancellation_recovery"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_get_shipment_cancellation_recovery"(uuid) FROM PUBLIC, "anon", "authenticated";
