-- =========================================================================
-- guard_owner_verified_edit — BEFORE UPDATE on products
-- A seller may keep a VERIFIED listing VERIFIED, without review, only when
-- name, description, condition or usage change (S12, #141). The RLS policy
-- products_update_owner cannot compare OLD and NEW, so this trigger does:
-- for a client owner (role authenticated, not an admin) writing
-- status = 'VERIFIED', OLD.status must already be VERIFIED and no other column
-- may change. updated_at and fts are maintained by the server. Whole rows are
-- compared, so a column added later is protected by default. service_role,
-- postgres and SECURITY DEFINER callers (current_user is not authenticated)
-- and admins are not limited.
-- Migration: supabase/migrations/20261101190000_owner_verified_text_edits.sql
-- =========================================================================

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
