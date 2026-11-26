-- reason: pre-launch, no installed app reads these products columns; every verification attempt now lives in product_verifications (#651)
-- squawk-ignore-file ban-drop-column

DROP POLICY "products_insert" ON "public"."products";

DROP POLICY "products_update_owner_or_admin" ON "public"."products";

DROP INDEX "public"."ix_products_locked_by";

ALTER TABLE "public"."products"
  DROP CONSTRAINT "products_locked_by_fkey";

ALTER TABLE "public"."products"
  DROP COLUMN "locked_at";

ALTER TABLE "public"."products"
  DROP COLUMN "locked_by";

ALTER TABLE "public"."products"
  DROP COLUMN "rejection_reason";

ALTER TABLE "public"."products"
  DROP COLUMN "verification_data";

ALTER TABLE "public"."products"
  DROP COLUMN "verified_at";

CREATE POLICY "products_insert" ON "public"."products"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((( SELECT auth.uid() AS uid) = seller_id) AND (status = 'pending_verification'::public.product_status) AND (deleted_at IS NULL) AND (reserved_at IS NULL) AND
    (status_before_account_hold IS NULL) AND ( SELECT public.fn_current_account_is_active() AS fn_current_account_is_active)));

CREATE POLICY "products_update_owner_or_admin" ON "public"."products"
  FOR UPDATE
  TO "authenticated"
  USING
    ((( SELECT public.is_admin() AS is_admin) OR ((seller_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL) AND (status = ANY
    (ARRAY['pending_verification'::public.product_status, 'verified'::public.product_status, 'hidden'::public.product_status, 'rejected'::public.product_status])) AND
    ( SELECT public.fn_current_account_is_active() AS fn_current_account_is_active))))
  WITH
    CHECK
    ((( SELECT public.is_admin() AS is_admin) OR ((seller_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['pending_verification'::public.product_status,
    'verified'::public.product_status,
    'hidden'::public.product_status])) AND (status_before_account_hold IS NULL) AND ( SELECT public.fn_current_account_is_active() AS fn_current_account_is_active))));
