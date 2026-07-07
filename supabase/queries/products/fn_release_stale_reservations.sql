-- ============================================================================
-- Source of truth for fn_release_stale_reservations.
-- Registered by migration 20260701000000_reservation_lifecycle_hardening.sql.
-- Deployable as a standalone CREATE OR REPLACE FUNCTION statement.
-- ============================================================================

-- Release all product reservations that have exceeded the 10-minute checkout
-- TTL, returning them to VERIFIED so other buyers can reserve them.
--
-- Atomic: a single UPDATE performs the batch release.
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
BEGIN
  RETURN QUERY
  UPDATE public.products
  SET status = 'VERIFIED',
      updated_at = now(),
      reserved_at = NULL
  WHERE status = 'RESERVED'
    AND reserved_at < now() - interval '10 minutes'
    AND (p_product_ids = '{}' OR id = ANY(p_product_ids))
  RETURNING id;
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