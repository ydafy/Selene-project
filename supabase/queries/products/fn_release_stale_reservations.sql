-- ============================================================================
-- Source of truth for fn_release_stale_reservations.
-- Registered by migration 20261030130000_release_listings_helper.sql
-- (account hold by 20261030120000_release_reservation_account_hold.sql; first by
-- 20260701000000_reservation_lifecycle_hardening.sql, archived).
-- Deployable as a standalone CREATE OR REPLACE FUNCTION statement.
-- ============================================================================

-- Release all product reservations that have exceeded the 10-minute checkout
-- TTL so other buyers can reserve them.
--
-- A listing of an active seller returns to VERIFIED. A listing of a seller
-- whose account is not active (suspended or banned) is held instead, the same
-- way fn_admin_update_user_status holds a visible listing: HIDDEN with
-- status_before_account_hold = VERIFIED, so lifting a suspension restores it
-- through the existing path and a banned seller's listing stays hidden. The
-- seller status is read here, at release time (NULL reads as active).
--
-- Atomic: the batch release is one UPDATE inside fn_release_listings, after
-- share-locking the sellers' profiles_private rows so a concurrent suspension
-- (FOR UPDATE) and the release serialize.
-- Optionally scoped: pass an array of product IDs to clean up only the
-- requested cart's stale rows (used by checkout re-entry); omit/empty to clean
-- up every stale reservation (used by the scheduled cleanup job).
-- Returns one row per released product id so callers can audit/count.

CREATE OR REPLACE FUNCTION public.fn_release_stale_reservations(
  p_product_ids UUID[] DEFAULT '{}'
)
RETURNS TABLE(released_id UUID)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT COALESCE(array_agg(s.id), '{}')
    INTO v_ids
  FROM public.products s
  WHERE s.status = 'RESERVED'
    AND s.reserved_at < now() - interval '10 minutes'
    AND (p_product_ids = '{}' OR s.id = ANY(p_product_ids));

  RETURN QUERY
  SELECT * FROM public.fn_release_listings(v_ids, true, true);
END;
$$;

-- This RPC is invoked only by Edge Functions / cron with the service role
-- (which bypasses RLS). Revoke the default PUBLIC execute first so anon and
-- authenticated (which inherit from PUBLIC) cannot release other users'
-- inventory, then grant only to service_role.
REVOKE EXECUTE ON FUNCTION public.fn_release_stale_reservations(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_stale_reservations(UUID[])
  TO service_role;
