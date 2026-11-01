-- ============================================================================
-- Remove the non-Connect order and refund path (expo-push-notifications T6a,
-- S8, L27).
--
-- Every shipment created today is a Connect shipment:
-- fn_create_shipments_from_single_payment stores shipments.stripe_payment_intent_id.
-- fn_complete_shipment_refund refuses Connect shipments, so it only served the
-- shipments of fn_create_order_from_payment, whose only caller was the
-- app_name branch of stripe-webhooks (removed in the same change).
--
-- What changes:
--   * fn_cron_dispute_payout_timeout and fn_cron_return_delivery_timeout: the
--     branch for a shipment without stripe_payment_intent_id no longer refunds.
--     It writes one system_logs row at level ERROR (dispute_id, shipment_id)
--     and leaves the dispute as it is, so it stays visible for manual
--     intervention. fn_cron_return_delivery_timeout also counts it in
--     total_errors. The rest of both bodies is unchanged from
--     20261027001250_remove_wallet_writes_disputes.sql.
--   * DROP FUNCTION fn_complete_shipment_refund(uuid) and
--     fn_create_order_from_payment(uuid, text, numeric, numeric, uuid, uuid[]),
--     without CASCADE, after the two crons stop calling the first. No other
--     function body references either one.
--
-- Grant review (AGENTS.md): both crons stay SECURITY DEFINER with the search_path
-- they have today, because they update disputes and write notifications for other
-- users. REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE ... TO
-- service_role are restated exactly as in 20261027001250_remove_wallet_writes_disputes.sql;
-- nothing is granted to a client. Dropping a function removes its grants.
--
-- Canonical files: supabase/queries/disputes/fn_cron_dispute_payout_timeout.sql and
-- fn_cron_return_delivery_timeout.sql. The canonical files of the two dropped
-- functions are deleted.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_cron_dispute_payout_timeout()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_dispute RECORD;
    v_success BOOLEAN;
    v_err TEXT;
    v_is_connect BOOLEAN;
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
                -- Connect guard: check if the shipment was paid via Stripe Connect.
                -- If so, skip fn_complete_shipment_refund and just
                -- resolve the dispute directly. Connect handles funds via Stripe.
                SELECT EXISTS(
                    SELECT 1 FROM public.shipments
                    WHERE id = v_dispute.shipment_id
                      AND stripe_payment_intent_id IS NOT NULL
                ) INTO v_is_connect;

                IF v_is_connect THEN
                    -- Connect path: resolve the dispute directly
                    UPDATE public.disputes
                    SET status = 'resolved',
                        resolution_type = 'buyer_wins_timeout',
                        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador (Connect).',
                        updated_at = now()
                    WHERE id = v_dispute.id;

                    INSERT INTO public.notifications (user_id, type, title, message, action_path)
                    VALUES
                        (v_dispute.buyer_id, 'success', 'Disputa Ganada', 'El vendedor no pagó la guía de retorno a tiempo. Se procesará tu reembolso.', '/profile/orders/' || v_dispute.order_id),
                        (v_dispute.seller_id, 'error', 'Disputa Perdida', 'No pagaste la guía de retorno a tiempo. El caso se cerró a favor del comprador.', '/profile/orders/' || v_dispute.order_id);

                    v_success := true;
                ELSE
                    INSERT INTO public.system_logs (level, message, metadata)
                    VALUES ('ERROR', 'Cron payout timeout: shipment has no Stripe payment intent, manual intervention required',
                            jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id));
                END IF;

                IF NOT v_success THEN
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
$$;

REVOKE ALL ON FUNCTION public.fn_cron_dispute_payout_timeout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cron_dispute_payout_timeout() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_cron_return_delivery_timeout()
 RETURNS TABLE(total_processed integer, total_errors integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_dispute    RECORD;
  v_processed  INT := 0;
  v_errors     INT := 0;
  v_success    BOOLEAN;
  v_err_msg    TEXT;
  v_is_connect BOOLEAN;
BEGIN
  FOR v_dispute IN
    SELECT d.id, d.shipment_id, d.buyer_id, d.seller_id, d.order_id
    FROM public.disputes d
    WHERE d.status = 'return_delivered'
      AND d.return_delivered_at < now() - interval '48 hours'
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Connect guard: if the shipment was paid via Stripe Connect,
      -- skip fn_complete_shipment_refund. Connect refunds
      -- are handled by resolve-dispute-refund with reverse_transfer.
      SELECT EXISTS(
        SELECT 1 FROM public.shipments
        WHERE id = v_dispute.shipment_id
          AND stripe_payment_intent_id IS NOT NULL
      ) INTO v_is_connect;

      IF v_is_connect THEN
        -- Connect path: just mark dispute resolved.
        -- The actual refund should be triggered by resolve-dispute-refund.
        UPDATE public.disputes
        SET status = 'resolved',
            resolution_type = 'buyer_wins_timeout',
            admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Retorno entregado + 48h timeout. Refund pendiente de ejecución manual (Connect).',
            updated_at = now()
        WHERE id = v_dispute.id;

        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES
          (v_dispute.buyer_id, 'success', 'Devolución Recibida', 'El vendedor recibió el producto. Tu reembolso está pendiente de procesamiento.', '/profile/orders/' || v_dispute.order_id);

        v_processed := v_processed + 1;
      ELSE
        INSERT INTO public.system_logs (level, message, metadata)
        VALUES ('ERROR', 'Cron return-delivery-timeout: shipment has no Stripe payment intent, manual intervention required',
                jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id));
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('ERROR', 'Cron return-delivery-timeout: excepción física',
              jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
      v_errors := v_errors + 1;
    END;
  END LOOP;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Cron return-delivery-timeout completado',
          jsonb_build_object('processed', v_processed, 'errors', v_errors));

  RETURN QUERY SELECT v_processed, v_errors;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cron_return_delivery_timeout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cron_return_delivery_timeout() TO service_role;

DROP FUNCTION public.fn_complete_shipment_refund(uuid);
DROP FUNCTION public.fn_create_order_from_payment(uuid, text, numeric, numeric, uuid, uuid[]);

COMMIT;
