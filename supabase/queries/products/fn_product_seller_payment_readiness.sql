-- fn_product_seller_payment_readiness
-- Introduced by 20261022010508_product_seller_payment_readiness.sql (grants
-- and rationale live there).
--
-- One boolean per live VERIFIED listing: can its seller receive payments?
-- Same seller rules as checkout (create-connect-payment, fn_reserve_products):
-- Connect account present, onboarding complete, seller not suspended or banned.
-- Non-VERIFIED, deleted, or unknown listings are omitted. Input capped at 50.

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
