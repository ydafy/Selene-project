-- B5.8: the canonical fn_record_tracking_event. Requires shipment_cancellation_late_carrier_activity.sql first
-- (the late_carrier_activity_* columns). Apply the matching migration OR this identical canonical copy, not both.
CREATE OR REPLACE FUNCTION public.fn_record_tracking_event(p_shipment_id uuid, p_dispute_id uuid, p_event_type public.shipment_tracking_event_type, p_event_at timestamp with time zone, p_raw_status text, p_location text, p_status_description text, p_carrier_name text, p_webhook_delivery_id uuid, p_polling_run_id uuid, p_transition public.order_status_enum)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_status public.order_status_enum;
  v_event_id UUID;
  v_refund_started BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT status INTO v_status FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;

  -- A started cancellation operation means a refund was requested: the shipment must end
  -- cancelled, so no scan moves its status. Same predicate as fn_begin_shipment_transfer,
  -- read after the shipment lock.
  SELECT EXISTS (
    SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id AND external_started_at IS NOT NULL
  ) INTO v_refund_started;

  INSERT INTO public.shipment_tracking_events (
    shipment_id,
    dispute_id,
    event_type,
    event_at,
    raw_status,
    location,
    status_description,
    carrier_name,
    webhook_delivery_id,
    polling_run_id
  ) VALUES (
    p_shipment_id,
    p_dispute_id,
    p_event_type,
    p_event_at,
    p_raw_status,
    p_location,
    p_status_description,
    p_carrier_name,
    p_webhook_delivery_id,
    p_polling_run_id
  ) ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'shipment_status', v_status);
  END IF;

  IF p_dispute_id IS NULL AND v_refund_started THEN
    -- No status change. The first scan that would have moved the shipment is recorded once on
    -- the operation so an admin can review the package that moved.
    IF v_status IN ('preparing', 'shipped') AND p_transition IN ('shipped', 'delivered') THEN
      UPDATE public.shipment_cancellation_operations
      SET late_carrier_activity_at = clock_timestamp(),
          late_carrier_activity_event_type = p_event_type
      WHERE shipment_id = p_shipment_id AND late_carrier_activity_at IS NULL;
    END IF;
  ELSIF p_dispute_id IS NULL AND v_status = 'preparing' AND p_transition = 'shipped' THEN
    UPDATE public.shipments
    SET status = 'shipped', shipped_at = p_event_at, updated_at = now()
    WHERE id = p_shipment_id;
    v_status := 'shipped';
  ELSIF p_dispute_id IS NULL AND v_status = 'shipped' AND p_transition = 'delivered' THEN
    UPDATE public.shipments
    SET status = 'delivered', delivered_at = p_event_at, updated_at = now()
    WHERE id = p_shipment_id;
    v_status := 'delivered';
  ELSIF v_status = 'cancelled' THEN
    NULL;
  END IF;

  RETURN jsonb_build_object('inserted', true, 'event_id', v_event_id, 'shipment_status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_tracking_event(uuid, uuid, public.shipment_tracking_event_type, timestamp with time zone, text, text, text, text, uuid, uuid, public.order_status_enum) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_tracking_event(uuid, uuid, public.shipment_tracking_event_type, timestamp with time zone, text, text, text, text, uuid, uuid, public.order_status_enum) TO service_role;
