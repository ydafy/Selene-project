-- ============================================================================
-- T9f (#69): the publication-economics trigger no longer refuses an UPDATE
-- that leaves a listing non-sellable.
--
-- Root cause: validate_product_publication_economics (BEFORE INSERT OR UPDATE
-- on products, schema baseline 20261020100000) recomputed the economics on
-- every write that carried a snapshot, whatever the new status. After a fee or
-- settings change, hiding or soft-deleting a stale listing (fn_close_account,
-- fn_admin_update_user_status, admin soft delete) or marking it SOLD raised
-- INVALID_OR_STALE_PUBLICATION_ECONOMICS and aborted the whole statement.
--
-- Fix: after the immutability check, an UPDATE whose new row is soft-deleted or
-- in HIDDEN, SOLD, REJECTED or IN_DISPUTE returns early. INSERT, and UPDATEs
-- into PENDING_VERIFICATION, IN_REVIEW, VERIFIED or RESERVED, validate exactly
-- as before (publishing or re-pricing to a failing price is still rejected,
-- with the same errors). The snapshot stays immutable in every case.
--
-- Data: the migration writes no existing row.
--
-- Grant review (AGENTS.md): CREATE OR REPLACE keeps the owner, SECURITY DEFINER,
-- search_path and ACL (EXECUTE revoked from PUBLIC, anon and authenticated;
-- service_role keeps it; a trigger function is not an RPC). The REVOKE below
-- only restates that; anonymous access is not intended.
--
-- Canonical: supabase/queries/triggers/product/validate_product_publication_economics.sql
-- ============================================================================

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

REVOKE ALL ON FUNCTION public.validate_product_publication_economics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_product_publication_economics() TO service_role;
