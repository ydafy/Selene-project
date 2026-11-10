CREATE TABLE "public"."shipment_label_events" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "shipment_id" uuid                     NOT NULL,
  "event_type"  text                     NOT NULL,
  "actor_id"    uuid,
  "metadata"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_label_events_event_type_check"
    CHECK ((event_type = ANY (ARRAY['claimed'::text, 'sent'::text, 'rejected'::text, 'orphaned'::text, 'generated'::text, 'reconciled'::text, 'released'::text]))),
  CONSTRAINT "shipment_label_events_metadata_check"
    CHECK
    ((NOT (metadata ?| ARRAY['name'::text, 'phone'::text, 'street'::text, 'number'::text, 'district'::text, 'label_url'::text, 'raw_provider_response'::text, 'token'::text,
    'authorization'::text]))),
  CONSTRAINT "shipment_label_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "shipment_label_events_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id)
);

ALTER TABLE "public"."shipment_label_events"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipment label events are append-only" ON "public"."shipment_label_events"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_label_events" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_label_events" TO "service_role";

REVOKE ALL ON TABLE "public"."shipment_label_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_label_events" TO "postgres";
