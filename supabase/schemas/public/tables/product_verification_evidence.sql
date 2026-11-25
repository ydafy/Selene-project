CREATE TABLE "public"."product_verification_evidence" (
  "id"              uuid                              NOT NULL DEFAULT gen_random_uuid(),
  "verification_id" uuid                              NOT NULL,
  "kind"            public.verification_evidence_kind NOT NULL,
  "storage_path"    text                              NOT NULL,
  "created_at"      timestamp with time zone          NOT NULL DEFAULT now(),
  CONSTRAINT "product_verification_evidence_pkey" PRIMARY KEY (id),
  CONSTRAINT "product_verification_evidence_verification_id_fkey" FOREIGN KEY (verification_id) REFERENCES public.product_verifications(id) ON DELETE RESTRICT,
  CONSTRAINT "product_verification_evidence_storage_path_chk" CHECK ((btrim(storage_path) <> ''::text)),
  CONSTRAINT "product_verification_evidence_verification_id_storage_path_key" UNIQUE (verification_id, storage_path)
);

COMMENT ON TABLE "public"."product_verification_evidence" IS 'One row per proof of a verification attempt (#651): its kind and its object path in bucket verification (<product_id>/<file>). A proof the seller did not change is a new row with the same path; storage objects are never overwritten. Written only by fn_submit_product_verification. Retention (#450): kept forever as verification evidence, so its foreign key is ON DELETE RESTRICT.';

ALTER TABLE "public"."product_verification_evidence"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_verification_evidence_select_owner_or_admin" ON "public"."product_verification_evidence"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1
   FROM (public.product_verifications v
     JOIN public.products p ON ((p.id = v.product_id)))
  WHERE ((v.id = product_verification_evidence.verification_id) AND (p.seller_id = ( SELECT auth.uid() AS uid)))))));

REVOKE ALL ON TABLE "public"."product_verification_evidence" FROM "anon", "authenticated";

GRANT SELECT ON TABLE "public"."product_verification_evidence" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_verification_evidence" TO "service_role";

REVOKE ALL ON TABLE "public"."product_verification_evidence" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_verification_evidence" TO "postgres";
