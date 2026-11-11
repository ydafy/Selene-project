CREATE TABLE "public"."system_logs" (
  "id"          uuid                     NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "level"       text                     DEFAULT 'ERROR'::text,
  "message"     text                     NOT NULL,
  "stack_trace" text,
  "user_id"     uuid,
  "created_at"  timestamp with time zone DEFAULT now(),
  "metadata"    jsonb                    DEFAULT '{}'::jsonb,
  CONSTRAINT "system_logs_pkey" PRIMARY KEY (id),
  CONSTRAINT "system_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE "public"."system_logs"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_system_logs_user_id ON public.system_logs USING btree (user_id);

CREATE POLICY "system_logs_insert" ON "public"."system_logs"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));

CREATE POLICY "system_logs_read" ON "public"."system_logs"
  FOR SELECT
  TO PUBLIC
  USING (( SELECT public.is_admin() AS is_admin));

REVOKE ALL ON TABLE "public"."system_logs" FROM "anon", "authenticated";

GRANT INSERT ON TABLE "public"."system_logs" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."system_logs" TO "service_role";

REVOKE ALL ON TABLE "public"."system_logs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."system_logs" TO "postgres";
