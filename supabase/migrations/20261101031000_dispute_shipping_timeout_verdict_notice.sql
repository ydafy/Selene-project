-- ============================================================================
-- dispute.verdict: typed notices from fn_cron_dispute_shipping_timeout
-- (expo-push-notifications T6c, S4).
--
-- Why: the two notices of the shipping-timeout cron had no event_kind, so they
-- never reached push. They are now dispute.verdict notices, for both roles,
-- which push_event_policy already lists for the buyer and the seller.
--
-- Only the notification insert changes. The selection, the order (resolve the
-- dispute, then release, then notify), the SR001 refusal path and every log
-- are those of 20261027041145_release_shipment_funds_guard.sql. A refused
-- release still rolls the resolution back and notifies nobody; issue #54
-- (retries of this cron) is not addressed here.
--
-- Keys: source_event_key is 'dispute.verdict:<dispute_id>:shipping_timeout'
-- and the payload is {dispute_id, order_id, recipient_role}, like
-- fn_resolve_dispute_to_buyer. The unique (source_event_key, user_id) index
-- keeps one notice per participant. The seller row is skipped when the seller
-- and the buyer are the same user.
--
-- Copy: the seller text no longer says the funds were released. This cron only
-- resolves the dispute and completes the shipment; the money reaches the seller
-- later, when an admin releases the payout (shipment.funds_released). The
-- buyer text and both notice types are unchanged.
--
-- Grant review (AGENTS.md): fn_cron_dispute_shipping_timeout stays SECURITY
-- DEFINER (it runs from pg_cron) and restates REVOKE ALL ... FROM PUBLIC, anon,
-- authenticated and GRANT EXECUTE ... TO service_role exactly as the previous
-- migration does; nothing is granted to a client.
--
-- Canonical definition: supabase/queries/disputes/fn_cron_dispute_shipping_timeout.sql
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_cron_dispute_shipping_timeout()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
                -- Marcar disputa resuelta a favor del vendedor. Va primero:
                -- fn_release_shipment_funds rechaza un shipment con disputa activa.
                UPDATE public.disputes
                SET status = 'resolved',
                    resolution_type = 'seller_wins_timeout',
                    admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Comprador no envió el retorno en 48h. Caso cerrado a favor del vendedor.',
                    updated_at = now()
                WHERE id = v_dispute.id;

                -- shipment→completed (trigger→order) si está entregado y pasó la gracia.
                SELECT success, error_message INTO v_success, v_err
                FROM public.fn_release_shipment_funds(v_dispute.shipment_id);

                -- Fallo lógico: deshacer la resolución, no notificar. Reintentar en próximo run.
                IF v_success IS NOT TRUE THEN
                    RAISE EXCEPTION USING ERRCODE = 'SR001', MESSAGE = 'RELEASE_REFUSED';
                END IF;

                -- Notificar
                -- One typed notice per distinct participant, bound to this dispute.
                INSERT INTO public.notifications (
                    user_id, type, title, message, action_path,
                    event_kind, source_event_key, event_payload
                )
                SELECT recipients.user_id, recipients.type, recipients.title,
                       recipients.message, '/profile/orders/' || v_dispute.order_id::text,
                       'dispute.verdict',
                       'dispute.verdict:' || v_dispute.id::text || ':shipping_timeout',
                       jsonb_build_object('dispute_id', v_dispute.id, 'order_id', v_dispute.order_id, 'recipient_role', recipients.recipient_role)
                FROM (VALUES
                    (v_dispute.seller_id, 'seller', 'success', 'Disputa Ganada', 'El comprador no envió el retorno a tiempo. El caso se cerró a tu favor.'),
                    (v_dispute.buyer_id, 'buyer', 'error', 'Disputa Perdida', 'No enviaste el producto a tiempo. El caso ha sido cerrado.')
                ) AS recipients(user_id, recipient_role, type, title, message)
                WHERE recipients.recipient_role = 'buyer' OR v_dispute.seller_id IS DISTINCT FROM v_dispute.buyer_id
                ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
            ELSE
                -- Data integrity issue: disputa activa sin shipment_id — requiere intervención manual
                INSERT INTO public.system_logs (level, message, metadata)
                VALUES ('ERROR', 'Cron shipping timeout: dispute without shipment_id — requires manual intervention',
                        jsonb_build_object('dispute_id', v_dispute.id, 'order_id', v_dispute.order_id));
            END IF;
        EXCEPTION
            WHEN SQLSTATE 'SR001' THEN
                -- La resolución ya se revirtió con el bloque
                INSERT INTO public.system_logs (level, message, metadata)
                VALUES ('WARNING', 'Cron shipping timeout: release failed',
                        jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err));
            WHEN OTHERS THEN
                -- Atrapar excepciones DB sin abortar el resto del lote
                INSERT INTO public.system_logs (level, message, metadata)
                VALUES ('ERROR', 'Cron shipping timeout: DB exception',
                        jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
        END;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cron_dispute_shipping_timeout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cron_dispute_shipping_timeout() TO service_role;

COMMIT;
