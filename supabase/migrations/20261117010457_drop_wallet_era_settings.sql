ALTER TABLE "public"."system_settings"
  DROP CONSTRAINT "system_settings_currency_check";

ALTER TABLE "public"."system_settings"
  DROP CONSTRAINT "system_settings_min_payout_amount_cents_check";

ALTER TABLE "public"."system_settings"
  DROP CONSTRAINT "system_settings_payout_fee_fixed_cents_check";

ALTER TABLE "public"."system_settings"
  DROP CONSTRAINT "system_settings_rates_check";

ALTER TABLE "public"."system_settings"
  DROP CONSTRAINT "system_settings_service_fee_fixed_cents_check";

DROP TYPE "public"."payout_status";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "currency";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "isr_withholding_pct";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "iva_withholding_pct";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "min_payout_amount_cents";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "payout_fee_fixed_cents";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "service_fee_fixed_cents";

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_rates_check"
    CHECK (((service_fee_pct >= (0)::numeric) AND (service_fee_pct <= (1)::numeric) AND (insurance_rate >= (0)::numeric) AND (insurance_rate <= (1)::numeric)));
