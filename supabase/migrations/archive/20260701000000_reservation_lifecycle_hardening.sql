-- ============================================================================
-- Migration: reservation-lifecycle-hardening — DB Layer (PR 1 / Work Unit 1)
-- ----------------------------------------------------------------------------
-- Hardens the checkout reservation lifecycle so inventory is not orphaned when
-- a buyer abandons checkout (app kill, PaymentSheet cancel, terminal failure)
-- or a reservation exceeds its 10-minute TTL.
--
-- Scope of this migration (deployable, self-contained):
--   1. Register fn_release_stale_reservations — atomic batch release of
--      RESERVED rows past the 10-minute TTL, optionally scoped by product IDs.
--   2. Update fn_reserve_products — release expired requested rows first,
--      then reserve only VERIFIED stock not owned by the buyer; reset TTL.
--   3. Update fn_release_products — strict RESERVED -> VERIFIED guard, clear
--      reserved_at, idempotent for already-released rows.
--   4. Partial index products(status, reserved_at) WHERE status = 'RESERVED'
--      to keep the cleanup query cheap as the RESERVED set grows.
--
-- Design constraints honored:
--   - Sellable status stays VERIFIED (no AVAILABLE introduced).
--   - No checkout_sessions table (deferred per design).
--   - DB release is idempotent and safe to re-run.
--   - EXECUTE granted to service_role only (Edge Functions/cron invoke it with
--     the service role; anon/authenticated must not release other users' stock).
--
-- Per-file canonical source mirrors live in:
--   supabase/queries/products/fn_release_stale_reservations.sql
--   supabase/queries/products/fn_reserve_products.sql
--   supabase/queries/products/fn_release_products.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. fn_release_stale_reservations
-- ---------------------------------------------------------------------------
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

-- Revoke default PUBLIC execute so anon/authenticated (which inherit from
-- PUBLIC) cannot call privileged release RPCs; then grant service_role only.
REVOKE EXECUTE ON FUNCTION public.fn_release_stale_reservations(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_stale_reservations(UUID[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. fn_reserve_products (all-or-nothing)
-- ---------------------------------------------------------------------------
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
  -- Reclaim expired reservations among the requested products so stale
  -- inventory becomes VERIFIED and available again before reserving. This
  -- legitimate stale release is applied regardless of reserve outcome.
  UPDATE public.products
  SET status = 'VERIFIED',
      updated_at = now(),
      reserved_at = NULL
  WHERE id = ANY(p_product_ids)
    AND status = 'RESERVED'
    AND reserved_at < now() - interval '10 minutes';

  -- Tentatively reserve only VERIFIED products not owned by the buyer,
  -- capturing reserved ids so a partial reservation can be rolled back when
  -- the full cart could not be reserved. Fresh reserved_at resets the TTL.
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

  -- All-or-nothing: if not every requested product was reserved, undo the
  -- tentative reservation made by this call so no partial reservation is
  -- left behind, then report failure.
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

REVOKE EXECUTE ON FUNCTION public.fn_reserve_products(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reserve_products(UUID, UUID[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. fn_release_products
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_release_products(p_product_ids UUID[])
RETURNS TABLE(success BOOLEAN)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict RESERVED -> VERIFIED transition; clears reserved_at.
  -- Idempotent: VERIFIED/SOLD rows are skipped by the guard.
  UPDATE public.products
  SET status = 'VERIFIED',
      updated_at = now(),
      reserved_at = NULL
  WHERE id = ANY(p_product_ids)
    AND status = 'RESERVED';

  RETURN QUERY SELECT true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Partial index for the cleanup query
-- ---------------------------------------------------------------------------
-- Keeps `WHERE status = 'RESERVED' AND reserved_at < now() - interval '10 minutes'`
-- index-only as the RESERVED set grows. Partial so it never bloats with the
-- far larger VERIFIED/SOLD population.
CREATE INDEX IF NOT EXISTS idx_products_reserved_status_reserved_at
  ON public.products (status, reserved_at)
  WHERE status = 'RESERVED';

COMMIT;