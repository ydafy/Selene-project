BEGIN;

CREATE TYPE public.shipment_tracking_event_type AS ENUM (
  'created',
  'information',
  'in_transit',
  'delivered',
  'exception',
  'returned'
);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'received' CHECK (state IN ('received', 'processed', 'failed')),
  error_code TEXT,
  UNIQUE (provider, delivery_id)
);

CREATE TABLE IF NOT EXISTS public.shipment_tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id),
  dispute_id UUID REFERENCES public.disputes(id),
  event_type public.shipment_tracking_event_type NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_status TEXT NOT NULL,
  location TEXT,
  status_description TEXT,
  carrier_name TEXT,
  webhook_delivery_id UUID REFERENCES public.webhook_deliveries(id),
  polling_run_id UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS shipment_tracking_events_deduplication_key
  ON public.shipment_tracking_events (
    shipment_id,
    dispute_id,
    raw_status,
    event_at,
    location
  ) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS shipment_tracking_events_shipment_timeline
  ON public.shipment_tracking_events (shipment_id, event_at, received_at, id);

CREATE INDEX IF NOT EXISTS shipment_tracking_events_dispute_timeline
  ON public.shipment_tracking_events (dispute_id, event_at, received_at, id)
  WHERE dispute_id IS NOT NULL;

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_tracking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipment tracking events are visible to participants and admins"
  ON public.shipment_tracking_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.shipments s
      JOIN public.orders o ON o.id = s.order_id
      WHERE s.id = shipment_tracking_events.shipment_id
        AND (o.buyer_id = auth.uid() OR s.seller_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles_private pp
      WHERE pp.id = auth.uid()
        AND pp.role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION public.fn_record_tracking_event(
  p_shipment_id UUID,
  p_dispute_id UUID,
  p_event_type public.shipment_tracking_event_type,
  p_event_at TIMESTAMPTZ,
  p_raw_status TEXT,
  p_location TEXT,
  p_status_description TEXT,
  p_carrier_name TEXT,
  p_webhook_delivery_id UUID,
  p_polling_run_id UUID,
  p_transition public.order_status_enum
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status public.order_status_enum;
  v_event_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT status INTO v_status FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;

  INSERT INTO public.shipment_tracking_events (
    shipment_id, dispute_id, event_type, event_at, raw_status, location,
    status_description, carrier_name, webhook_delivery_id, polling_run_id
  ) VALUES (
    p_shipment_id, p_dispute_id, p_event_type, p_event_at, p_raw_status,
    p_location, p_status_description, p_carrier_name, p_webhook_delivery_id,
    p_polling_run_id
  ) ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'shipment_status', v_status);
  END IF;

  IF p_dispute_id IS NULL AND v_status = 'preparing' AND p_transition = 'shipped' THEN
    UPDATE public.shipments SET status = 'shipped', shipped_at = p_event_at, updated_at = now()
    WHERE id = p_shipment_id;
    v_status := 'shipped';
  ELSIF p_dispute_id IS NULL AND v_status = 'shipped' AND p_transition = 'delivered' THEN
    UPDATE public.shipments SET status = 'delivered', delivered_at = p_event_at, updated_at = now()
    WHERE id = p_shipment_id;
    v_status := 'delivered';
  ELSIF v_status = 'cancelled' THEN
    NULL;
  END IF;

  RETURN jsonb_build_object('inserted', true, 'event_id', v_event_id, 'shipment_status', v_status);
END;
$$;

REVOKE ALL ON TABLE public.webhook_deliveries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.shipment_tracking_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shipment_tracking_events TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_record_tracking_event(
  UUID, UUID, public.shipment_tracking_event_type, TIMESTAMPTZ, TEXT, TEXT,
  TEXT, TEXT, UUID, UUID, public.order_status_enum
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_tracking_event(
  UUID, UUID, public.shipment_tracking_event_type, TIMESTAMPTZ, TEXT, TEXT,
  TEXT, TEXT, UUID, UUID, public.order_status_enum
) TO service_role;

COMMIT;
