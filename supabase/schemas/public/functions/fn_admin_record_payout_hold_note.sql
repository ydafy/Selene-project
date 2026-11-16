CREATE OR REPLACE FUNCTION public.fn_admin_record_payout_hold_note (
  p_admin_id    uuid,
  p_shipment_id uuid,
  p_note        text
)
  RETURNS public.shipment_payout_hold_notes
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  v_note TEXT := btrim(p_note, E' \t\n\r');
  v_held RECORD;
  v_row public.shipment_payout_hold_notes%ROWTYPE;
BEGIN
  -- Defense in depth: the admin id is written to the note and the audit log, so
  -- it must be an active admin by the same rule as is_admin(), not only what
  -- the caller checked.
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF v_note IS NULL OR char_length(v_note) < 1 OR char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'INVALID_HOLD_NOTE';
  END IF;

  -- Shipment first, the lock order of the cancellation and transfer paths.
  PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  SELECT v.is_payout_overdue, v.seller_payout_block_reason, v.days_since_completed
    INTO v_held
    FROM public.admin_connect_payout_release_view v
    WHERE v.shipment_id = p_shipment_id;
  IF v_held.is_payout_overdue IS NOT TRUE THEN
    RAISE EXCEPTION 'PAYOUT_NOT_OVERDUE';
  END IF;

  INSERT INTO public.shipment_payout_hold_notes (shipment_id, admin_id, note, created_at)
  VALUES (p_shipment_id, p_admin_id, v_note, clock_timestamp())
  RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (p_admin_id, 'PAYOUT_HOLD_NOTED', p_shipment_id,
    jsonb_build_object(
      'note_id', v_row.id,
      'note', v_row.note,
      'seller_payout_block_reason', v_held.seller_payout_block_reason,
      'days_since_completed', v_held.days_since_completed));

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) IS 'Service-only (SECURITY INVOKER; EXECUTE revoked from PUBLIC, anon and authenticated because the admin id is trusted only from an Edge Function that verified the admin session): an active admin keeps an overdue held payout on hold with a note (#549). Locks the shipment, refuses a shipment that is not overdue in admin_connect_payout_release_view, and writes the note and a PAYOUT_HOLD_NOTED audit row.';

REVOKE ALL ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) FROM PUBLIC, "anon", "authenticated";
