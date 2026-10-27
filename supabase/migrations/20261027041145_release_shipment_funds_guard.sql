-- ============================================================================
-- fn_release_shipment_funds completes only a delivered, undisputed shipment
-- past the grace period; fn_cron_dispute_shipping_timeout resolves its dispute
-- first.
--
-- A completed shipment becomes payable from the admin payout queue.
-- fn_release_shipment_funds refuses, before any state changes:
--   * SHIPMENT_NOT_CONNECT: no stripe_payment_intent_id (unchanged result);
--   * SHIPMENT_NOT_DELIVERED: status is not 'delivered';
--   * SHIPMENT_IN_ACTIVE_DISPUTE: a dispute on the shipment is not resolved or
--     rejected (same rule as fn_confirm_shipment_delivery);
--   * GRACE_PERIOD_ACTIVE: delivered_at is NULL or less than 48 hours ago.
-- On success it sets completed_at and updated_at with the status, and keeps its
-- CONNECT_SHIPMENT_SKIPPED_WALLET result. The shipment row is read once, locked.
--
-- fn_cron_dispute_shipping_timeout is the only caller. Its dispute is still
-- waiting_return when it calls the release, so it now resolves the dispute
-- (seller_wins_timeout) first, then calls the release. A refused release
-- raises SQLSTATE SR001 inside the per-dispute block, which rolls the
-- resolution back and logs the same WARNING as before; the dispute stays
-- waiting_return for the next run and nobody is notified. The selection,
-- notices and the other logs are unchanged.
--
-- Signatures, SECURITY DEFINER/INVOKER, search_path and owner are those
-- deployed.
--
-- Grant review: neither function is meant for API roles. Production grants
-- EXECUTE to postgres and service_role only, so each function restates
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE TO
-- service_role. fn_release_shipment_funds is SECURITY INVOKER;
-- fn_cron_dispute_shipping_timeout is SECURITY DEFINER and runs from pg_cron.
--
-- Canonical copies: supabase/queries/shipments/fn_release_shipment_funds.sql
-- and supabase/queries/disputes/fn_cron_dispute_shipping_timeout.sql. Apply
-- this OR those, not both.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_release_shipment_funds(p_shipment_id uuid)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_status public.order_status_enum;
  v_delivered_at timestamptz;
  v_is_connect boolean;
BEGIN
  SELECT s.status, s.delivered_at, s.stripe_payment_intent_id IS NOT NULL
  INTO v_status, v_delivered_at, v_is_connect
  FROM public.shipments AS s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::text; RETURN;
  END IF;

  -- Shipments without a Stripe payment intent have no payout path since the
  -- internal balance was removed: refuse instead of completing without a payout.
  IF NOT v_is_connect THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::text; RETURN;
  END IF;

  -- A completed shipment becomes payable from the admin payout queue, so it
  -- completes only after delivery, with no open dispute, past the grace period.
  IF v_status IS DISTINCT FROM 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_DELIVERED'::text; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.disputes AS dispute
    WHERE dispute.shipment_id = p_shipment_id
      AND dispute.status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_IN_ACTIVE_DISPUTE'::text; RETURN;
  END IF;

  IF v_delivered_at IS NULL
    OR NOT (v_delivered_at <= now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'GRACE_PERIOD_ACTIVE'::text; RETURN;
  END IF;

  UPDATE public.shipments
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET'::text;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_release_shipment_funds',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_release_shipment_funds(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_shipment_funds(uuid) TO service_role;

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
                INSERT INTO public.notifications (user_id, type, title, message, action_path)
                VALUES
                    (v_dispute.seller_id, 'success', 'Disputa Ganada', 'El comprador no envió el retorno a tiempo. Tus fondos han sido liberados.', '/profile/orders/' || v_dispute.order_id),
                    (v_dispute.buyer_id, 'error', 'Disputa Perdida', 'No enviaste el producto a tiempo. El caso ha sido cerrado.', '/profile/orders/' || v_dispute.order_id);
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
