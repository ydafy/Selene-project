
DECLARE
    v_dispute RECORD;
    v_success BOOLEAN;
    v_err TEXT;
BEGIN
    -- Buscar disputas donde el vendedor no ha pagado la guía tras 48h de ser aprobada
    FOR v_dispute IN
        SELECT d.id, d.order_id, d.buyer_id, d.seller_id, d.shipment_id
        FROM public.disputes d
        WHERE d.status = 'waiting_return'
          AND d.return_payout_status = 'pending'
          AND d.updated_at < (now() - interval '48 hours')
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            IF v_dispute.shipment_id IS NOT NULL THEN
                -- Shipment-level: fn_complete_shipment_refund hace TODO atómicamente:
                -- wallet revert, product status, shipment refunded, dispute resolved, notifications.
                -- Solo necesitamos sobreescribir resolution_type para distinguir timeout de manual.
                SELECT success, error_message INTO v_success, v_err
                FROM public.fn_complete_shipment_refund(v_dispute.shipment_id);

                IF v_success THEN
                    UPDATE public.disputes
                    SET resolution_type = 'buyer_wins_timeout',
                        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador.',
                        updated_at = now()
                    WHERE id = v_dispute.id;
                ELSE
                    -- Fallo lógico: no resolver, no notificar. Reintentar en próximo run.
                    INSERT INTO public.system_logs (level, message, metadata)
                    VALUES ('WARNING', 'Cron payout timeout: refund failed',
                            jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err));
                END IF;
            ELSE
                -- Pre-migration fallback: disputa sin shipment_id
                -- Marcar resuelta y notificar manualmente (no hay fn para esto)
                UPDATE public.disputes
                SET status = 'resolved',
                    resolution_type = 'buyer_wins_timeout',
                    admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador.',
                    updated_at = now()
                WHERE id = v_dispute.id;

                INSERT INTO public.notifications (user_id, type, title, message, action_path)
                VALUES
                    (v_dispute.buyer_id, 'success', 'Disputa Ganada', 'El vendedor no pagó la guía de retorno a tiempo. Tu reembolso será procesado.', '/profile/orders/' || v_dispute.order_id),
                    (v_dispute.seller_id, 'error', 'Disputa Perdida', 'No pagaste la guía de retorno a tiempo. El caso se cerró a favor del comprador.', '/profile/orders/' || v_dispute.order_id);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Atrapar excepciones DB sin abortar el resto del lote
            INSERT INTO public.system_logs (level, message, metadata)
            VALUES ('ERROR', 'Cron payout timeout: DB exception',
                    jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
        END;
    END LOOP;
END;
