
DECLARE
    v_dispute RECORD;
BEGIN
    -- Buscar disputas donde el vendedor no ha pagado la guía tras 48h de ser aprobada
    FOR v_dispute IN
        SELECT d.id, d.order_id, d.buyer_id, d.seller_id
        FROM public.disputes d
        WHERE d.status = 'waiting_return'
          AND d.return_payout_status = 'pending'
          AND d.updated_at < (now() - interval '48 hours')
        FOR UPDATE SKIP LOCKED
    LOOP
        -- 1. Resolver a favor del comprador (Reembolso total)
        -- Nota: Aquí llamamos a la Edge Function de reembolso vía net.http_post o dejamos que el admin lo vea.
        -- Para MVP++, lo marcamos como 'resolved' y dejamos una nota para que el sistema de reembolsos actúe.
        UPDATE public.disputes
        SET status = 'resolved',
            resolution_type = 'buyer_wins_timeout',
            admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador.',
            updated_at = now()
        WHERE id = v_dispute.id;

        -- 2. Notificar
        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES
            (v_dispute.buyer_id, 'success', 'Disputa Ganada', 'El vendedor no pagó la guía de retorno a tiempo. Tu reembolso será procesado.', '/profile/orders/' || v_dispute.order_id),
            (v_dispute.seller_id, 'error', 'Disputa Perdida', 'No pagaste la guía de retorno a tiempo. El caso se cerró a favor del comprador.', '/profile/orders/' || v_dispute.order_id);
    END LOOP;
END;
