-- Show listings that are still being verified to everyone (purchase intent).
--
-- Why: buyers can favorite and read about a listing before it is verified, so
-- sellers learn about interest and buyers get notified when it becomes
-- purchasable. products_select_public used to expose only VERIFIED and SOLD.
--
-- Public states after this migration: VERIFIED, SOLD, PENDING_VERIFICATION and
-- IN_REVIEW (live rows only). REJECTED, HIDDEN, RESERVED and IN_DISPUTE stay
-- hidden from the public; owners and admins keep their own policies.
--
-- Safety: home, recently viewed, search and category lists are pinned to
-- VERIFIED/SOLD in the client (T4b), so they do not change. Purchase stays
-- server-side: fn_reserve_products reserves only VERIFIED listings. Proof
-- files are owner/admin-only since 20261023032203.
--
-- Known limit: every products column (origin_zip, publication_* economics,
-- locked_by, status_before_account_hold, verification_data paths) is readable
-- for the two new states, as it already is for VERIFIED/SOLD. A safe public
-- view or column grants is tracked as T4d.
--
-- Grant review: policy only, no function or grant changes. Roles are
-- unchanged (no TO clause, i.e. PUBLIC, as before).

DROP POLICY IF EXISTS "products_select_public" ON public.products;
CREATE POLICY "products_select_public" ON public.products
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND status IN ('VERIFIED', 'SOLD', 'PENDING_VERIFICATION', 'IN_REVIEW')
  );
