SET local check_function_bodies = off;

-- One-shot data step (odd/tasks/table-cleanup.md S2a, #637): listings created
-- before the publication snapshot existed have none, and the columns below
-- become NOT NULL. Give them the snapshot the dropped
-- backfill_product_publication_economics computed, from the current settings
-- row. It runs first, while the old trigger still accepts filling an empty
-- snapshot (it checks the values against the same settings); the new trigger
-- would reject it as PUBLICATION_ECONOMICS_IMMUTABLE. If the settings row is
-- missing, nothing is filled and SET NOT NULL fails the migration.
UPDATE public.products AS p
SET publication_shipping_reserve_cents =
      p.shipping_cost_cents
      + s.shipping_buffer_cents
      + ceil(p.price_cents::numeric * s.insurance_rate)::bigint,
    publication_commission_rate = s.service_fee_pct,
    publication_insurance_rate = s.insurance_rate,
    updated_at = now()
FROM public.system_settings AS s
WHERE s.id = 1
  AND p.publication_shipping_reserve_cents IS NULL
  AND p.publication_commission_rate IS NULL
  AND p.publication_insurance_rate IS NULL;

ALTER TABLE "public"."products"
  DROP CONSTRAINT "product_publication_economics_snapshot_check";

DROP FUNCTION "public"."backfill_product_publication_economics"(uuid);

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "insurance_rate" DROP DEFAULT;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "return_label_fee_cents" DROP DEFAULT;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "service_fee_pct" DROP DEFAULT;

ALTER TABLE "public"."system_settings"
  ALTER COLUMN "shipping_buffer_cents" DROP DEFAULT;

ALTER TABLE "public"."products"
  ALTER COLUMN "publication_commission_rate" SET NOT NULL;

ALTER TABLE "public"."products"
  ALTER COLUMN "publication_insurance_rate" SET NOT NULL;

ALTER TABLE "public"."products"
  ALTER COLUMN "publication_shipping_reserve_cents" SET NOT NULL;

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
BEGIN
  -- Every listing carries a full snapshot. A missing value is left to the
  -- columns' NOT NULL constraints, which reject it with 23502.
  IF NEW.publication_shipping_reserve_cents IS NULL
    OR NEW.publication_commission_rate IS NULL
    OR NEW.publication_insurance_rate IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.price_cents IS NOT DISTINCT FROM OLD.price_cents
    AND NEW.shipping_cost_cents IS NOT DISTINCT FROM OLD.shipping_cost_cents THEN
    IF NEW.publication_shipping_reserve_cents IS NOT DISTINCT FROM OLD.publication_shipping_reserve_cents
      AND NEW.publication_commission_rate IS NOT DISTINCT FROM OLD.publication_commission_rate
      AND NEW.publication_insurance_rate IS NOT DISTINCT FROM OLD.publication_insurance_rate THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PUBLICATION_ECONOMICS_IMMUTABLE';
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
    OR NEW.shipping_cost_cents IS NULL THEN
    RAISE EXCEPTION 'PUBLICATION_ECONOMICS_CONFIGURATION_REQUIRED';
  END IF;

  v_expected_reserve_cents :=
    NEW.shipping_cost_cents
    + v_shipping_buffer_cents
    + ceil(NEW.price_cents::NUMERIC * v_insurance_rate)::BIGINT;

  IF NEW.publication_shipping_reserve_cents IS DISTINCT FROM v_expected_reserve_cents
    OR NEW.publication_commission_rate IS DISTINCT FROM v_commission_rate
    OR NEW.publication_insurance_rate IS DISTINCT FROM v_insurance_rate THEN
    RAISE EXCEPTION 'INVALID_OR_STALE_PUBLICATION_ECONOMICS';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER TABLE "public"."products"
  ADD CONSTRAINT "product_publication_economics_snapshot_check"
    CHECK
    (((publication_shipping_reserve_cents >= 0) AND (publication_commission_rate >= (0)::numeric) AND (publication_commission_rate <= (1)::numeric) AND (publication_insurance_rate
    >= (0)::numeric) AND (publication_insurance_rate <= (1)::numeric)));
