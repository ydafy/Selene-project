-- ============================================================================
-- Migration: product-deletion-hardening (PR 1 — DB + Types)
-- ----------------------------------------------------------------------------
-- Covers:
--   REQ-PDS-001  Create product_status_enum with IN_DISPUTE + convert column
--   REQ-PD-001   RLS on products (SELECT public/owner/admin, UPDATE owner/admin, DELETE blocker)
--   REQ-PD-005   Fix fn_admin_update_user_status reactivation WHERE deleted_at IS NULL
--   REQ-PDS-002  fn_set_product_in_dispute trigger (SECURITY DEFINER, idempotent)
--   REQ-APM-001  fn_admin_soft_delete_product RPC
--   REQ-APM-002  Audit trail in admin_audit_logs
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Create product_status_enum with all existing values + IN_DISPUTE
-- ---------------------------------------------------------------------------

CREATE TYPE public.product_status_enum AS ENUM (
  'PENDING_VERIFICATION',
  'IN_REVIEW',
  'VERIFIED',
  'SOLD',
  'REJECTED',
  'HIDDEN',
  'RESERVED',
  'IN_DISPUTE'
);

-- ---------------------------------------------------------------------------
-- 2. Convert products.status from text to enum
-- ---------------------------------------------------------------------------

-- 2a. Drop dependent views
DROP VIEW IF EXISTS public.seller_trust_stats CASCADE;
DROP VIEW IF EXISTS public.admin_product_queue_view CASCADE;

-- 2b. Drop existing RLS policies that reference status as text
DROP POLICY IF EXISTS products_select ON public.products;
DROP POLICY IF EXISTS products_insert ON public.products;
DROP POLICY IF EXISTS products_update ON public.products;
DROP POLICY IF EXISTS products_delete ON public.products;

-- 2c. Drop CHECK constraint that enforces status as text[] — enum replaces it
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_status_check;

-- 2d. Drop default, convert column, restore default
ALTER TABLE public.products ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.products
  ALTER COLUMN status TYPE public.product_status_enum
  USING status::public.product_status_enum;

ALTER TABLE public.products
  ALTER COLUMN status SET DEFAULT 'PENDING_VERIFICATION'::public.product_status_enum;

-- ---------------------------------------------------------------------------
-- 3. Enable RLS (idempotent)
-- ---------------------------------------------------------------------------

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. RLS policies
--    All status comparisons use explicit enum casts: status = 'X'::product_status_enum
-- ---------------------------------------------------------------------------

-- 4a. SELECT: public sees only verified or sold
CREATE POLICY "products_select_public" ON public.products
  FOR SELECT
  TO public
  USING (
    deleted_at IS NULL
    AND status = ANY(ARRAY['VERIFIED','SOLD']::public.product_status_enum[])
  );

-- 4b. SELECT: owners see all own products
CREATE POLICY "products_select_owner" ON public.products
  FOR SELECT
  TO public
  USING (
    seller_id = (SELECT auth.uid())
  );

-- 4c. SELECT: admins see everything
CREATE POLICY "products_select_admin" ON public.products
  FOR SELECT
  TO public
  USING (
    is_admin()
  );

-- 4d. UPDATE: owners can update own non-deleted, editable products
--     WITH CHECK: can only set to PENDING_VERIFICATION (re-submit) or HIDDEN (delete)
CREATE POLICY "products_update_owner" ON public.products
  FOR UPDATE
  TO public
  USING (
    seller_id = (SELECT auth.uid())
    AND deleted_at IS NULL
    AND status = ANY(ARRAY['PENDING_VERIFICATION','VERIFIED','HIDDEN']::public.product_status_enum[])
  )
  WITH CHECK (
    seller_id = (SELECT auth.uid())
    AND status = ANY(ARRAY['PENDING_VERIFICATION','HIDDEN']::public.product_status_enum[])
  );

-- 4e. UPDATE: admins can update any product
CREATE POLICY "products_update_admin" ON public.products
  FOR UPDATE
  TO public
  USING (
    is_admin()
  );

