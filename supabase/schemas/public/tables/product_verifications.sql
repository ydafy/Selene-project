CREATE TABLE "public"."product_verifications" (
  "id"              uuid                                 NOT NULL DEFAULT gen_random_uuid(),
  "product_id"      uuid                                 NOT NULL,
  "submitted_by"    uuid                                 NOT NULL,
  "submitted_at"    timestamp with time zone             NOT NULL DEFAULT now(),
  "benchmark_score" integer,
  "decision"        public.product_verification_decision,
  "decided_by"      uuid,
  "decided_at"      timestamp with time zone,
  "public_note"     text,
  "private_note_id" uuid,
  "locked_by"       uuid,
  "locked_at"       timestamp with time zone,
  CONSTRAINT "product_verifications_pkey" PRIMARY KEY (id),
  CONSTRAINT "product_verifications_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT,
  CONSTRAINT "product_verifications_submitted_by_fkey" FOREIGN KEY (submitted_by) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT "product_verifications_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT "product_verifications_private_note_id_fkey" FOREIGN KEY (private_note_id) REFERENCES public.admin_user_notes(id) ON DELETE RESTRICT,
  CONSTRAINT "product_verifications_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT "product_verifications_benchmark_score_chk" CHECK ((benchmark_score >= 0)),
  CONSTRAINT "product_verifications_decision_chk" CHECK ((num_nonnulls(decision, decided_by, decided_at) = ANY (ARRAY[0, 3]))),
  CONSTRAINT "product_verifications_public_note_chk" CHECK (((public_note IS NULL) OR (btrim(public_note) <> ''::text))),
  CONSTRAINT "product_verifications_rejection_note_chk" CHECK (((decision IS DISTINCT FROM 'rejected'::public.product_verification_decision) OR (public_note IS NOT NULL))),
  CONSTRAINT "product_verifications_notes_decided_chk" CHECK (((decision IS NOT NULL) OR ((public_note IS NULL) AND (private_note_id IS NULL)))),
  CONSTRAINT "product_verifications_lock_chk" CHECK (((locked_by IS NULL) = (locked_at IS NULL))),
  CONSTRAINT "product_verifications_lock_open_chk" CHECK (((decision IS NULL) OR (locked_by IS NULL)))
);

COMMENT ON TABLE "public"."product_verifications" IS 'One row per verification submission of a listing (#651): what the seller submitted and, once decided, the decision, the reviewer and the notes. Written only by fn_submit_product_verification and the admin lock and verdict RPCs; one open attempt per listing; a decided attempt never changes (trigger product_verifications_keep_decided_closed). The review lock lives on the open attempt. Retention (#450): kept forever as verification evidence, so every foreign key is ON DELETE RESTRICT.';

ALTER TABLE "public"."product_verifications"
  ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX ux_product_verifications_open_product ON public.product_verifications USING btree (product_id) WHERE (decision IS NULL);

CREATE INDEX ix_product_verifications_product_submitted_at ON public.product_verifications USING btree (product_id, submitted_at DESC);

CREATE INDEX ix_product_verifications_open_submitted_at ON public.product_verifications USING btree (submitted_at) WHERE (decision IS NULL);

CREATE INDEX ix_product_verifications_submitted_by ON public.product_verifications USING btree (submitted_by);

CREATE INDEX ix_product_verifications_decided_by ON public.product_verifications USING btree (decided_by) WHERE (decided_by IS NOT NULL);

CREATE INDEX ix_product_verifications_private_note_id ON public.product_verifications USING btree (private_note_id) WHERE (private_note_id IS NOT NULL);

CREATE INDEX ix_product_verifications_locked_by ON public.product_verifications USING btree (locked_by) WHERE (locked_by IS NOT NULL);

CREATE TRIGGER product_verifications_keep_decided_closed
  BEFORE UPDATE ON public.product_verifications
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_product_verifications_keep_decided_closed();

CREATE POLICY "product_verifications_select_owner_or_admin" ON "public"."product_verifications"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_verifications.product_id) AND (p.seller_id = ( SELECT auth.uid() AS uid)))))));

REVOKE ALL ON TABLE "public"."product_verifications" FROM "anon", "authenticated";

GRANT SELECT ON TABLE "public"."product_verifications" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_verifications" TO "service_role";

REVOKE ALL ON TABLE "public"."product_verifications" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_verifications" TO "postgres";
