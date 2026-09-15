BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS publication_shipping_reserve_cents BIGINT,
  ADD COLUMN IF NOT EXISTS publication_commission_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS publication_insurance_rate NUMERIC;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS product_publication_economics_snapshot_check,
  ADD CONSTRAINT product_publication_economics_snapshot_check CHECK (
    (
      publication_shipping_reserve_cents IS NULL
      AND publication_commission_rate IS NULL
      AND publication_insurance_rate IS NULL
    )
    OR (
      publication_shipping_reserve_cents >= 0
      AND publication_commission_rate >= 0
      AND publication_commission_rate <= 1
      AND publication_insurance_rate >= 0
      AND publication_insurance_rate <= 1
    )
  );

CREATE OR REPLACE FUNCTION public.normalize_publication_rate(p_rate NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_rate IS NULL OR p_rate < 0 THEN NULL
    WHEN p_rate <= 1 THEN p_rate
    WHEN p_rate <= 100 THEN p_rate / 100
    ELSE p_rate / 10000
  END;
$$;

CREATE OR REPLACE FUNCTION public.validate_product_publication_economics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shipping_buffer_cents BIGINT;
  v_commission_rate NUMERIC;
  v_insurance_rate NUMERIC;
  v_expected_reserve_cents BIGINT;
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.publication_shipping_reserve_cents IS NOT NULL
    AND (
      NEW.publication_shipping_reserve_cents IS DISTINCT FROM OLD.publication_shipping_reserve_cents
      OR NEW.publication_commission_rate IS DISTINCT FROM OLD.publication_commission_rate
      OR NEW.publication_insurance_rate IS DISTINCT FROM OLD.publication_insurance_rate
    ) THEN
    RAISE EXCEPTION 'PUBLICATION_ECONOMICS_IMMUTABLE';
  END IF;

  IF NEW.publication_shipping_reserve_cents IS NULL
    AND NEW.publication_commission_rate IS NULL
    AND NEW.publication_insurance_rate IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'PUBLICATION_SNAPSHOT_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;

  SELECT
    shipping_buffer_cents,
    normalize_publication_rate(service_fee_pct),
    normalize_publication_rate(insurance_rate)
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

  IF NEW.publication_shipping_reserve_cents <> v_expected_reserve_cents
    OR NEW.publication_commission_rate <> v_commission_rate
    OR NEW.publication_insurance_rate <> v_insurance_rate THEN
    RAISE EXCEPTION 'INVALID_OR_STALE_PUBLICATION_ECONOMICS';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_product_publication_economics ON public.products;
CREATE TRIGGER validate_product_publication_economics
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_product_publication_economics();

CREATE OR REPLACE FUNCTION public.backfill_product_publication_economics(
  p_product_id UUID
)
RETURNS TABLE (
  publication_shipping_reserve_cents BIGINT,
  publication_commission_rate NUMERIC,
  publication_insurance_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    normalize_publication_rate(service_fee_pct),
    normalize_publication_rate(insurance_rate)
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
$$;

REVOKE ALL ON FUNCTION public.normalize_publication_rate(NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_product_publication_economics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_product_publication_economics(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_product_publication_economics(UUID) TO service_role;

COMMIT;
