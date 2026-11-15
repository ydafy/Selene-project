ALTER TABLE "public"."order_items"
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "shipment_id" SET NOT NULL;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "shipping_payer" SET NOT NULL;

ALTER TABLE "public"."orders"
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "public"."orders"
  ALTER COLUMN "currency" SET NOT NULL;

ALTER TABLE "public"."orders"
  ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "public"."products"
  ALTER COLUMN "shipping_payer" SET NOT NULL;

ALTER TABLE "public"."shipments"
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "public"."shipments"
  ALTER COLUMN "shipping_cost" SET NOT NULL;

ALTER TABLE "public"."shipments"
  ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "currency" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "is_maintenance" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "min_payout_amount_cents" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "min_version_android" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "min_version_ios" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "novice_active_limit" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "novice_completed_threshold" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "order_expiration_hours" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "package_presets" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "payout_fee_fixed_cents" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "preparing_expiration_hours" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "return_label_fee_cents" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "service_fee_fixed_cents" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "shipping_buffer_cents" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "trusted_active_limit" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "internal"."checkout_recovery_shells"
  ADD CONSTRAINT "checkout_recovery_shells_charged_amount_cents_check" CHECK ((charged_amount_cents >= 0));

ALTER TABLE "internal"."checkout_recovery_shells"
  ADD CONSTRAINT "checkout_recovery_shells_compensation_attempt_count_check" CHECK ((compensation_attempt_count >= 0));

ALTER TABLE "public"."connect_payout_runs"
  ADD CONSTRAINT "connect_payout_runs_attempt_count_check" CHECK ((attempt_count >= 0));

ALTER TABLE "public"."connect_payout_runs"
  ADD CONSTRAINT "connect_payout_runs_release_stage_version_check" CHECK ((release_stage_version >= 1));

ALTER TABLE "public"."order_items"
  ADD CONSTRAINT "order_items_shipping_payer_check" CHECK ((shipping_payer = ANY (ARRAY['buyer'::text, 'seller'::text])));

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_actual_stripe_fee_cents_check" CHECK ((actual_stripe_fee_cents >= 0));

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_cancellation_loss_cents_check" CHECK ((cancellation_loss_cents >= 0));

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_compensation_attempt_count_check" CHECK ((compensation_attempt_count >= 0));

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_currency_check" CHECK ((currency = 'MXN'::text));

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_shipping_payer_check" CHECK ((shipping_payer = ANY (ARRAY['buyer'::text, 'seller'::text])));

ALTER TABLE "public"."shipments"
  ADD CONSTRAINT "shipments_shipping_cost_check" CHECK ((shipping_cost >= 0));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_active_limits_check" CHECK ((trusted_active_limit >= novice_active_limit));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_currency_check" CHECK ((currency = 'MXN'::text));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_min_payout_amount_cents_check" CHECK ((min_payout_amount_cents >= 0));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_novice_active_limit_check" CHECK ((novice_active_limit >= 0));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_novice_completed_threshold_check" CHECK ((novice_completed_threshold >= 0));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_order_expiration_hours_check" CHECK ((order_expiration_hours > 0));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_payout_fee_fixed_cents_check" CHECK ((payout_fee_fixed_cents >= 0));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_preparing_expiration_hours_check" CHECK ((preparing_expiration_hours > 0));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_return_label_fee_cents_check" CHECK ((return_label_fee_cents >= 0));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_service_fee_fixed_cents_check" CHECK ((service_fee_fixed_cents >= 0));

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_shipping_buffer_cents_check" CHECK ((shipping_buffer_cents >= 0));
