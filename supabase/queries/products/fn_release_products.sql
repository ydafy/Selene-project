-- ============================================================================
-- Source of truth for fn_release_products.
-- Registered by migration 20260701000000_reservation_lifecycle_hardening.sql.
-- Deployable as a standalone CREATE OR REPLACE FUNCTION statement.
-- ============================================================================

-- Release products back to VERIFIED after a checkout attempt ends
-- (PaymentSheet cancel, terminal failure, seller-not-onboarded, or cleanup).
--
-- Strict RESERVED -> VERIFIED transition: the `AND status = 'RESERVED'` guard
-- prevents touching SOLD, IN_DISPUTE, or already-released rows.
-- Clears reserved_at so no stale TTL marker remains.
-- Idempotent: rows already in VERIFIED are skipped by the guard and the
-- function still returns success = true on repeat calls.

CREATE OR REPLACE FUNCTION public.fn_release_products(p_product_ids UUID[])
RETURNS TABLE(success BOOLEAN)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.products
  SET status = 'VERIFIED',
      updated_at = now(),
      reserved_at = NULL
  WHERE id = ANY(p_product_ids)
    AND status = 'RESERVED';

  RETURN QUERY SELECT true;
END;
$$;

-- This RPC is invoked only by Edge Functions / cron with the service role
-- (which bypasses RLS). Revoke the default PUBLIC execute first so anon and
-- authenticated (which inherit from PUBLIC) cannot release other users'
-- inventory, then grant only to service_role.
REVOKE EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  TO service_role;