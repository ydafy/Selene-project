CREATE TABLE "internal"."webhook_deliveries" (
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

ALTER TABLE "internal"."webhook_deliveries"
  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "internal"."webhook_deliveries" IS 'Inbox of provider webhook deliveries, one row per provider and delivery id. Only fn_claim_envia_webhook_delivery and fn_mark_webhook_delivery (SECURITY DEFINER) reach it.';

-- Server-only machinery (odd/tasks/internal-schema.md S3): only SECURITY DEFINER
-- functions owned by postgres read or write it, so no client role and not
-- service_role hold a privilege on it.
REVOKE ALL ON TABLE "internal"."webhook_deliveries" FROM PUBLIC, "anon", "authenticated", "service_role";
