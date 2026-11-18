CREATE TABLE "public"."reports" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "reporter_id"       uuid                     NOT NULL,
  "target_product_id" uuid,
  "target_user_id"    uuid,
  "reason"            public.report_reason     NOT NULL,
  "details"           text,
  "status"            public.report_status     NOT NULL DEFAULT 'open'::public.report_status,
  "resolved_by"       uuid,
  "resolved_at"       timestamp with time zone,
  "outcome"           public.report_outcome,
  "resolution_note"   text,
  CONSTRAINT "reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT "reports_target_product_id_fkey" FOREIGN KEY (target_product_id) REFERENCES public.products(id) ON DELETE RESTRICT,
  CONSTRAINT "reports_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT "reports_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT "reports_one_target_chk" CHECK ((num_nonnulls(target_product_id, target_user_id) = 1)),
  CONSTRAINT "reports_not_self_chk" CHECK ((target_user_id IS DISTINCT FROM reporter_id)),
  CONSTRAINT "reports_details_length_chk" CHECK ((char_length(details) <= 1000)),
  CONSTRAINT "reports_resolution_chk" CHECK ((
    ((status = 'open'::public.report_status) AND (resolved_by IS NULL) AND (resolved_at IS NULL) AND (outcome IS NULL) AND (resolution_note IS NULL))
    OR ((status = 'resolved'::public.report_status) AND (resolved_by IS NOT NULL) AND (resolved_at IS NOT NULL) AND (outcome IS NOT NULL))
  ))
);

COMMENT ON TABLE "public"."reports" IS 'User reports of a listing or a user (#653). Exactly one target. Users insert only; admins read; the resolution is written once by the admin workflow (#298), and a resolved report never changes (trigger reports_keep_resolved_closed). Kept forever as moderation evidence, so every foreign key is ON DELETE RESTRICT.';

ALTER TABLE "public"."reports"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_reports_reporter_id ON public.reports USING btree (reporter_id);

CREATE INDEX ix_reports_target_product_id ON public.reports USING btree (target_product_id) WHERE (target_product_id IS NOT NULL);

CREATE INDEX ix_reports_target_user_id ON public.reports USING btree (target_user_id) WHERE (target_user_id IS NOT NULL);

CREATE INDEX ix_reports_resolved_by ON public.reports USING btree (resolved_by) WHERE (resolved_by IS NOT NULL);

CREATE INDEX ix_reports_open_created_at ON public.reports USING btree (created_at) WHERE (status = 'open'::public.report_status);

CREATE UNIQUE INDEX ux_reports_open_product ON public.reports USING btree (reporter_id, target_product_id) WHERE ((status = 'open'::public.report_status) AND (target_product_id IS NOT NULL));

CREATE UNIQUE INDEX ux_reports_open_user ON public.reports USING btree (reporter_id, target_user_id) WHERE ((status = 'open'::public.report_status) AND (target_user_id IS NOT NULL));

CREATE TRIGGER reports_keep_resolved_closed
  BEFORE UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_reports_keep_resolved_closed();

CREATE POLICY "reports_insert" ON "public"."reports"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((( SELECT auth.uid() AS uid) = reporter_id) AND ((target_product_id IS NULL) OR (NOT (EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = reports.target_product_id) AND (p.seller_id = ( SELECT auth.uid() AS uid)))))))));

CREATE POLICY "reports_select_admin" ON "public"."reports"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_admin() AS is_admin));

REVOKE ALL ON TABLE "public"."reports" FROM "anon", "authenticated";

GRANT INSERT ("reporter_id", "target_product_id", "target_user_id", "reason", "details") ON TABLE "public"."reports" TO "authenticated";

GRANT SELECT ON TABLE "public"."reports" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reports" TO "service_role";

REVOKE ALL ON TABLE "public"."reports" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reports" TO "postgres";
