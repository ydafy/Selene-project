ALTER TABLE "public"."addresses"
  ALTER COLUMN "is_default" SET NOT NULL;

ALTER TABLE "public"."admin_audit_logs"
  ALTER COLUMN "admin_id" SET NOT NULL;

ALTER TABLE "public"."admin_audit_logs"
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "public"."admin_user_notes"
  ALTER COLUMN "admin_id" SET NOT NULL;

ALTER TABLE "public"."admin_user_notes"
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "public"."admin_user_notes"
  ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "public"."category_configurations"
  ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "public"."notifications"
  ALTER COLUMN "read" SET NOT NULL;

ALTER TABLE "public"."notifications"
  ALTER COLUMN "type" SET NOT NULL;

ALTER TABLE "public"."products"
  ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "public"."profiles"
  ALTER COLUMN "is_verified_seller" SET NOT NULL;

ALTER TABLE "public"."profiles"
  ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "public"."webhook_dlq"
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "public"."webhook_dlq"
  ALTER COLUMN "event_type" SET NOT NULL;

ALTER TABLE "public"."webhook_dlq"
  ALTER COLUMN "resolved" SET NOT NULL;

ALTER TABLE "internal"."connect_account_actionability"
  ADD CONSTRAINT "connect_account_actionability_current_mxn_default_count_check" CHECK ((current_mxn_default_count >= 0));

ALTER TABLE "public"."addresses"
  ADD CONSTRAINT "addresses_country_check" CHECK ((country = 'MX'::text));

ALTER TABLE "public"."addresses"
  ADD CONSTRAINT "addresses_zip_code_check" CHECK (((zip_code ~ '^[0-9]{5}$'::text) OR ((deleted_at IS NOT NULL) AND (zip_code = ''::text))));

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_aspect_ratio_check" CHECK ((aspect_ratio > (0)::double precision));

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_origin_zip_check" CHECK ((origin_zip ~ '^[0-9]{5}$'::text));

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_views_check" CHECK ((views >= 0));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_average_rating_check" CHECK (((average_rating >= (0)::numeric) AND (average_rating <= (5)::numeric)));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_total_reviews_check" CHECK ((total_reviews >= 0));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_total_sales_check" CHECK ((total_sales >= 0));

ALTER TABLE "public"."push_deliveries"
  ADD CONSTRAINT "push_deliveries_attempts_check" CHECK ((attempts >= 0));
