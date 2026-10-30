-- ============================================================================
-- Source of truth for fn_release_products.
-- Registered by migration 20261020214153_release_products_service_role_only.sql
-- (service_role only, SECURITY INVOKER, no session check); account-hold
-- handling by 20261030120000_release_reservation_account_hold.sql.
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
  PERFORM 1
  FROM public.profiles_private pp
  WHERE pp.id IN (
    SELECT s.seller_id
    FROM public.products s
    WHERE s.id = ANY(p_product_ids)
      AND s.status = 'RESERVED'
  )
  ORDER BY pp.id
  FOR SHARE;

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
    AND p.id = ANY(p_product_ids)
    AND p.status = 'RESERVED';

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
