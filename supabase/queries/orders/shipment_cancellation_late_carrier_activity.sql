-- B5.8: carrier activity after a cancellation refund started. Records the first such scan on the operation
-- (written by fn_record_tracking_event) and lists them for an admin. Moves no money, changes no shipment.
-- Apply the matching migration OR this identical canonical copy, not both.
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN late_carrier_activity_at TIMESTAMPTZ,
  ADD COLUMN late_carrier_activity_event_type public.shipment_tracking_event_type,
  ADD CONSTRAINT shipment_cancellation_operations_late_activity_recorded CHECK (
    (late_carrier_activity_at IS NULL) = (late_carrier_activity_event_type IS NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_late_activity_after_start CHECK (
    late_carrier_activity_at IS NULL OR external_started_at IS NOT NULL
  );

COMMENT ON COLUMN public.shipment_cancellation_operations.late_carrier_activity_at IS
  'When the first carrier scan that would have advanced the shipment arrived after the refund started. Set once by fn_record_tracking_event; NULL together with late_carrier_activity_event_type. The shipment status is not changed by the scan.';
COMMENT ON COLUMN public.shipment_cancellation_operations.late_carrier_activity_event_type IS
  'Event type of that first scan. Kept together with late_carrier_activity_at.';

-- Cancellations whose shipment saw carrier activity after the refund started, oldest first.
-- Read-only; the review of the package itself is manual. A TABLE keeps the columns typed.
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
  ORDER BY o.late_carrier_activity_at ASC, o.shipment_id ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_list_shipment_late_carrier_activity() IS
  'Service-only (SECURITY DEFINER): cancellations whose shipment saw a carrier scan after the refund started, oldest first. Read-only.';

REVOKE EXECUTE ON FUNCTION public.fn_list_shipment_late_carrier_activity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_shipment_late_carrier_activity() TO service_role;

COMMIT;
