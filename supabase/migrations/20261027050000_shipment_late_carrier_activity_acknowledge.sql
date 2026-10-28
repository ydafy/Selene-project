-- B5.8b (S8): an admin acknowledges carrier activity recorded after a cancellation refund started.
--
-- The cancellation has already completed (the refund is out); the case only waits for a person to
-- look at the package that moved. Acknowledging it is a record and nothing else:
--   - it never starts, repeats or changes a refund, and never touches Stripe or Envia;
--   - it never changes the shipment, the order or any other column of the operation;
--   - it is idempotent: a repeat returns the stored acknowledgement and changes nothing.
-- The admin id is stored as the reviewer, so it is checked here with the same rule as
-- fn_resolve_shipment_cancellation_review (an active admin in profiles_private, same as is_admin()).
--
-- fn_list_shipment_late_carrier_activity now returns only unacknowledged rows: the admin bucket is a
-- queue of cases that still need a person, like the carrier reviews bucket. The acknowledgement
-- stays on the operation as the audit record. The result columns are unchanged, so the function
-- keeps its signature and grants (restated below).
--
-- Grant review: the new function is SECURITY DEFINER because it writes the operation and reads
-- profiles_private; it is limited to service_role (PUBLIC, anon and authenticated revoked) and
-- checks auth.role() itself. Clients never reach it; the admin Edge Function does, after its own
-- admin check.
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN late_carrier_activity_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN late_carrier_activity_acknowledged_by UUID,
  ADD COLUMN late_carrier_activity_acknowledged_note TEXT,
  ADD CONSTRAINT shipment_cancellation_operations_late_activity_ack_recorded CHECK (
    (late_carrier_activity_acknowledged_at IS NULL) = (late_carrier_activity_acknowledged_by IS NULL)
    AND (late_carrier_activity_acknowledged_at IS NULL) = (late_carrier_activity_acknowledged_note IS NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_late_activity_ack_after_activity CHECK (
    late_carrier_activity_acknowledged_at IS NULL OR late_carrier_activity_at IS NOT NULL
  ),
  ADD CONSTRAINT shipment_cancellation_operations_late_activity_ack_note_format CHECK (
    late_carrier_activity_acknowledged_note IS NULL
    OR (late_carrier_activity_acknowledged_note = btrim(late_carrier_activity_acknowledged_note)
        AND char_length(late_carrier_activity_acknowledged_note) BETWEEN 1 AND 200)
  );

COMMENT ON COLUMN public.shipment_cancellation_operations.late_carrier_activity_acknowledged_at IS
  'When an admin acknowledged the carrier activity recorded after the refund started. Set once by fn_acknowledge_shipment_late_carrier_activity; NULL together with the by and note columns.';
COMMENT ON COLUMN public.shipment_cancellation_operations.late_carrier_activity_acknowledged_by IS
  'Admin profile that acknowledged it. Kept together with late_carrier_activity_acknowledged_at.';
COMMENT ON COLUMN public.shipment_cancellation_operations.late_carrier_activity_acknowledged_note IS
  'Admin-provided note, 1-200 characters, trimmed. Kept together with late_carrier_activity_acknowledged_at.';

-- Unacknowledged cancellations whose shipment saw carrier activity after the refund started,
-- oldest first. Read-only; the review of the package itself is manual. A TABLE keeps the columns typed.
CREATE OR REPLACE FUNCTION public.fn_list_shipment_late_carrier_activity()
RETURNS TABLE (
  shipment_id UUID,
  order_id UUID,
  seller_id UUID,
  tracking_number TEXT,
  carrier TEXT,
  shipment_status public.order_status_enum,
  source TEXT,
  refund_status TEXT,
  late_carrier_activity_at TIMESTAMPTZ,
  late_carrier_activity_event_type public.shipment_tracking_event_type
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  RETURN QUERY
  SELECT o.shipment_id, o.order_id, s.seller_id, s.tracking_number, s.carrier, s.status,
         o.source, o.refund_status, o.late_carrier_activity_at, o.late_carrier_activity_event_type
  FROM public.shipment_cancellation_operations o
  JOIN public.shipments s ON s.id = o.shipment_id
  WHERE o.late_carrier_activity_at IS NOT NULL
    AND o.late_carrier_activity_acknowledged_at IS NULL
  ORDER BY o.late_carrier_activity_at ASC, o.shipment_id ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_list_shipment_late_carrier_activity() IS
  'Service-only (SECURITY DEFINER): cancellations whose shipment saw a carrier scan after the refund started and that no admin has acknowledged yet, oldest first. Read-only.';

REVOKE EXECUTE ON FUNCTION public.fn_list_shipment_late_carrier_activity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_shipment_late_carrier_activity() TO service_role;

-- Records that an admin looked at the case. Writes only the three acknowledgement columns, once.
-- Locks the operation row only (never the shipment), so it cannot wait on or block a cancellation
-- step that holds the shipment; the other RPCs lock shipment then operation, so no lock cycle.
CREATE OR REPLACE FUNCTION public.fn_acknowledge_shipment_late_carrier_activity(
  p_shipment_id UUID,
  p_admin_id UUID,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.fn_acknowledge_shipment_late_carrier_activity(UUID, UUID, TEXT) IS
  'Service-only (SECURITY DEFINER): an active admin acknowledges carrier activity recorded after the cancellation refund started. Writes only the acknowledgement columns, once; a repeat returns the stored acknowledgement. Moves no money and changes no shipment or order.';

REVOKE EXECUTE ON FUNCTION public.fn_acknowledge_shipment_late_carrier_activity(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acknowledge_shipment_late_carrier_activity(UUID, UUID, TEXT) TO service_role;

COMMIT;
