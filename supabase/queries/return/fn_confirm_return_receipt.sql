
DECLARE
    v_seller_id UUID;
    v_order_id UUID;
    v_auth_user_id UUID;
    v_status public.dispute_status;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    -- Bloqueo
    SELECT seller_id, order_id, status INTO v_seller_id, v_order_id, v_status
    FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;

    IF NOT FOUND THEN RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN; END IF;
    IF v_seller_id != v_auth_user_id THEN RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN; END IF;

    -- FIX: Eliminado 'return_shipped' por no existir en el enum del schema actual
    IF v_status NOT IN ('return_delivered', 'waiting_return') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

    -- Actualizar disputa
    UPDATE public.disputes
    SET status = 'resolved',
        resolution_type = 'buyer',
        return_delivered_at = COALESCE(return_delivered_at, now()),
        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor confirmó recepción manual.',
        updated_at = now()
    WHERE id = p_dispute_id;

    -- AUDITORÍA: Registro de evento de negocio
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'SELLER_CONFIRMED_RETURN', p_dispute_id, jsonb_build_object('order_id', v_order_id));

    -- Notificaciones
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES ((SELECT buyer_id FROM public.disputes WHERE id = p_dispute_id), 'success', 'Retorno Aceptado', 'El vendedor recibió el producto. Tu reembolso se está procesando.', '/profile/orders/' || v_order_id);

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_confirm_return_receipt', jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
    RETURN QUERY SELECT false, SQLERRM;
END;
