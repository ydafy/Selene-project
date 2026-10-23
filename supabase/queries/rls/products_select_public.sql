-- Canonical public read policy for public.products.
-- Anyone (anon and authenticated, no TO clause) reads live listings that are
-- purchasable (VERIFIED), sold (SOLD) or still being verified
-- (PENDING_VERIFICATION, IN_REVIEW). REJECTED, HIDDEN, RESERVED and IN_DISPUTE
-- stay hidden from the public. Only VERIFIED can be bought: fn_reserve_products
-- enforces it server-side.

DROP POLICY IF EXISTS "products_select_public" ON public.products;
CREATE POLICY "products_select_public" ON public.products
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND status IN ('VERIFIED', 'SOLD', 'PENDING_VERIFICATION', 'IN_REVIEW')
  );
