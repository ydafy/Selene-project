
DECLARE
    v_seller_id UUID;
    v_net_payout_total NUMERIC;
    v_new_pending NUMERIC;
    v_wallet_id UUID;
BEGIN
    SELECT seller_id INTO v_seller_id FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;
    SELECT SUM(net_payout) INTO v_net_payout_total FROM public.order_items WHERE order_id = p_order_id;

    UPDATE public.wallets
    SET pending_balance = GREATEST(0, pending_balance - v_net_payout_total),
        updated_at = now()
    WHERE user_id = v_seller_id
    RETURNING id, pending_balance INTO v_wallet_id, v_new_pending;

    -- Registro con amount negativo para claridad financiera
    INSERT INTO public.wallet_transactions (wallet_id, order_id, amount, net_amount, balance_after, type, description)
    VALUES (v_wallet_id, p_order_id, -v_net_payout_total, -v_net_payout_total, v_new_pending, 'refund', 'Reembolso por disputa resuelta');

    UPDATE public.products SET status = 'IN_REVIEW', updated_at = now() WHERE id IN (SELECT product_id FROM public.order_items WHERE order_id = p_order_id);
    UPDATE public.orders SET status = 'refunded', updated_at = now() WHERE id = p_order_id;
    UPDATE public.disputes SET status = 'resolved', updated_at = now() WHERE id = p_dispute_id;

    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES
        ((SELECT buyer_id FROM public.orders WHERE id = p_order_id), 'success', 'Reembolso Finalizado', 'Tu dinero ha sido devuelto.', '/profile/orders/' || p_order_id),
        (v_seller_id, 'warning', 'Producto Reembolsado', 'El producto está en revisión técnica.', '/profile/orders/' || p_order_id);

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata) VALUES ('ERROR', 'Fallo en fn_complete_dispute_refund', jsonb_build_object('order_id', p_order_id, 'error', SQLERRM));
    RETURN QUERY SELECT false, SQLERRM;
END;