-- 4f. DELETE: blocked for all
CREATE POLICY "products_delete_block" ON public.products
  FOR DELETE
  TO public
  USING (false);

-- ---------------------------------------------------------------------------
-- 5. fn_set_product_in_dispute — SECURITY DEFINER trigger
--    Fires AFTER INSERT ON disputes. Sets product status to IN_DISPUTE.
--    Skips soft-deleted and terminal statuses (SOLD, RESERVED).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_set_product_in_dispute()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  IF NEW.shipment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT oi.product_id INTO v_product_id
  FROM public.shipments s
  JOIN public.order_items oi ON oi.shipment_id = s.id
  WHERE s.id = NEW.shipment_id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.products
  SET status = 'IN_DISPUTE'::public.product_status_enum,
      updated_at = now()
  WHERE id = v_product_id
    AND deleted_at IS NULL
    AND status NOT IN ('SOLD'::public.product_status_enum, 'RESERVED'::public.product_status_enum);

  RETURN NEW;
END;
$$;

CREATE TRIGGER set_product_in_dispute
  AFTER INSERT ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_product_in_dispute();

-- ---------------------------------------------------------------------------
-- 6. Fix fn_admin_update_user_status
--    Add AND deleted_at IS NULL to reactivation branch (REQ-PD-005)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_admin_update_user_status(
  p_target_user_id UUID,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    UPDATE public.profiles
    SET status = p_new_status,
        status_reason = p_reason,
        status_updated_by = v_auth_user_id::text,
        status_updated_at = now()
    WHERE id = p_target_user_id;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
        RETURN false;
    END IF;

    IF p_new_status IN ('suspended', 'banned') THEN
        UPDATE public.products
        SET status = 'HIDDEN'::public.product_status_enum,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = ANY(ARRAY['VERIFIED','PENDING_VERIFICATION','IN_REVIEW']::public.product_status_enum[]);

    ELSIF p_new_status = 'active' THEN
        UPDATE public.products
        SET status = 'VERIFIED'::public.product_status_enum,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'HIDDEN'::public.product_status_enum
        AND deleted_at IS NULL;
    END IF;

    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,
           jsonb_build_object('new_status', p_new_status, 'reason', p_reason));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_update_user_status', jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. fn_admin_soft_delete_product — admin RPC with audit trail
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_admin_soft_delete_product(
  p_product_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth_user_id UUID;
  v_previous_status public.product_status_enum;
BEGIN
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  SELECT status INTO v_previous_status
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF v_previous_status IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.products
  SET deleted_at = now(),
      status = 'HIDDEN'::public.product_status_enum,
      updated_at = now()
  WHERE id = p_product_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    'PRODUCT_SOFT_DELETE',
    p_product_id,
    jsonb_build_object('reason', p_reason, 'previous_status', v_previous_status::text)
  );

  RETURN true;
END;
$$;

COMMIT;

-- ============================================================================
-- 8. Recreate views (separate transaction — must be last)
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.seller_trust_stats
WITH (security_invoker = true)
AS
SELECT
  seller_id,
  COUNT(*) AS total_listings,
  COUNT(*) FILTER (WHERE status = 'VERIFIED'::public.product_status_enum) AS verified_count,
  COUNT(*) FILTER (WHERE status = 'IN_REVIEW'::public.product_status_enum) AS in_review_count,
  COUNT(*) FILTER (WHERE status = 'REJECTED'::public.product_status_enum) AS rejected_count,
  COUNT(*) FILTER (WHERE status = 'SOLD'::public.product_status_enum) AS sold_count,
  COUNT(*) FILTER (WHERE status = ANY(ARRAY['VERIFIED','SOLD','REJECTED']::public.product_status_enum[])) AS processed_count
FROM public.products
WHERE deleted_at IS NULL
GROUP BY seller_id;

CREATE OR REPLACE VIEW public.admin_product_queue_view
WITH (security_invoker = true)
AS
SELECT *
FROM public.products
WHERE status = 'PENDING_VERIFICATION'::public.product_status_enum
  AND deleted_at IS NULL
ORDER BY created_at ASC;

COMMIT;
