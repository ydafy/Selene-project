ALTER TABLE "public"."reviews"
  DROP CONSTRAINT "reviews_reviewer_id_product_id_key";

ALTER TABLE "public"."reviews"
  DROP CONSTRAINT "reviews_reviewer_shipment_product_unique";

ALTER TABLE "public"."reviews"
  ALTER COLUMN "shipment_id" SET NOT NULL;

ALTER TABLE "public"."reviews"
  ADD CONSTRAINT "reviews_reviewer_id_shipment_id_key" UNIQUE (reviewer_id, shipment_id);

CREATE UNIQUE INDEX addresses_one_default_per_user_idx ON public.addresses USING btree (user_id)
  WHERE (is_default AND (deleted_at IS NULL));
