-- ============================================================================
-- Migration: product-deletion-hardening (PR 1 — DB + Types)
-- ----------------------------------------------------------------------------
-- Covers:
--   REQ-PDS-001  Create product_status_enum with IN_DISPUTE + convert column
--   REQ-PD-001   RLS on products (SELECT public/owner/admin, UPDATE owner/admin, DELETE blocker)
--   REQ-PD-005   Fix fn_admin_update_user_status reactivation WHERE deleted_at IS NULL
--   REQ-PDS-002  fn_set_product_in_dispute trigger (SECURITY INVOKER, idempotent)
--   REQ-APM-001  fn_admin_soft_delete_product RPC
--   REQ-APM-002  Audit trail in admin_audit_logs
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Create product_status_enum with all existing values + IN_DISPUTE
--    The products.status column was plain text; converting to enum enforces
--    valid states at the DB level. IN_DISPUTE is the new value.
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

-- 2. Convert products.status from text to the new enum type
ALTER TABLE public.products
  ALTER COLUMN status TYPE public.product_status_enum
  USING status::public.product_status_enum;

-- 2b. Set default to 'PENDING_VERIFICATION' (preserving existing behavior)
ALTER TABLE public.products
  ALTER COLUMN status SET DEFAULT 'PENDING_VERIFICATION';

-- ---------------------------------------------------------------------------
-- 3. Enable RLS on products (idempotent)
-- ---------------------------------------------------------------------------

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. RLS policies — mirrors policies_shipments.sql pattern:
--    TO public, InitPlan scalar subqueries like (SELECT auth.uid())
-- ---------------------------------------------------------------------------

-- 4a. SELECT: public users see non-hidden, non-deleted products
CREATE POLICY "products_select_public" ON public.products
  FOR SELECT
  TO public
  USING (
    deleted_at IS NULL
    AND status != 'HIDDEN'
  );

-- 4b. SELECT: owners see all their own products (including hidden/deleted)
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

-- 4d. UPDATE: owners can update their own non-deleted products
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

-- 4e. UPDATE: admins can update any product
CREATE POLICY "products_update_admin" ON public.products
  FOR UPDATE
  TO public
  USING (
    is_admin()
  );

-- 4f. DELETE: blocked for all — service_role bypasses RLS natively
CREATE POLICY "products_delete_block" ON public.products
  FOR DELETE
  TO public
  USING (false);

-- ---------------------------------------------------------------------------
-- 5. fn_set_product_in_dispute — SECURITY INVOKER trigger function
--    Fires AFTER INSERT ON disputes.
--    Looks up product via: disputes.shipment_id → shipments.id → order_items.product_id
--    Skips if: deleted_at IS NOT NULL OR status IN ('SOLD', 'RESERVED')
--    Idempotent: re-inserting for same product will not downgrade.
--
--    SECURITY INVOKER: runs under the caller's privileges, not the function
--    owner's. Per Supabase guidance, never use DEFINER to "fix" RLS gaps.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_set_product_in_dispute()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  -- Skip if no shipment linked
  IF NEW.shipment_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve product via shipment → order_items join
  SELECT oi.product_id INTO v_product_id
  FROM public.shipments s
  JOIN public.order_items oi ON oi.shipment_id = s.id
  WHERE s.id = NEW.shipment_id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip soft-deleted products and terminal statuses (SOLD, RESERVED)
  -- Do not downgrade from a higher-priority status
  UPDATE public.products
  SET status = 'IN_DISPUTE',
      updated_at = now()
  WHERE id = v_product_id
    AND deleted_at IS NULL
    AND status NOT IN ('SOLD', 'RESERVED');

  RETURN NEW;
END;
$$;

-- 5b. Trigger: AFTER INSERT ON disputes
--     Runs alongside the existing on_dispute_opened trigger
CREATE TRIGGER set_product_in_dispute
  AFTER INSERT ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_product_in_dispute();

-- ---------------------------------------------------------------------------
-- 6. Fix fn_admin_update_user_status — add AND deleted_at IS NULL
--    to the reactivation branch so soft-deleted products stay hidden.
--    REQ-PD-005
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
    -- A. SEGURIDAD: Obtener ID desde JWT
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins pueden banear
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- C. ACTUALIZAR PERFIL
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

    -- D. EFECTO DOMINÓ (MVP++): Gestión de Inventario
    IF p_new_status IN ('suspended', 'banned') THEN
        -- Si sancionamos, ocultamos TODO su hardware activo o en revisión
        UPDATE public.products
        SET status = 'HIDDEN',
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status IN ('VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW');

    ELSIF p_new_status = 'active' THEN
        -- Si lo perdonamos, regresamos a VERIFIED solo lo que estaba oculto
        -- y NO fue soft-deleted (deleted_at IS NULL).
        -- (Nota: No regresamos a VERIFIED lo que estaba en revisión por seguridad)
        UPDATE public.products
        SET status = 'VERIFIED',
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'HIDDEN'
        AND deleted_at IS NULL;            -- <-- FIX: exclude soft-deleted products
    END IF;

    -- E. REGISTRO EN BITÁCORA DE ADMINISTRACIÓN
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,
           jsonb_build_object('new_status', p_new_status, 'reason', p_reason));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico en logs del sistema
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_update_user_status', jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. fn_admin_soft_delete_product(p_product_id uuid, p_reason text)
--    JWT check → is_admin() → SELECT FOR UPDATE → UPDATE → audit INSERT → RETURNS boolean
--    REQ-APM-001, REQ-APM-002
--
--    SECURITY DEFINER: needs to read/update products row and insert audit log
--    in one transaction. Admin-only access enforced via JWT + is_admin() check.
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
  -- A. SECURITY: JWT session check
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  -- B. ROLE: Admins only
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  -- C. LOCK ROW & capture previous status
  SELECT status INTO v_previous_status
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  -- Product not found
  IF v_previous_status IS NULL THEN
    RETURN false;
  END IF;

  -- D. UPDATE: soft-delete only if not already deleted
  UPDATE public.products
  SET deleted_at = now(),
      status = 'HIDDEN',
      updated_at = now()
  WHERE id = p_product_id
    AND deleted_at IS NULL;

  -- No row updated = already soft-deleted
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- E. AUDIT TRAIL (same transaction — rollback if insert fails)
  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    'PRODUCT_SOFT_DELETE',
    p_product_id::text,
    jsonb_build_object('reason', p_reason, 'previous_status', v_previous_status::text)
  );

  RETURN true;
END;
$$;

COMMIT;