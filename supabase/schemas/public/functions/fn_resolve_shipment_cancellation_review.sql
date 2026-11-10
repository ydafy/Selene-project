CREATE OR REPLACE FUNCTION public.fn_resolve_shipment_cancellation_review (
  p_shipment_id uuid,
  p_admin_id    uuid,
  p_resolution  text,
  p_note        text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_note TEXT := btrim(p_note);
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_loss BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Defense in depth: the admin id is stored as the decision maker, so it must be an
  -- active admin by the same rule as is_admin(), not only what the caller checked.
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF p_resolution IS NULL OR p_resolution NOT IN ('refund_approved', 'closed_no_refund') THEN
    RAISE EXCEPTION 'INVALID_REVIEW_RESOLUTION';
  END IF;
  IF v_note IS NULL OR v_note = '' OR char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'INVALID_REVIEW_NOTE';
  END IF;

  -- Same lock order as the other cancellation RPCs: shipment first, then the operation.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.review_required_at IS NULL THEN
    RAISE EXCEPTION 'CARRIER_REVIEW_NOT_PENDING';
  END IF;
  IF v_operation.review_resolution IS NOT NULL THEN RAISE EXCEPTION 'CARRIER_REVIEW_ALREADY_RESOLVED'; END IF;
  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_shipment.status IS DISTINCT FROM 'preparing' THEN RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE'; END IF;

  v_loss := CASE
    WHEN p_resolution <> 'refund_approved' OR v_operation.carrier_cancellation_outcome = 'accepted'
      THEN v_operation.label_cost_loss_cents
    ELSE v_shipment.label_provider_cost_cents
  END;

  UPDATE public.shipment_cancellation_operations
    SET review_resolution = p_resolution,
        review_resolved_at = clock_timestamp(),
        review_resolved_by = p_admin_id,
        review_resolution_note = v_note,
        label_cost_loss_cents = v_loss
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;

  RETURN jsonb_build_object(
    'review_resolution', v_operation.review_resolution,
    'review_resolved_at', v_operation.review_resolved_at,
    'review_resolved_by', v_operation.review_resolved_by,
    'review_resolution_note', v_operation.review_resolution_note,
    'label_cost_loss_cents', v_operation.label_cost_loss_cents);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_resolve_shipment_cancellation_review"(uuid, uuid, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_resolve_shipment_cancellation_review"(uuid, uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_resolve_shipment_cancellation_review"(uuid, uuid, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_resolve_shipment_cancellation_review"(uuid, uuid, text, text) FROM PUBLIC, "anon", "authenticated";
