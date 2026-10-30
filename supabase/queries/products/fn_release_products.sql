-- ============================================================================
-- Source of truth for fn_release_products.
-- Registered by migration 20261020214153_release_products_service_role_only.sql
-- (service_role only, SECURITY INVOKER, no session check); account-hold
-- handling by 20261030120000_release_reservation_account_hold.sql, moved into
-- fn_release_listings by 20261030130000_release_listings_helper.sql.
-- Deployable as a standalone CREATE OR REPLACE FUNCTION statement.
-- ============================================================================

-- Release products after a checkout attempt ends (PaymentSheet cancel,
-- terminal failure, seller-not-onboarded, or cleanup).
--
-- Strict RESERVED transition: the `AND p.status = 'RESERVED'` guard prevents
-- touching SOLD, IN_DISPUTE, or already-released rows. A listing of an active
-- seller returns to VERIFIED; a listing of a seller whose account is not
-- active (suspended or banned) is held (HIDDEN with status_before_account_hold
-- = VERIFIED), as in fn_release_stale_reservations. Clears reserved_at so no
-- stale TTL marker remains.
-- Idempotent: rows already released are skipped by the guard and the
-- function still returns success = true on repeat calls.

CREATE OR REPLACE FUNCTION public.fn_release_products(p_product_ids UUID[])
RETURNS TABLE(success BOOLEAN)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_release_listings(p_product_ids, true, false);

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
