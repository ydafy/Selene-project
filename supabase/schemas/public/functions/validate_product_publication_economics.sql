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

GRANT EXECUTE ON FUNCTION "public"."validate_product_publication_economics"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_product_publication_economics"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_product_publication_economics"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."validate_product_publication_economics"() FROM PUBLIC, "anon", "authenticated";
