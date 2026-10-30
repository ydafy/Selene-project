-- =========================================================================
-- validate_product_publication_economics — BEFORE INSERT OR UPDATE on products
-- Keeps the publication snapshot immutable and rejects a snapshot that no
-- longer matches the price, shipping cost and system_settings. The economics
-- are only checked while the row is, or becomes, publicly sellable
-- (PENDING_VERIFICATION, IN_REVIEW, VERIFIED, RESERVED). An UPDATE that leaves
-- the row soft-deleted or in HIDDEN, SOLD, REJECTED or IN_DISPUTE is never
-- refused here: account closure, suspension, admin soft delete and the sale
-- itself must succeed even after a fee or settings change (#69).
-- Migration: supabase/migrations/20261030140000_publication_economics_sellable_only.sql
-- =========================================================================

CREATE OR REPLACE FUNCTION public.validate_product_publication_economics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

  IF TG_OP = 'UPDATE'
    AND (
      NEW.deleted_at IS NOT NULL
      OR NEW.status IN (
        'HIDDEN'::public.product_status_enum,
        'SOLD'::public.product_status_enum,
        'REJECTED'::public.product_status_enum,
        'IN_DISPUTE'::public.product_status_enum
      )
    ) THEN
    RETURN NEW;
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
