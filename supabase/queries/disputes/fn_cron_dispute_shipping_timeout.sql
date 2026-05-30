
DECLARE
    v_dispute RECORD;
    v_success BOOLEAN;
    v_err TEXT;
BEGIN
    -- Buscar disputas donde el vendedor YA pagó, pero el comprador no ha enviado tras 48h
    FOR v_dispute IN
        SELECT d.id, d.order_id, d.buyer_id, d.seller_id, d.shipment_id
        FROM public.disputes d
        WHERE d.status = 'waiting_return'
          AND d.return_payout_status = 'paid'
          AND d.return_tracking_number IS NULL
          AND d.updated_at < (now() - interval '48 hours')
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            IF v_dispute.shipment_id IS NOT NULL THEN
                -- fn_release_shipment_funds hace TODO atómicamente:
                -- wallet release (pending→available), ledger, shipment→completed (trigger→order)
                -- NO resuelve la disputa ni notifica — eso es responsabilidad del cron.
                SELECT success, error_message INTO v_success, v_err
                FROM public.fn_release_shipment_funds(v_dispute.shipment_id);

                IF v_success THEN
                    -- Marcar disputa resuelta a favor del vendedor
                    UPDATE public.disputes
                    SET status = 'resolved',
                        resolution_type = 'seller_wins_timeout',
                        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Comprador no envió el retorno en 48h. Caso cerrado a favor del vendedor.',
                        updated_at = now()
                    WHERE id = v_dispute.id;

                    -- Notificar
                    INSERT INTO public.notifications (user_id, type, title, message, action_path)
                    VALUES
                        (v_dispute.seller_id, 'success', 'Disputa Ganada', 'El comprador no envió el retorno a tiempo. Tus fondos han sido liberados.', '/profile/orders/' || v_dispute.order_id),
                        (v_dispute.buyer_id, 'error', 'Disputa Perdida', 'No enviaste el producto a tiempo. El caso ha sido cerrado.', '/profile/orders/' || v_dispute.order_id);
                ELSE
                    -- Fallo lógico: no resolver, no notificar. Reintentar en próximo run.
                    INSERT INTO public.system_logs (level, message, metadata)
                    VALUES ('WARNING', 'Cron shipping timeout: release failed',
                            jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err));
                END IF;
            ELSE
                -- Data integrity issue: disputa activa sin shipment_id — requiere intervención manual
                INSERT INTO public.system_logs (level, message, metadata)
                VALUES ('ERROR', 'Cron shipping timeout: dispute without shipment_id — requires manual intervention',
                        jsonb_build_object('dispute_id', v_dispute.id, 'order_id', v_dispute.order_id));
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Atrapar excepciones DB sin abortar el resto del lote
            INSERT INTO public.system_logs (level, message, metadata)
            VALUES ('ERROR', 'Cron shipping timeout: DB exception',
                    jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
        END;
    END LOOP;
END;
