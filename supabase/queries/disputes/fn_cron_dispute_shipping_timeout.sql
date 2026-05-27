
DECLARE
    v_dispute RECORD;
BEGIN
    -- Buscar disputas donde el vendedor YA pagó, pero el comprador no ha enviado tras 48h
    FOR v_dispute IN
        SELECT d.id, d.order_id, d.buyer_id, d.seller_id
        FROM public.disputes d
        WHERE d.status = 'waiting_return'
          AND d.return_payout_status = 'paid'
          AND d.return_tracking_number IS NULL
          AND d.updated_at < (now() - interval '48 hours')
        FOR UPDATE SKIP LOCKED
    LOOP
        -- 1. Resolver a favor del vendedor (Se queda con el dinero)
        UPDATE public.disputes
        SET status = 'resolved',
            resolution_type = 'seller_wins_timeout',
            admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Comprador no envió el retorno en 48h. Caso cerrado a favor del vendedor.',
            updated_at = now()
        WHERE id = v_dispute.id;

        -- 2. Liberar fondos al vendedor
        PERFORM public.fn_release_order_funds(v_dispute.order_id);

        -- 3. Notificar
        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES
            (v_dispute.seller_id, 'success', 'Disputa Ganada', 'El comprador no envió el retorno a tiempo. Tus fondos han sido liberados.', '/profile/orders/' || v_dispute.order_id),
            (v_dispute.buyer_id, 'error', 'Disputa Perdida', 'No enviaste el producto a tiempo. El caso ha sido cerrado.', '/profile/orders/' || v_dispute.order_id);
    END LOOP;
END;
