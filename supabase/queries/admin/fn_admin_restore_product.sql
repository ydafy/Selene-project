CREATE OR REPLACE FUNCTION public.fn_admin_restore_product(
  p_product_id UUID
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

  -- Read previous_status from the last soft-delete audit log
  SELECT (details->>'previous_status')::public.product_status_enum
  INTO v_previous_status
  FROM public.admin_audit_logs
  WHERE target_id = p_product_id::text
    AND action_type = 'PRODUCT_SOFT_DELETE'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Fallback to PENDING_VERIFICATION if no admin log found (seller self-deleted).
  -- Never auto-approve to VERIFIED — force re-moderation.
  IF v_previous_status IS NULL THEN
    v_previous_status := 'PENDING_VERIFICATION'::public.product_status_enum;
  END IF;

  UPDATE public.products
  SET status = v_previous_status,
      deleted_at = NULL,
      updated_at = now()
  WHERE id = p_product_id
    AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    'PRODUCT_RESTORE',
    p_product_id::text,
    jsonb_build_object('restored_status', v_previous_status::text)
  );

  RETURN true;
END;
$$;
