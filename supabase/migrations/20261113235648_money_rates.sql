SET local check_function_bodies = off;

DROP FUNCTION "internal"."normalize_publication_rate"(numeric);

ALTER TABLE "public"."products"
  ALTER COLUMN "publication_commission_rate" DROP DEFAULT;

ALTER TABLE "public"."products"
  ALTER COLUMN "publication_commission_rate" TYPE numeric(5,4) USING "publication_commission_rate"::numeric(5,4);

ALTER TABLE "public"."products"
  ALTER COLUMN "publication_insurance_rate" DROP DEFAULT;

ALTER TABLE "public"."products"
  ALTER COLUMN "publication_insurance_rate" TYPE numeric(5,4) USING "publication_insurance_rate"::numeric(5,4);

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "insurance_rate" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "insurance_rate" DROP DEFAULT;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "insurance_rate" TYPE numeric(5,4) USING "insurance_rate"::numeric(5,4);

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "insurance_rate" SET DEFAULT 0.012;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "isr_withholding_pct" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "isr_withholding_pct" DROP DEFAULT;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "isr_withholding_pct" TYPE numeric(5,4) USING "isr_withholding_pct"::numeric(5,4);

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "isr_withholding_pct" SET DEFAULT 0.01;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "iva_withholding_pct" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "iva_withholding_pct" DROP DEFAULT;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "iva_withholding_pct" TYPE numeric(5,4) USING "iva_withholding_pct"::numeric(5,4);

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "iva_withholding_pct" SET DEFAULT 0.08;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "service_fee_pct" SET NOT NULL;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "service_fee_pct" DROP DEFAULT;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "service_fee_pct" TYPE numeric(5,4) USING "service_fee_pct"::numeric(5,4);

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "service_fee_pct" SET DEFAULT 0.05;

CREATE OR REPLACE FUNCTION public.backfill_product_publication_economics (
  p_product_id uuid
)
  RETURNS TABLE (
    publication_shipping_reserve_cents bigint,
    publication_commission_rate        numeric,
    publication_insurance_rate         numeric
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_shipping_buffer_cents BIGINT;
  v_commission_rate NUMERIC;
  v_insurance_rate NUMERIC;
  v_reserve_cents BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  IF v_product.publication_shipping_reserve_cents IS NOT NULL
    OR v_product.publication_commission_rate IS NOT NULL
    OR v_product.publication_insurance_rate IS NOT NULL THEN
    IF v_product.publication_shipping_reserve_cents IS NULL
      OR v_product.publication_commission_rate IS NULL
      OR v_product.publication_insurance_rate IS NULL THEN
      RAISE EXCEPTION 'INVALID_PUBLICATION_ECONOMICS_SNAPSHOT';
    END IF;
    RETURN QUERY SELECT
      v_product.publication_shipping_reserve_cents,
      v_product.publication_commission_rate,
      v_product.publication_insurance_rate;
    RETURN;
  END IF;

  SELECT
    shipping_buffer_cents,
    service_fee_pct,
    insurance_rate
  INTO v_shipping_buffer_cents, v_commission_rate, v_insurance_rate
  FROM public.system_settings
  WHERE id = 1;

  IF v_product.shipping_cost IS NULL
    OR v_shipping_buffer_cents IS NULL
    OR v_commission_rate IS NULL
    OR v_insurance_rate IS NULL THEN
    RAISE EXCEPTION 'LEGACY_PUBLICATION_ECONOMICS_UNAVAILABLE';
  END IF;

  v_reserve_cents :=
    round(v_product.shipping_cost * 100)::BIGINT
    + v_shipping_buffer_cents
    + ceil(round(v_product.price * 100)::NUMERIC * v_insurance_rate)::BIGINT;

  UPDATE public.products
  SET publication_shipping_reserve_cents = v_reserve_cents,
      publication_commission_rate = v_commission_rate,
      publication_insurance_rate = v_insurance_rate,
      updated_at = now()
  WHERE id = p_product_id;

  RETURN QUERY SELECT v_reserve_cents, v_commission_rate, v_insurance_rate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_product_publication_economics()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_shipping_buffer_cents BIGINT;
  v_commission_rate NUMERIC;
  v_insurance_rate NUMERIC;
  v_expected_reserve_cents BIGINT;
  v_old_empty BOOLEAN;
  v_new_empty BOOLEAN;
BEGIN
  v_new_empty := NEW.publication_shipping_reserve_cents IS NULL
    AND NEW.publication_commission_rate IS NULL
    AND NEW.publication_insurance_rate IS NULL;

  IF TG_OP = 'INSERT' THEN
    IF v_new_empty THEN
      RAISE EXCEPTION 'PUBLICATION_SNAPSHOT_REQUIRED';
    END IF;
  ELSE
    v_old_empty := OLD.publication_shipping_reserve_cents IS NULL
      AND OLD.publication_commission_rate IS NULL
      AND OLD.publication_insurance_rate IS NULL;

    IF NEW.price IS NOT DISTINCT FROM OLD.price
      AND NEW.shipping_cost IS NOT DISTINCT FROM OLD.shipping_cost THEN
      IF NEW.publication_shipping_reserve_cents IS NOT DISTINCT FROM OLD.publication_shipping_reserve_cents
        AND NEW.publication_commission_rate IS NOT DISTINCT FROM OLD.publication_commission_rate
        AND NEW.publication_insurance_rate IS NOT DISTINCT FROM OLD.publication_insurance_rate THEN
        RETURN NEW;
      END IF;
      IF NOT v_old_empty THEN
        RAISE EXCEPTION 'PUBLICATION_ECONOMICS_IMMUTABLE';
      END IF;
    ELSE
      IF NOT v_old_empty AND v_new_empty THEN
        RAISE EXCEPTION 'PUBLICATION_SNAPSHOT_REQUIRED';
      END IF;
      IF v_new_empty THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  SELECT
    shipping_buffer_cents,
    service_fee_pct,
    insurance_rate
  INTO v_shipping_buffer_cents, v_commission_rate, v_insurance_rate
  FROM public.system_settings
  WHERE id = 1;

  IF v_shipping_buffer_cents IS NULL
    OR v_commission_rate IS NULL
    OR v_insurance_rate IS NULL
    OR NEW.shipping_cost IS NULL THEN
    RAISE EXCEPTION 'PUBLICATION_ECONOMICS_CONFIGURATION_REQUIRED';
  END IF;

  v_expected_reserve_cents :=
    round(NEW.shipping_cost * 100)::BIGINT
    + v_shipping_buffer_cents
    + ceil(round(NEW.price * 100)::NUMERIC * v_insurance_rate)::BIGINT;

  IF NEW.publication_shipping_reserve_cents IS DISTINCT FROM v_expected_reserve_cents
    OR NEW.publication_commission_rate IS DISTINCT FROM v_commission_rate
    OR NEW.publication_insurance_rate IS DISTINCT FROM v_insurance_rate THEN
    RAISE EXCEPTION 'INVALID_OR_STALE_PUBLICATION_ECONOMICS';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_rates_check"
    CHECK
    (((service_fee_pct >= (0)::numeric) AND (service_fee_pct <= (1)::numeric) AND (insurance_rate >= (0)::numeric) AND (insurance_rate <= (1)::numeric) AND (isr_withholding_pct >=
    (0)::numeric) AND (isr_withholding_pct <= (1)::numeric) AND (iva_withholding_pct >= (0)::numeric) AND (iva_withholding_pct <= (1)::numeric)));
