-- odd/tasks/reports-data-model.md T1 (S1-S5, S8), #653. A report points at
-- exactly one existing target (target_product_id or target_user_id), has a
-- required reason enum and optional details, and records its resolution
-- (status, resolved_by, resolved_at, outcome, resolution_note). One open
-- report per reporter and target. Clients insert only, through column
-- grants; only admins read (reports_select_admin). Every foreign key is
-- ON DELETE RESTRICT: reports are kept forever as moderation evidence.
-- The existing rows are pre-launch test data (L2): they are deleted, not
-- backfilled, before the polymorphic columns go and reason becomes required.

DELETE FROM public.reports;

DROP POLICY "reports_insert" ON "public"."reports";

ALTER TABLE "public"."reports"
  DROP CONSTRAINT "reports_reporter_id_fkey";

CREATE TYPE "public"."report_outcome" AS ENUM (
  'dismissed',
  'warned',
  'listing_removed',
  'account_suspended'
);

CREATE TYPE "public"."report_reason" AS ENUM (
  'fraud',
  'counterfeit_or_misdescribed',
  'prohibited_item',
  'offensive_content',
  'harassment',
  'spam',
  'other'
);

CREATE TYPE "public"."report_status" AS ENUM (
  'open',
  'resolved'
);

-- reason: pre-launch, test rows deleted, no app reads the old columns after this branch (#653)
-- squawk-ignore ban-drop-column
ALTER TABLE "public"."reports" DROP COLUMN "target_id";

-- reason: pre-launch, test rows deleted, no app reads the old columns after this branch (#653)
-- squawk-ignore ban-drop-column
ALTER TABLE "public"."reports" DROP COLUMN "target_type";

-- The text default 'pending' cannot be cast to the enum; it is replaced below.
-- reason: pre-launch, test rows deleted, no app reads the old columns after this branch (#653)
-- squawk-ignore ban-drop-default
ALTER TABLE "public"."reports" ALTER COLUMN "status" DROP DEFAULT;

-- reason: pre-launch, test rows deleted, no app reads the old columns after this branch (#653)
-- squawk-ignore changing-column-type
ALTER TABLE "public"."reports" ALTER COLUMN "status" TYPE public.report_status USING "status"::public.report_status;

ALTER TABLE "public"."reports"
  ALTER COLUMN "status" SET DEFAULT 'open'::public.report_status;

-- reason: pre-launch, test rows deleted, no app reads the old columns after this branch (#653)
-- squawk-ignore changing-column-type
ALTER TABLE "public"."reports" ALTER COLUMN "reason" TYPE public.report_reason USING "reason"::public.report_reason;

ALTER TABLE "public"."reports"
  ALTER COLUMN "reason" SET NOT NULL;

ALTER TABLE "public"."reports"
  ADD COLUMN "target_product_id" uuid;

ALTER TABLE "public"."reports"
  ADD COLUMN "target_user_id" uuid;

ALTER TABLE "public"."reports"
  ADD COLUMN "details" text;

ALTER TABLE "public"."reports"
  ADD COLUMN "resolved_by" uuid;

ALTER TABLE "public"."reports"
  ADD COLUMN "resolved_at" timestamp WITH time zone;

ALTER TABLE "public"."reports"
  ADD COLUMN "outcome" public.report_outcome;

ALTER TABLE "public"."reports"
  ADD COLUMN "resolution_note" text;

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_details_length_chk" CHECK ((char_length(details) <= 1000));

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_not_self_chk" CHECK ((target_user_id IS DISTINCT FROM reporter_id));

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_one_target_chk" CHECK ((num_nonnulls(target_product_id, target_user_id) = 1));

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_resolution_chk"
    CHECK
    ((((status = 'open'::public.report_status) AND (resolved_by IS NULL) AND (resolved_at IS NULL) AND (outcome IS NULL) AND (resolution_note IS NULL)) OR ((status =
    'resolved'::public.report_status) AND (resolved_by IS NOT NULL) AND (resolved_at IS NOT NULL) AND (outcome IS NOT NULL))));

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_target_product_id_fkey" FOREIGN KEY (target_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE "public"."reports"
  ADD CONSTRAINT "reports_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

CREATE INDEX ix_reports_open_created_at ON public.reports USING btree (created_at)
  WHERE (status = 'open'::public.report_status);

CREATE INDEX ix_reports_resolved_by ON public.reports USING btree (resolved_by)
  WHERE (resolved_by IS NOT NULL);

CREATE INDEX ix_reports_target_product_id ON public.reports USING btree (target_product_id)
  WHERE (target_product_id IS NOT NULL);

CREATE INDEX ix_reports_target_user_id ON public.reports USING btree (target_user_id)
  WHERE (target_user_id IS NOT NULL);

CREATE UNIQUE INDEX ux_reports_open_product ON public.reports USING btree (reporter_id, target_product_id)
  WHERE ((status = 'open'::public.report_status) AND (target_product_id IS NOT NULL));

CREATE UNIQUE INDEX ux_reports_open_user ON public.reports USING btree (reporter_id, target_user_id)
  WHERE ((status = 'open'::public.report_status) AND (target_user_id IS NOT NULL));

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

COMMENT ON TABLE "public"."reports" IS 'User reports of a listing or a user (#653). Exactly one target. Users insert only; admins read; the resolution is written once by the admin workflow (#298). Kept forever as moderation evidence, so every foreign key is ON DELETE RESTRICT.';

-- authenticated: the table-wide INSERT becomes column INSERT on the five
-- fields the app sends; SELECT stays (rows filtered to admins by RLS).
REVOKE ALL ON TABLE "public"."reports" FROM "authenticated";

GRANT INSERT ("reporter_id", "target_product_id", "target_user_id", "reason", "details") ON TABLE "public"."reports" TO "authenticated";

GRANT SELECT ON TABLE "public"."reports" TO "authenticated";
