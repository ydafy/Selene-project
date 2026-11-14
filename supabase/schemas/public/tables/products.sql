CREATE TABLE "public"."products" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "name"        text                     NOT NULL,
  "description" text                     NOT NULL,
  "price_cents" bigint                   NOT NULL,
  "category"    text                     NOT NULL,
  "condition"   text                     NOT NULL,
  "usage"       text                     NOT NULL,
  "images"      text[]                   NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT "products_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."products"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."products"
  ADD COLUMN "status" public.product_status_enum NOT NULL DEFAULT 'PENDING_VERIFICATION'::public.product_status_enum;

ALTER TABLE "public"."products"
  ADD COLUMN "specifications" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "public"."products"
  ADD COLUMN "seller_id" uuid NOT NULL;

ALTER TABLE "public"."products"
  ADD COLUMN "views" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."products"
  ADD COLUMN "aspect_ratio" double precision NOT NULL DEFAULT 1.0;

ALTER TABLE "public"."products"
  ADD COLUMN "verification_data" jsonb;

ALTER TABLE "public"."products"
  ADD COLUMN "rejection_reason" text;

ALTER TABLE "public"."products"
  ADD COLUMN "shipping_cost_cents" bigint NOT NULL DEFAULT 0;

ALTER TABLE "public"."products"
  ADD COLUMN "shipping_payer" text DEFAULT 'buyer'::text;

ALTER TABLE "public"."products"
  ADD COLUMN "origin_zip" text;

ALTER TABLE "public"."products"
  ADD COLUMN "package_preset" text;

ALTER TABLE "public"."products"
  ADD COLUMN "updated_at" timestamp WITH time zone DEFAULT now();

ALTER TABLE "public"."products"
  ADD COLUMN "reserved_at" timestamp WITH time zone;

ALTER TABLE "public"."products"
  ADD COLUMN "verified_at" timestamp WITH time zone;

ALTER TABLE "public"."products"
  ADD COLUMN "locked_by" uuid;

ALTER TABLE "public"."products"
  ADD COLUMN "locked_at" timestamp WITH time zone;

ALTER TABLE "public"."products"
  ADD COLUMN "fts" tsvector;

ALTER TABLE "public"."products"
  ADD COLUMN "deleted_at" timestamp WITH time zone;

ALTER TABLE "public"."products"
  ADD COLUMN "publication_shipping_reserve_cents" bigint;

ALTER TABLE "public"."products"
  ADD COLUMN "publication_commission_rate" numeric(5,4);

ALTER TABLE "public"."products"
  ADD COLUMN "publication_insurance_rate" numeric(5,4);

ALTER TABLE "public"."products"
  ADD COLUMN "status_before_account_hold" public.product_status_enum;

ALTER TABLE "public"."products"
  ADD CONSTRAINT "product_publication_economics_snapshot_check"
    CHECK
    ((((publication_shipping_reserve_cents IS NULL) AND (publication_commission_rate IS NULL) AND (publication_insurance_rate IS NULL)) OR ((publication_shipping_reserve_cents >=
    0) AND (publication_commission_rate >= (0)::numeric) AND (publication_commission_rate <= (1)::numeric) AND (publication_insurance_rate >= (0)::numeric) AND
    (publication_insurance_rate <= (1)::numeric))));

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_price_cents_check" CHECK (((price_cents >= 1000) AND (price_cents <= 50000000)));

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_shipping_cost_cents_check" CHECK ((shipping_cost_cents >= 0));

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES public.profiles(id);

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX idx_products_fts ON public.products USING gin (fts);

CREATE INDEX idx_products_reserved_status_reserved_at ON public.products USING btree (status, reserved_at)
  WHERE (status = 'RESERVED'::public.product_status_enum);

CREATE INDEX idx_products_specifications ON public.products USING gin (specifications);

CREATE INDEX ix_products_locked_by ON public.products USING btree (locked_by);

CREATE INDEX ix_products_seller_id ON public.products USING btree (seller_id);

CREATE TRIGGER tr_product_fts_update
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_product_fts();

CREATE TRIGGER tr_product_verified_edit_guard
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_owner_verified_edit();

CREATE TRIGGER trg_product_available_on_verify
  AFTER UPDATE OF status ON public.products
  FOR EACH ROW
  WHEN
    (((old.status = ANY (ARRAY['PENDING_VERIFICATION'::public.product_status_enum, 'IN_REVIEW'::public.product_status_enum])) AND (new.status =
    'VERIFIED'::public.product_status_enum)))
  EXECUTE FUNCTION public.fn_tr_product_available_on_verify();

CREATE TRIGGER validate_product_publication_economics
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_product_publication_economics();

CREATE POLICY "products_delete_block" ON "public"."products"
  FOR DELETE
  TO PUBLIC
  USING (false);

CREATE POLICY "products_insert" ON "public"."products"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((( SELECT auth.uid() AS uid) = seller_id) AND (status = 'PENDING_VERIFICATION'::public.product_status_enum) AND (verified_at IS NULL) AND (deleted_at IS NULL) AND
    (reserved_at IS NULL) AND (locked_by IS NULL) AND (status_before_account_hold IS NULL) AND ( SELECT public.fn_current_account_is_active() AS fn_current_account_is_active)));

CREATE POLICY "products_select_owner_or_admin" ON "public"."products"
  FOR SELECT
  TO "authenticated"
  USING (((seller_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

CREATE POLICY "products_update_owner_or_admin" ON "public"."products"
  FOR UPDATE
  TO "authenticated"
  USING
    ((( SELECT public.is_admin() AS is_admin) OR ((seller_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL) AND (status = ANY (ARRAY['PENDING_VERIFICATION'::public.product_status_enum,
    'VERIFIED'::public.product_status_enum,
    'HIDDEN'::public.product_status_enum, 'REJECTED'::public.product_status_enum])) AND ( SELECT public.fn_current_account_is_active() AS fn_current_account_is_active))))
  WITH
    CHECK
    ((( SELECT public.is_admin() AS is_admin) OR ((seller_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['PENDING_VERIFICATION'::public.product_status_enum, 'VERIFIED'::public.product_status_enum,
    'HIDDEN'::public.product_status_enum,
    'IN_REVIEW'::public.product_status_enum])) AND (status_before_account_hold IS NULL) AND ( SELECT public.fn_current_account_is_active() AS fn_current_account_is_active))));

REVOKE ALL ON TABLE "public"."products" FROM "anon", "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."products" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."products" TO "service_role";

COMMENT ON COLUMN "public"."products"."status_before_account_hold" IS 'Listing status captured when the seller account was suspended or banned; restored and cleared when a suspension is lifted. NULL means no account hold is tracked.';

REVOKE ALL ON TABLE "public"."products" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."products" TO "postgres";
