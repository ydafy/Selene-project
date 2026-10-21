-- ============================================================================
-- fn_release_products: service_role only, SECURITY INVOKER.
--
-- Why: the deployed function was SECURITY DEFINER, granted to `authenticated`,
-- and only required a JWT `sub`. Any signed-in user could release any RESERVED
-- product (including another buyer's in-flight checkout). At the same time the
-- service role JWT has no `sub`, so every server-side release
-- (create-connect-payment, rollback-connect-payment, stripe-webhooks) failed
-- with UNAUTHORIZED_NO_SESSION and left the product RESERVED.
--
-- Fix: no session check and no SECURITY DEFINER. The only callers are Edge
-- Functions using the service role, which bypasses RLS, so the function does
-- not need elevated privileges. Behavior is otherwise unchanged: strict
-- RESERVED -> VERIFIED guard, clears reserved_at, idempotent, same signature.
--
-- Grant review (AGENTS.md): CREATE OR REPLACE preserves existing ACLs, so the
-- deployed grants to PUBLIC and authenticated must be revoked explicitly.
-- anon and authenticated inherit from PUBLIC; revoke all three, then grant
-- only service_role. Anonymous access is not intended.
--
-- Canonical definition: supabase/queries/products/fn_release_products.sql
-- ============================================================================

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

REVOKE EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  TO service_role;
