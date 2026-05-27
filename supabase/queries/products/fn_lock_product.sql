
DECLARE
    v_auth_user_id UUID;
    v_current_locker_id UUID;
    v_current_locker_name TEXT;
    v_current_locked_at TIMESTAMPTZ;
BEGIN
    -- A. SEGURIDAD: Obtener y validar Admin desde JWT
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

     IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- B. BLOQUEO DE FILA: Obtenemos el estado actual bloqueando la fila para otros procesos
    SELECT pr.locked_by, p.username, pr.locked_at
    INTO v_current_locker_id, v_current_locker_name, v_current_locked_at
    FROM public.products pr
    LEFT JOIN public.profiles p ON p.id = pr.locked_by
    WHERE pr.id = p_product_id
    FOR UPDATE; -- <--- CRÍTICO para evitar que dos admins ganen el lock a la vez

    -- C. LÓGICA DE GESTIÓN DE BLOQUEO

    -- Caso 1: Sin bloqueo o expirado (> 10 min)
    IF v_current_locker_id IS NULL OR v_current_locked_at < (now() - interval '10 minutes') THEN
        UPDATE public.products
        SET locked_by = v_auth_user_id,
            locked_at = now()
        WHERE id = p_product_id;

        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;

    -- Caso 2: El bloqueo ya es mío (renovamos)
    ELSIF v_current_locker_id = v_auth_user_id THEN
        UPDATE public.products
        SET locked_at = now()
        WHERE id = p_product_id;

        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;

    -- Caso 3: Alguien más tiene el bloqueo activo
    ELSE
        RETURN QUERY SELECT false, v_current_locker_name, v_current_locked_at;
    END IF;
END;
