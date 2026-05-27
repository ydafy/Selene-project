
DECLARE
    v_status public.order_status_enum;
    v_buyer_id UUID;
BEGIN
    -- 1. Bloqueo y Validación
    SELECT status, buyer_id INTO v_status, v_buyer_id
    FROM public.orders WHERE id = p_order_id FOR UPDATE;

    IF NOT FOUND THEN RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'::TEXT; RETURN; END IF;

    -- Idempotencia: Si ya está entregada o completada, no hacemos nada
    IF v_status IN ('delivered', 'completed') THEN
        RETURN QUERY SELECT true, 'ALREADY_DELIVERED'::TEXT; RETURN;
    END IF;

    -- 2. Actualización Atómica
    UPDATE public.orders
    SET status = 'delivered',
        delivered_at = now(),
        updated_at = now()
    WHERE id = p_order_id;

    -- 3. Notificaciones Centralizadas
    -- Al Comprador
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (v_buyer_id, 'success', '¡Tu paquete ha llegado!', 'La paquetería confirma la entrega. Tienes 48h para revisarlo antes de que los fondos se liberen.', '/profile/orders/' || p_order_id);

    -- A los Vendedores
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    SELECT DISTINCT seller_id, 'info', 'Venta Entregada', 'El paquete ha sido entregado. Tus fondos se liberarán automáticamente en 48h si no hay disputas.', '/profile/orders/' || p_order_id
    FROM public.order_items WHERE order_id = p_order_id;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
