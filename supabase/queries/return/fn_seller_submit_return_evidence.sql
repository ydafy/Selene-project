
DECLARE
    v_seller_id UUID;
    v_auth_user_id UUID;
    v_status public.dispute_status; -- Usamos el tipo correcto sin _enum
    v_order_id UUID;
BEGIN
    -- 1. Obtener el ID del usuario desde el JWT
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    -- 2. Validar existencia, propiedad y estado
    SELECT seller_id, status, order_id INTO v_seller_id, v_status, v_order_id
    FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;

    IF NOT FOUND THEN RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN; END IF;
    IF v_seller_id != v_auth_user_id THEN RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN; END IF;

    -- Solo se puede impugnar si el paquete ya fue entregado al vendedor
    IF v_status != 'return_delivered' THEN
        RETURN QUERY SELECT false, 'INVALID_STATUS_FOR_EVIDENCE'::TEXT; RETURN;
    END IF;

    -- 3. Actualizar Evidencia y Escalar a Admin
    UPDATE public.disputes
    SET seller_evidence = jsonb_build_object(
            'images', p_images,
            'video_url', p_video_url,
            'submitted_at', now()
        ),
        status = 'open', -- Lo regresamos a open para que el Admin lo vea en su cola
        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor ha impugnado el retorno y subido evidencia de video.',
        updated_at = now()
    WHERE id = p_dispute_id;

    -- 4. Notificar al Comprador
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (
        (SELECT buyer_id FROM public.disputes WHERE id = p_dispute_id),
        'warning',
        'Disputa Impugnada',
        'El vendedor reportó un problema con el producto devuelto. Selene mediará el caso.',
        '/profile/orders/' || v_order_id
    );

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata) VALUES ('ERROR', 'Fallo en fn_seller_submit_return_evidence', jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
    RETURN QUERY SELECT false, SQLERRM;
END;
