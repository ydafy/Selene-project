DECLARE
    v_status public.order_status_enum;
    v_buyer_id UUID;
    v_item RECORD;
BEGIN
    -- 1. Bloqueo y Validación de la Orden
    SELECT status, buyer_id INTO v_status, v_buyer_id
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE; -- Bloqueamos la fila para evitar cambios externos durante el proceso

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'::TEXT;
        RETURN;
    END IF;

    IF v_status = 'cancelled' THEN
        RETURN QUERY SELECT true, 'ALREADY_CANCELLED'::TEXT;
        RETURN;
    END IF;

    IF v_status != 'paid' THEN
        RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT;
        RETURN;
    END IF;

    -- 2. Loop de Reversión (Optimizado con JOIN)
    FOR v_item IN
        SELECT
            oi.product_id,
            oi.seller_id,
            p.name as prod_name
        FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = p_order_id
    LOOP

        -- A. Liberar Producto
        UPDATE public.products
        SET status = 'VERIFIED',
            reserved_at = NULL,
            updated_at = now()
        WHERE id = v_item.product_id;

        -- B. Notificación al Vendedor
        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES (
            v_item.seller_id,
            'warning',
            'Venta Cancelada',
            'Tu producto "' || v_item.prod_name || '" ha regresado a tu inventario por cancelación.',
            '/profile/listings'
        );
    END LOOP;

    -- 3. Finalizar Orden y Notificar al Comprador
    UPDATE public.orders
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = p_order_id;

    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (
        v_buyer_id,
        'info',
        'Pedido Cancelado',
        'Tu reembolso ha sido procesado. El dinero regresará a tu cuenta según los tiempos de tu banco.',
        '/profile/orders'
    );

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico en logs del sistema
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('CRITICAL', 'Fallo en fn_cancel_order', jsonb_build_object('order_id', p_order_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
