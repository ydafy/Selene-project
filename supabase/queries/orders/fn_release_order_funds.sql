
DECLARE
    v_item RECORD;
    v_wallet_record RECORD;
    v_delivered_at TIMESTAMPTZ;
    v_status public.order_status_enum;
BEGIN
    SELECT status, delivered_at INTO v_status, v_delivered_at
    FROM public.orders WHERE id = p_order_id FOR UPDATE;

    -- CANDADO 1: Solo órdenes entregadas
    IF v_status != 'delivered' THEN RETURN QUERY SELECT false, 'ORDER_NOT_DELIVERED'::TEXT; RETURN; END IF;

    -- CANDADO 2: Ignorar si hay disputa activa (Defensive Programming)
    IF EXISTS (SELECT 1 FROM public.disputes WHERE order_id = p_order_id AND status NOT IN ('resolved', 'rejected')) THEN
        RETURN QUERY SELECT false, 'ORDER_IN_ACTIVE_DISPUTE'::TEXT; RETURN;
    END IF;

    -- CANDADO 3: Tiempo de Gracia (48h)
    IF v_delivered_at > (now() - interval '48 hours') THEN
        RETURN QUERY SELECT false, 'GRACE_PERIOD_ACTIVE'::TEXT; RETURN;
    END IF;

    -- Procesar cada vendedor
    FOR v_item IN SELECT seller_id, SUM(net_payout) as total_payout FROM public.order_items WHERE order_id = p_order_id GROUP BY seller_id LOOP
        SELECT id, available_balance, pending_balance INTO v_wallet_record
        FROM public.wallets WHERE user_id = v_item.seller_id FOR UPDATE;

        UPDATE public.wallets
        SET pending_balance = GREATEST(0, pending_balance - v_item.total_payout),
            available_balance = available_balance + v_item.total_payout,
            updated_at = now()
        WHERE id = v_wallet_record.id;

        INSERT INTO public.wallet_transactions (wallet_id, order_id, amount, net_amount, balance_after, type, description)
        VALUES (v_wallet_record.id, p_order_id, v_item.total_payout, v_item.total_payout, v_wallet_record.available_balance + v_item.total_payout, 'release', 'Liberación automática post-entrega (48h)');
    END LOOP;

    UPDATE public.orders SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_order_id;
    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata) VALUES ('ERROR', 'Fallo en fn_release_order_funds', jsonb_build_object('order_id', p_order_id, 'error', SQLERRM));
    RETURN QUERY SELECT false, SQLERRM;
END;
