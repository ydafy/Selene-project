CREATE OR REPLACE FUNCTION public.fn_acknowledge_shipment_late_carrier_activity (
  p_shipment_id uuid,
  p_admin_id    uuid,
  p_note        text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_note TEXT := btrim(p_note);
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_already BOOLEAN := true;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Defense in depth: the admin id is stored as the reviewer, so it must be an active admin by
  -- the same rule as is_admin(), not only what the caller checked.
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF v_note IS NULL OR v_note = '' OR char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'INVALID_ACKNOWLEDGEMENT_NOTE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shipments WHERE id = p_shipment_id) THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.late_carrier_activity_at IS NULL THEN
    RAISE EXCEPTION 'LATE_CARRIER_ACTIVITY_NOT_FOUND';
  END IF;

  IF v_operation.late_carrier_activity_acknowledged_at IS NULL THEN
    v_already := false;
    UPDATE public.shipment_cancellation_operations
      SET late_carrier_activity_acknowledged_at = clock_timestamp(),
          late_carrier_activity_acknowledged_by = p_admin_id,
          late_carrier_activity_acknowledged_note = v_note
      WHERE shipment_id = p_shipment_id
      RETURNING * INTO v_operation;
  END IF;

  RETURN jsonb_build_object(
    'acknowledged_at', v_operation.late_carrier_activity_acknowledged_at,
    'acknowledged_by', v_operation.late_carrier_activity_acknowledged_by,
    'acknowledged_note', v_operation.late_carrier_activity_acknowledged_note,
    'already_acknowledged', v_already);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_acknowledge_shipment_late_carrier_activity"(uuid, uuid, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_acknowledge_shipment_late_carrier_activity"(uuid, uuid, text) IS 'Service-only (SECURITY DEFINER): an active admin acknowledges carrier activity recorded after the cancellation refund started. Writes only the acknowledgement columns, once; a repeat returns the stored acknowledgement. Moves no money and changes no shipment or order.';

REVOKE ALL ON FUNCTION "public"."fn_acknowledge_shipment_late_carrier_activity"(uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_acknowledge_shipment_late_carrier_activity"(uuid, uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_acknowledge_shipment_late_carrier_activity"(uuid, uuid, text) FROM PUBLIC, "anon", "authenticated";
