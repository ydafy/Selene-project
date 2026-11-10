CREATE TABLE "public"."admin_audit_logs" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "admin_id"    uuid,
  "action_type" text                     NOT NULL,
  "target_id"   uuid,
  "details"     jsonb,
  "created_at"  timestamp with time zone DEFAULT now(),
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY (id),
  CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY (admin_id) REFERENCES public.profiles(id)
);

ALTER TABLE "public"."admin_audit_logs"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_admin_audit_logs_admin_id ON public.admin_audit_logs USING btree (admin_id);

CREATE POLICY "admin_audit_logs_read" ON "public"."admin_audit_logs"
  FOR SELECT
  TO PUBLIC
  USING (( SELECT public.is_admin() AS is_admin));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_audit_logs" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_audit_logs" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_audit_logs" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_audit_logs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_audit_logs" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_audit_logs" FROM "anon";
