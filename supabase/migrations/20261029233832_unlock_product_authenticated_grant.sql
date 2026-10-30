-- admin-web releases a product review lock with the admin's own session
-- (apps/admin-web/src/hooks/useProductLock.ts), but the deployed project grants
-- fn_unlock_product to service_role only, so the call fails with 42501 (#66).
--
-- The admin check moves to is_admin(), the check fn_lock_product uses. The old
-- direct read of profiles_private.role ignored status, so a suspended or banned
-- admin with a live session could still release locks once the function is granted
-- to authenticated. The body is otherwise unchanged.
--
-- Grant review (SECURITY DEFINER): authenticated gets EXECUTE because the function
-- enforces its own authorization. It refuses a caller without a JWT subject
-- (UNAUTHORIZED_NO_SESSION) or who is not an active admin (UNAUTHORIZED_ADMIN_ONLY),
-- and it only clears a lock the caller holds or one older than 10 minutes.
-- PUBLIC and anon stay revoked: there is no anonymous use.

CREATE OR REPLACE FUNCTION public.fn_unlock_product(p_product_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- Active admins only: is_admin() reads profiles_private.role and status.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    UPDATE public.products
    SET locked_by = NULL, locked_at = NULL
    WHERE id = p_product_id
    AND (locked_by = v_auth_user_id OR locked_at < (now() - interval '10 minutes'));

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected > 0 THEN
        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'PRODUCT_UNLOCK', p_product_id, jsonb_build_object('timestamp', now()));
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_unlock_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_unlock_product(uuid) TO authenticated;
