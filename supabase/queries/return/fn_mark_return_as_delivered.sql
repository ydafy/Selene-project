
DECLARE
    v_buyer_id UUID;
    v_seller_id UUID;
    v_order_id UUID;
BEGIN
    SELECT buyer_id, seller_id, order_id INTO v_buyer_id, v_seller_id, v_order_id
    FROM disputes WHERE id = p_dispute_id;

    -- Actualizamos la disputa
    UPDATE disputes
    SET status = 'return_delivered',
        return_delivered_at = now(),
        updated_at = now()
    WHERE id = p_dispute_id;

    -- Notificamos al Vendedor (que ahora recibe)
    INSERT INTO notifications (user_id, type, title, message, action_path)
    VALUES (v_seller_id, 'warning', 'Retorno Entregado', 'Has recibido el producto devuelto. Tienes 24h para revisarlo y reportar anomalías.', '/profile/orders/' || v_order_id);

    -- Notificamos al Comprador (que espera su dinero)
    INSERT INTO notifications (user_id, type, title, message, action_path)
    VALUES (v_buyer_id, 'info', 'Paquete devuelto', 'El vendedor ha recibido el producto. Tu reembolso se procesará en breve.', '/profile/orders/' || v_order_id);

    RETURN QUERY SELECT true, NULL::TEXT;
END;
