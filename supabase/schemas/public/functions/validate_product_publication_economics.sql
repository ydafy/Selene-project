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

GRANT EXECUTE ON FUNCTION "public"."validate_product_publication_economics"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_product_publication_economics"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_product_publication_economics"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."validate_product_publication_economics"() FROM PUBLIC, "anon", "authenticated";
