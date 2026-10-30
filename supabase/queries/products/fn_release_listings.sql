-- ============================================================================
-- Source of truth for fn_release_listings.
-- Registered by migration 20261030130000_release_listings_helper.sql.
-- Deployable as a standalone CREATE OR REPLACE FUNCTION statement.
-- ============================================================================

-- The one place that returns a listing to the catalog after a reservation or a
-- sale ends (#70). Callers: fn_release_stale_reservations, fn_release_products,
-- fn_reserve_products (stale cleanup and partial rollback),
-- fn_finalize_checkout_recovery (refund) and fn_cancel_shipment.
--
-- Rule, decided at release time from the seller's current
-- profiles_private.status (NULL reads as active): an active seller's listing
-- becomes VERIFIED; a suspended or banned seller's listing becomes HIDDEN with
-- status_before_account_hold = COALESCE(existing, 'VERIFIED'), the same hold a
-- suspension applies, so lifting the suspension restores it.
--
-- The caller chooses the ids; p_only_reserved and p_only_expired re-apply the
-- caller's row filter inside the UPDATE so a row that changed after the
-- caller picked it is skipped (RESERVED only; reserved more than 10 minutes
-- ago). Both false releases the ids whatever their status
-- (fn_cancel_shipment: the listings of a cancelled shipment are SOLD).
-- The sellers' profiles_private rows are share-locked in id order first, so a
-- concurrent suspension (FOR UPDATE) and a release serialize.
-- Returns the ids released.

CREATE OR REPLACE FUNCTION public.fn_release_listings(
  p_product_ids UUID[],
  p_only_reserved BOOLEAN,
  p_only_expired BOOLEAN
)
RETURNS SETOF UUID
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
      AND (NOT p_only_reserved OR s.status = 'RESERVED')
      AND (NOT p_only_expired OR s.reserved_at < now() - interval '10 minutes')
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
    AND p.id = ANY(p_product_ids)
    AND (NOT p_only_reserved OR p.status = 'RESERVED')
    AND (NOT p_only_expired OR p.reserved_at < now() - interval '10 minutes')
  RETURNING p.id;
END;
$$;

-- Internal: not callable by any client role. Callers are service_role (the two
-- SECURITY INVOKER release functions) and the postgres owner (the SECURITY
-- DEFINER callers), which keeps EXECUTE as owner.
REVOKE EXECUTE ON FUNCTION public.fn_release_listings(UUID[], BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_listings(UUID[], BOOLEAN, BOOLEAN)
  TO service_role;
