
DECLARE
    v_auth_user_id UUID;
    v_locker_id UUID;
    v_locker_name TEXT;
    v_lock_time TIMESTAMPTZ;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    SELECT p.locked_by, p.locked_at
    INTO v_locker_id, v_lock_time
    FROM public.products p
    WHERE p.id = p_product_id
    FOR UPDATE;

    IF v_locker_id IS NOT NULL THEN
        SELECT username INTO v_locker_name
        FROM public.profiles
        WHERE id = v_locker_id;
    END IF;

    IF v_locker_id IS NULL OR v_lock_time < (now() - interval '10 minutes') THEN
        UPDATE public.products
        SET locked_by = v_auth_user_id, locked_at = now()
        WHERE id = p_product_id;
        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;
    ELSIF v_locker_id = v_auth_user_id THEN
        UPDATE public.products
        SET locked_at = now()
        WHERE id = p_product_id;
        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;
    ELSE
        RETURN QUERY SELECT false, v_locker_name, v_lock_time;
    END IF;
END;
