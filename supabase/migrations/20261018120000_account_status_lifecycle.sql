-- Account-status lifecycle: banned is final, admins cannot change their own status,
-- suspended/banned admins lose admin authority, and lifting a suspension restores each
-- listing only to the status it had before the account hold (never a blanket VERIFIED).
-- Listings already HIDDEN at deploy time have no recorded prior status and are not
-- backfilled: they stay HIDDEN for admin review.
-- CREATE OR REPLACE keeps the deployed signatures and ACLs; no overload is added.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regprocedure('public.fn_admin_update_user_status(uuid,uuid,public.account_status,text)') IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_DEPLOYED_STATUS_RPC_MISSING';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_DEPLOYED_IS_ADMIN_MISSING';
  END IF;
END;
$$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS status_before_account_hold public.product_status_enum;

COMMENT ON COLUMN public.products.status_before_account_hold IS
  'Listing status captured when the seller account was suspended or banned; restored and cleared when a suspension is lifted. NULL means no account hold is tracked.';

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$

DECLARE
    v_role TEXT;
    v_status public.account_status;
BEGIN
    SELECT role, status
    INTO v_role, v_status
    FROM public.profiles_private
    WHERE id = auth.uid();

    -- Suspended or banned admins lose admin authority
    RETURN COALESCE(v_role = 'admin' AND COALESCE(v_status, 'active') = 'active', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_admin_update_user_status(
  p_target_user_id UUID,
  p_admin_id UUID,
  p_new_status public.account_status,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$

DECLARE
    v_auth_user_id UUID;
    v_previous_status public.account_status;
BEGIN
    -- A. SECURITY: actor comes from the authenticated JWT; the client-supplied admin id is ignored
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. ROLE CHECK: active admins only
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    IF p_target_user_id = v_auth_user_id THEN
        RAISE EXCEPTION 'CANNOT_CHANGE_OWN_STATUS';
    END IF;

    -- A NULL status reads as active everywhere, so it would silently lift bans and holds
    IF p_new_status IS NULL THEN
        RAISE EXCEPTION 'INVALID_ACCOUNT_STATUS';
    END IF;

    -- C. LOCK TARGET: serialize concurrent status changes for the same account
    SELECT COALESCE(status, 'active')
    INTO v_previous_status
    FROM public.profiles_private
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Banned is final; same-status updates only refresh reason and audit
    IF v_previous_status = 'banned' AND p_new_status <> 'banned' THEN
        RAISE EXCEPTION 'BANNED_IS_FINAL';
    END IF;

    UPDATE public.profiles_private
    SET status = p_new_status,
        status_reason = p_reason,
        status_updated_by = v_auth_user_id::text,
        status_updated_at = now()
    WHERE id = p_target_user_id;

    -- D. INVENTORY: hold listings and remember their prior status
    IF p_new_status IN ('suspended', 'banned') THEN
        UPDATE public.products
        SET status_before_account_hold = COALESCE(status_before_account_hold, status),
            status = 'HIDDEN'::public.product_status_enum,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND deleted_at IS NULL
        AND status = ANY(ARRAY['VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW']::public.product_status_enum[]);

    -- Lifting a suspension restores only listings this hold hid; other HIDDEN listings stay hidden
    ELSIF p_new_status = 'active' AND v_previous_status = 'suspended' THEN
        UPDATE public.products
        SET status = status_before_account_hold,
            status_before_account_hold = NULL,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'HIDDEN'::public.product_status_enum
        AND status_before_account_hold IS NOT NULL
        AND deleted_at IS NULL;

        -- Listings an admin moved out of HIDDEN during the suspension keep no stale hold
        UPDATE public.products
        SET status_before_account_hold = NULL
        WHERE seller_id = p_target_user_id
        AND status_before_account_hold IS NOT NULL
        AND status <> 'HIDDEN'::public.product_status_enum;
    END IF;

    -- E. ADMIN AUDIT LOG
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,
           jsonb_build_object('previous_status', v_previous_status::text, 'new_status', p_new_status::text, 'reason', p_reason));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_update_user_status', jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
$$;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_admin_update_user_status'
  ) <> 1 THEN
    RAISE EXCEPTION 'UNEXPECTED_STATUS_RPC_OVERLOADS';
  END IF;
END;
$$;

COMMIT;
