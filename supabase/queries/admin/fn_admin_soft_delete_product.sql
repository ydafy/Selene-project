-- =========================================================================
-- fn_admin_soft_delete_product — Admin soft-delete RPC
-- JWT check → is_admin() → SELECT FOR UPDATE → UPDATE → audit INSERT → RETURNS boolean
-- REQ-APM-001, REQ-APM-002
-- =========================================================================

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