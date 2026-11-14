CREATE TABLE "public"."shipment_tracking_events" (
  "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
  "shipment_id" uuid NOT NULL,
  "dispute_id"  uuid,
  CONSTRAINT "shipment_tracking_events_dispute_id_fkey" FOREIGN KEY (dispute_id) REFERENCES public.disputes(id),
  CONSTRAINT "shipment_tracking_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "shipment_tracking_events_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id)
);

ALTER TABLE "public"."shipment_tracking_events"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."shipment_tracking_events"
  ADD COLUMN "event_type" public.shipment_tracking_event_type NOT NULL;

ALTER TABLE "public"."shipment_tracking_events"
  ADD COLUMN "event_at" timestamp WITH time zone NOT NULL;

ALTER TABLE "public"."shipment_tracking_events"
  ADD COLUMN "received_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."shipment_tracking_events"
  ADD COLUMN "raw_status" text NOT NULL;

ALTER TABLE "public"."shipment_tracking_events"
  ADD COLUMN "location" text;

ALTER TABLE "public"."shipment_tracking_events"
  ADD COLUMN "status_description" text;

ALTER TABLE "public"."shipment_tracking_events"
  ADD COLUMN "carrier_name" text;

ALTER TABLE "public"."shipment_tracking_events"
  ADD COLUMN "webhook_delivery_id" uuid;

ALTER TABLE "public"."shipment_tracking_events"
  ADD COLUMN "polling_run_id" uuid;

ALTER TABLE "public"."shipment_tracking_events"
  ADD CONSTRAINT "shipment_tracking_events_webhook_delivery_id_fkey" FOREIGN KEY (webhook_delivery_id) REFERENCES internal.webhook_deliveries(id);

CREATE UNIQUE INDEX shipment_tracking_events_deduplication_key ON public.shipment_tracking_events USING btree (shipment_id, dispute_id, raw_status, event_at, location) NULLS
  NOT DISTINCT;

CREATE INDEX shipment_tracking_events_dispute_timeline ON public.shipment_tracking_events USING btree (dispute_id, event_at, received_at, id)
  WHERE (dispute_id IS NOT NULL);

CREATE INDEX shipment_tracking_events_shipment_timeline ON public.shipment_tracking_events USING btree (shipment_id, event_at, received_at, id);

CREATE POLICY "shipment tracking events are visible to participants and admins" ON "public"."shipment_tracking_events"
  FOR SELECT
  TO "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM (public.shipments s
     JOIN public.orders o ON ((o.id = s.order_id)))
  WHERE ((s.id = shipment_tracking_events.shipment_id) AND ((o.buyer_id = ( SELECT auth.uid() AS uid)) OR (s.seller_id = ( SELECT auth.uid() AS uid)))))) OR ( SELECT public.is_admin() AS is_admin)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_tracking_events" TO "service_role";

REVOKE ALL ON TABLE "public"."shipment_tracking_events" FROM "authenticated";

GRANT SELECT ON TABLE "public"."shipment_tracking_events" TO "authenticated";

REVOKE ALL ON TABLE "public"."shipment_tracking_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_tracking_events" TO "postgres";

REVOKE ALL ON TABLE "public"."shipment_tracking_events" FROM "anon";
