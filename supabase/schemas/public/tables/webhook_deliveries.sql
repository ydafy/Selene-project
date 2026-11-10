CREATE TABLE "public"."webhook_deliveries" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "provider"       text                     NOT NULL,
  "delivery_id"    text                     NOT NULL,
  "event_name"     text                     NOT NULL,
  "payload_sha256" text                     NOT NULL,
  "received_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at"   timestamp with time zone,
  "state"          text                     NOT NULL DEFAULT 'received'::text,
  "error_code"     text,
  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY (id),
  CONSTRAINT "webhook_deliveries_provider_delivery_id_key" UNIQUE (PROVIDER, delivery_id),
  CONSTRAINT "webhook_deliveries_state_check" CHECK ((state = ANY (ARRAY['received'::text, 'processed'::text, 'failed'::text])))
);

ALTER TABLE "public"."webhook_deliveries"
  ENABLE ROW LEVEL SECURITY;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."webhook_deliveries" TO "service_role";

REVOKE ALL ON TABLE "public"."webhook_deliveries" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."webhook_deliveries" TO "postgres";

REVOKE ALL ON TABLE "public"."webhook_deliveries" FROM "anon", "authenticated";
