-- ============================================================================
-- #70: a reservation that ends for a seller whose account is not active is
-- held, not re-listed.
--
-- Why: suspending a seller (fn_admin_update_user_status) hides their visible
-- listings but leaves RESERVED ones alone, because a checkout may be in
-- progress. When that reservation expired (or the checkout failed), the two
-- release functions returned the listing to VERIFIED, so it reappeared in the
-- catalog while the seller was suspended.
--
-- Fix: the decision is made at release time from the seller's current
-- profiles_private.status (NULL reads as active), the single source. For a
-- non-active seller the listing becomes HIDDEN with status_before_account_hold
-- = VERIFIED (the status it would have returned to), the same hold a
-- suspension applies to a visible listing, so lifting a suspension restores it
-- through the existing path. Banned sellers stay hidden (banned is final).
-- Active sellers behave exactly as before. The reservation is not cancelled at
-- suspension time, so in-flight checkouts are not interrupted.
--
-- The seller rows are share-locked before the update so a concurrent
-- suspension (FOR UPDATE on the same row) and a release serialize.
--
-- Data: reads profiles_private.status; writes only products rows that are
-- RESERVED at call time. The migration itself touches no existing row.
--
-- Grant review (AGENTS.md): both functions stay SECURITY INVOKER with the same
-- signatures. CREATE OR REPLACE keeps the ACLs; the REVOKE/GRANT restate
-- service_role only (anonymous access is not intended). Grants are unchanged.
--
-- Canonical: supabase/queries/products/fn_release_stale_reservations.sql and
-- supabase/queries/products/fn_release_products.sql
-- ============================================================================

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

REVOKE EXECUTE ON FUNCTION public.fn_release_stale_reservations(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_stale_reservations(UUID[])
  TO service_role;

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

REVOKE EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  TO service_role;

