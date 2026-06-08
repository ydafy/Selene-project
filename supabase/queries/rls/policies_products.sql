-- =========================================================================
-- RLS Policies for products table — REQ-PD-001
-- Deploy order: AFTER migration 20260608000000_product_deletion_hardening.sql
-- =========================================================================
-- Dependencies: is_admin(), products
-- =========================================================================

-- 1. Enable RLS (idempotent)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 2. SELECT policies
-- =========================================================================

-- Public: see only non-hidden, non-deleted products
CREATE POLICY "products_select_public" ON public.products
  FOR SELECT
  TO public
  USING (
    deleted_at IS NULL
    AND status != 'HIDDEN'
  );

-- Owner: see all own products (including hidden/deleted)
CREATE POLICY "products_select_owner" ON public.products
  FOR SELECT
  TO public
  USING (
    seller_id = (SELECT auth.uid())
  );

-- Admin: see everything
CREATE POLICY "products_select_admin" ON public.products
  FOR SELECT
  TO public
  USING (
    is_admin()
  );

-- =========================================================================
-- 3. UPDATE policies
-- =========================================================================

-- Owner: can update own non-deleted products
CREATE POLICY "products_update_owner" ON public.products
  FOR UPDATE
  TO public
  USING (
    seller_id = (SELECT auth.uid())
    AND deleted_at IS NULL
  )
  WITH CHECK (
    seller_id = (SELECT auth.uid())
  );

-- Admin: can update any product
CREATE POLICY "products_update_admin" ON public.products
  FOR UPDATE
  TO public
  USING (
    is_admin()
  );

-- =========================================================================
-- 4. DELETE: blocked for everyone. service_role bypasses RLS natively.
-- =========================================================================
CREATE POLICY "products_delete_block" ON public.products
  FOR DELETE
  TO public
  USING (false);