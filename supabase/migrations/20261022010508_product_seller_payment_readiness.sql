-- ============================================================================
-- fn_product_seller_payment_readiness: read-only "seller accepts payments".
--
-- Why: create-connect-payment refuses checkout (SELLER_NOT_ONBOARDED) when a
-- seller has not finished Stripe Connect onboarding. Buyers only learned that
-- after reaching the payment step. The app needs to know it earlier (product,
-- cart, checkout), but the onboarding status lives in profiles_private, which
-- clients cannot read.
--
-- The function answers one boolean per live VERIFIED listing, using the same
-- seller rules as checkout: Connect account present, onboarding complete, and
-- seller not suspended or banned (fn_reserve_products). Listings that are not
-- VERIFIED, are deleted, or do not exist are omitted, so it reveals nothing
-- about rows the public listing policy hides. Input is capped at 50 ids, the
-- checkout limit.
--
-- Grant review (AGENTS.md): SECURITY DEFINER is required to read
-- profiles_private. It exposes no account id, status, or other column, only
-- the boolean. Anonymous access is intended: guests browse product pages.
-- Revoke PUBLIC, then grant anon, authenticated, and service_role explicitly.
--
-- Canonical definition: supabase/queries/products/fn_product_seller_payment_readiness.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_product_seller_payment_readiness(p_product_ids UUID[])
RETURNS TABLE(product_id UUID, seller_accepts_payments BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    COALESCE(
      pp.stripe_account_id IS NOT NULL
        AND pp.stripe_onboarding_status = 'complete'
        AND pp.status IS DISTINCT FROM 'suspended'
        AND pp.status IS DISTINCT FROM 'banned',
      false
    )
  FROM public.products p
  LEFT JOIN public.profiles_private pp ON pp.id = p.seller_id
  WHERE p.id = ANY(p_product_ids[1:50])
    AND p.status = 'VERIFIED'
    AND p.deleted_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_product_seller_payment_readiness(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_product_seller_payment_readiness(UUID[]) TO anon, authenticated, service_role;
