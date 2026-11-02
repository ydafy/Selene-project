-- ============================================================================
-- #141 / S12: a seller edits a VERIFIED listing, without review, only in name,
-- description, condition or usage.
--
-- Root cause: products_update_owner accepted an owner update only when the new
-- status was PENDING_VERIFICATION, HIDDEN or IN_REVIEW, so the app's no-review
-- edit path (status stays VERIFIED) failed for every VERIFIED listing.
--
-- Fix: (1) the policy WITH CHECK also accepts VERIFIED, every other condition
-- unchanged (copied from the live definition). (2) A policy cannot compare OLD
-- and NEW, so the BEFORE UPDATE trigger guard_owner_verified_edit limits a
-- client owner (current_user = 'authenticated', not an admin) that writes
-- status = 'VERIFIED' to listings that were already VERIFIED and changed only
-- name, description, condition, usage, updated_at or fts. Anything else raises
-- VERIFIED_EDIT_REQUIRES_REVIEW (42501); such an edit must go to
-- PENDING_VERIFICATION. service_role, postgres, SECURITY DEFINER functions
-- and admins are not limited.
--
-- Data: the migration writes no row.
--
-- Grant review (AGENTS.md): guard_owner_verified_edit is SECURITY INVOKER and
-- only runs as a trigger, which needs no EXECUTE grant, so EXECUTE is revoked
-- from PUBLIC, anon and authenticated. The trigger name sorts before
-- validate_product_publication_economics; fts is excluded from the comparison
-- because tr_product_fts_update rewrites it. Re-running is safe.
-- ============================================================================

DROP POLICY IF EXISTS products_update_owner ON public.products;
CREATE POLICY products_update_owner ON public.products
  FOR UPDATE TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    AND deleted_at IS NULL
    AND status = ANY (ARRAY['PENDING_VERIFICATION', 'VERIFIED', 'HIDDEN', 'REJECTED']::public.product_status_enum[])
    AND (SELECT public.fn_current_account_is_active())
  )
  WITH CHECK (
    seller_id = (SELECT auth.uid())
    AND status = ANY (ARRAY['PENDING_VERIFICATION', 'VERIFIED', 'HIDDEN', 'IN_REVIEW']::public.product_status_enum[])
    AND status_before_account_hold IS NULL
    AND (SELECT public.fn_current_account_is_active())
  );

CREATE OR REPLACE FUNCTION public.guard_owner_verified_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user <> 'authenticated'
    OR NEW.status IS DISTINCT FROM 'VERIFIED'
    OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'VERIFIED'
    OR (to_jsonb(NEW) - ARRAY['name', 'description', 'condition', 'usage', 'updated_at', 'fts'])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['name', 'description', 'condition', 'usage', 'updated_at', 'fts']) THEN
    RAISE EXCEPTION 'VERIFIED_EDIT_REQUIRES_REVIEW' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_owner_verified_edit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_product_verified_edit_guard ON public.products;
CREATE TRIGGER tr_product_verified_edit_guard
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_verified_edit();
