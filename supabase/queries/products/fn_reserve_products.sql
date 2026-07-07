-- ============================================================================
-- Source of truth for fn_reserve_products.
-- Registered by migration 20260701000000_reservation_lifecycle_hardening.sql.
-- Deployable as a standalone CREATE OR REPLACE FUNCTION statement.
-- ============================================================================

-- Reserve a buyer's cart for checkout (all-or-nothing).
--
-- 1. Release any EXPIRED reservations among the requested products first so
--    stale inventory (app kill, abandoned checkout, TTL passed) becomes
--    VERIFIED and available again before we attempt to reserve. This is a
--    legitimate stale release and is applied regardless of reserve outcome.
-- 2. Tentatively reserve only VERIFIED products not owned by the buyer,
--    capturing their ids/prices so a partial reservation can be undone.
-- 3. All-or-nothing: only succeed when EVERY requested product was reserved.
--    If not, roll back the tentative reservation made by THIS call (release
--    only the rows we just reserved, no TTL condition) so no subset of the cart
--    is left RESERVED, then return success = false with error_message =
--    'SOME_PRODUCTS_UNAVAILABLE'. Product statuses are otherwise unchanged
--    except for the legitimate stale pre-release in step 1.
--
-- The RESERVATION_EXPIRED error code (payment-after-TTL) is surfaced by the
-- Edge Function at payment confirmation time, not by this reserve RPC.

CREATE OR REPLACE FUNCTION public.fn_reserve_products(
  p_buyer_id UUID,
  p_product_ids UUID[]
)
RETURNS TABLE(total_price NUMERIC, success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
  v_sum NUMERIC;
  v_reserved_ids UUID[];
BEGIN
  -- 1. Reclaim expired reservations for the requested products so they can be
  --    re-reserved by this checkout attempt (safe even if a caller already
  --    pre-cleaned via fn_release_stale_reservations; the UPDATE is idempotent).
  --    This legitimate stale release is applied regardless of reserve success.
  UPDATE public.products
  SET status = 'VERIFIED',
      updated_at = now(),
      reserved_at = NULL
  WHERE id = ANY(p_product_ids)
    AND status = 'RESERVED'
    AND reserved_at < now() - interval '10 minutes';

  -- 2. Tentatively reserve only VERIFIED products not owned by the buyer,
  --    capturing reserved ids so a partial reservation can be rolled back when
  --    the full cart could not be reserved. Fresh reserved_at resets the TTL.
  WITH reserved AS (
    UPDATE public.products
    SET status = 'RESERVED',
        updated_at = now(),
        reserved_at = now()
    WHERE id = ANY(p_product_ids)
      AND status = 'VERIFIED'
      AND seller_id <> p_buyer_id
    RETURNING id, price
  )
  SELECT array_agg(id), COUNT(*), COALESCE(SUM(price), 0)
    INTO v_reserved_ids, v_count, v_sum
  FROM reserved;

  -- 3. All-or-nothing. If not every requested product was reserved, undo the
  --    tentative reservation made by this call so no partial reservation is
  --    left behind, then report failure.
  IF v_count = array_length(p_product_ids, 1) THEN
    RETURN QUERY SELECT v_sum, true, NULL::TEXT;
  ELSE
    IF v_count > 0 THEN
      UPDATE public.products
      SET status = 'VERIFIED',
          updated_at = now(),
          reserved_at = NULL
      WHERE id = ANY(v_reserved_ids)
        AND status = 'RESERVED';
    END IF;
    RETURN QUERY SELECT 0::NUMERIC, false, 'SOME_PRODUCTS_UNAVAILABLE'::TEXT;
  END IF;
END;
$$;

-- These RPCs are invoked only by Edge Functions / cron with the service role
-- (which bypasses RLS). Revoke the default PUBLIC execute first so anon and
-- authenticated (which inherit from PUBLIC) cannot release/reserve other users'
-- inventory, then grant only to service_role.
REVOKE EXECUTE ON FUNCTION public.fn_reserve_products(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reserve_products(UUID, UUID[])
  TO service_role;
