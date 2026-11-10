CREATE TABLE "public"."reports" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "reporter_id" uuid                     NOT NULL,
  "target_id"   uuid                     NOT NULL,
  "target_type" text                     NOT NULL,
  "reason"      text,
  "status"      text                     NOT NULL DEFAULT 'pending'::text,
  CONSTRAINT "reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE "public"."reports"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_reports_reporter_id ON public.reports USING btree (reporter_id);

CREATE POLICY "reports_insert" ON "public"."reports"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((( SELECT auth.uid() AS uid) = reporter_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reports" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reports" TO "service_role";

REVOKE ALL ON TABLE "public"."reports" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reports" TO "postgres";
