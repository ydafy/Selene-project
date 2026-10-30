-- ============================================================================
-- Source of truth for fn_release_stale_reservations.
-- Registered by migration 20261030120000_release_reservation_account_hold.sql
-- (first by 20260701000000_reservation_lifecycle_hardening.sql, archived).
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
-- Atomic: a single UPDATE performs the batch release, after share-locking the
-- sellers' profiles_private rows so a concurrent suspension (FOR UPDATE)
-- and the release serialize.
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
  PERFORM 1
  FROM public.profiles_private pp
  WHERE pp.id IN (
    SELECT s.seller_id
    FROM public.products s
    WHERE s.status = 'RESERVED'
      AND s.reserved_at < now() - interval '10 minutes'
      AND (p_product_ids = '{}' OR s.id = ANY(p_product_ids))
  )
  ORDER BY pp.id
  FOR SHARE;

  RETURN QUERY
  UPDATE public.products AS p
  SET status = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN 'VERIFIED'::public.product_status_enum
        ELSE 'HIDDEN'::public.product_status_enum
      END,
      status_before_account_hold = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN p.status_before_account_hold
        ELSE COALESCE(p.status_before_account_hold, 'VERIFIED'::public.product_status_enum)
      END,
      updated_at = now(),
      reserved_at = NULL
  FROM public.products AS s
  LEFT JOIN public.profiles_private AS pp ON pp.id = s.seller_id
  WHERE s.id = p.id
    AND p.status = 'RESERVED'
    AND p.reserved_at < now() - interval '10 minutes'
    AND (p_product_ids = '{}' OR p.id = ANY(p_product_ids))
  RETURNING p.id;
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
