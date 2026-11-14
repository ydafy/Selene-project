CREATE TABLE "public"."webhook_dlq" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_type"    text                     DEFAULT 'unknown'::text,
  "payload"       jsonb                    NOT NULL,
  "error_message" text                     NOT NULL,
  "resolved"      boolean                  DEFAULT false,
  "created_at"    timestamp with time zone DEFAULT now(),
  "resolved_at"   timestamp with time zone,
  "resolved_by"   uuid,
  CONSTRAINT "webhook_dlq_pkey" PRIMARY KEY (id),
  CONSTRAINT "webhook_dlq_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE "public"."webhook_dlq"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_webhook_dlq_event_type ON public.webhook_dlq USING btree (event_type);

CREATE INDEX idx_webhook_dlq_resolved ON public.webhook_dlq USING btree (resolved)
  WHERE (resolved = false);

CREATE INDEX ix_webhook_dlq_resolved_by ON public.webhook_dlq USING btree (resolved_by);

CREATE POLICY "dlq_admin_select" ON "public"."webhook_dlq"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_admin() AS is_admin));

REVOKE ALL ON TABLE "public"."webhook_dlq" FROM "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."webhook_dlq" TO "service_role";

REVOKE ALL ON TABLE "public"."webhook_dlq" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."webhook_dlq" TO "postgres";
