-- ============================================================================
-- remove-legacy-wallet T5 (S1, S4): delivery, release, dispute and cron
-- functions stop touching the wallet.
--
-- Stripe Connect replaced the internal wallet, so the eight functions below no
-- longer read or write public.wallets, public.wallet_transactions or
-- public.payout_requests. Every other effect is unchanged: delivery
-- confirmation still records the completion event and completes the shipment;
-- seller-side dispute resolution still resolves the dispute, completes the
-- shipment, writes the admin audit row and notifies both parties; return
-- payment logging still marks the return paid; the three dispute crons keep
-- their selection, refund, notification and logging logic.
--
-- Removed, wallet-only behavior:
--   * fn_confirm_shipment_delivery: the seller wallet lookup and the
--     pending-to-available move with its 'release' ledger row, and the
--     SELLER_WALLET_NOT_FOUND code. BL36: a shipment without
--     stripe_payment_intent_id (non-Connect) now has no payout path, so it is
--     refused with SHIPMENT_NOT_CONNECT before any state changes. The Connect
--     path is unchanged.
--   * fn_release_shipment_funds: steps 2-8 of the non-Connect path (delivery,
--     dispute and 48 h checks, payout sum, wallet validation, release and its
--     ledger row, completion) and the SELLER_WALLET_NOT_FOUND /
--     WALLET_UPDATE_FAILED codes. A non-Connect shipment is refused with
--     SHIPMENT_NOT_CONNECT right after the not-found check instead of being
--     completed with no payout. The not-found check, the Connect guard (with
--     its CONNECT_SHIPMENT_SKIPPED_WALLET result) and the failure log are
--     unchanged. Callers that read the result (fn_cron_dispute_shipping_timeout,
--     fn_cron_release_shipment_funds) already log a false result and go on.
--   * fn_resolve_dispute_to_seller / _as_admin: the wallet move and ledger row
--     of the non-Connect branch, and the Connect-only NOTICE. Connect funds are
--     released from the admin payout queue, as before.
--   * fn_log_return_payment: the wallet lookup and the informational ledger row.
--   * fn_cron_dispute_payout_timeout, fn_cron_dispute_shipping_timeout and
--     fn_cron_return_delivery_timeout never touched the wallet tables; only
--     comments mentioned them, and those are reworded. Their logic is unchanged.
--
-- Signatures, SECURITY DEFINER/INVOKER, search_path, volatility and owner are
-- those deployed (CREATE OR REPLACE keeps owner and volatility).
--
-- Grant review: none of these functions is meant for API roles. Production
-- grants EXECUTE to postgres and service_role only, so each function restates
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE TO
-- service_role. fn_release_shipment_funds is SECURITY INVOKER and keeps the
-- same grants.
--
-- Canonical copies: supabase/queries/orders/fn_confirm_shipment_delivery.sql,
-- supabase/queries/shipments/fn_release_shipment_funds.sql and
-- supabase/queries/disputes/{fn_resolve_dispute_to_seller,
-- fn_resolve_dispute_to_seller_as_admin,fn_log_return_payment,
-- fn_cron_dispute_payout_timeout,fn_cron_dispute_shipping_timeout,
-- fn_cron_return_delivery_timeout}.sql. Apply this OR those, not both.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_confirm_shipment_delivery(p_shipment_id uuid, p_source text, p_actor_id uuid, p_idempotency_key text)
 RETURNS TABLE(success boolean, error text, completion_source text, idempotent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_order_id uuid;
  v_buyer_id uuid;
  v_status public.order_status_enum;
  v_delivered_at timestamptz;
  v_buyer_confirmed_at timestamptz;
  v_is_connect BOOLEAN;
  v_completion_source text;
  v_completed_at timestamptz := now();
BEGIN
  IF coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  ) <> 'service_role' THEN
    RETURN QUERY SELECT false, 'SERVICE_ROLE_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('buyer', 'auto') THEN
    RETURN QUERY SELECT false, 'INVALID_COMPLETION_SOURCE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN QUERY SELECT false, 'IDEMPOTENCY_KEY_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer'
    AND p_idempotency_key <> 'confirm_shipment_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'auto'
    AND p_idempotency_key <> 'auto_completion_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  SELECT
    s.order_id,
    s.status,
    s.delivered_at,
    s.buyer_confirmed_at,
    s.stripe_payment_intent_id IS NOT NULL
  INTO
    v_order_id,
    v_status,
    v_delivered_at,
    v_buyer_confirmed_at,
    v_is_connect
  FROM public.shipments AS s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::text, NULL::text, false;
    RETURN;
  END IF;

  IF v_status = 'completed' THEN
    SELECT event.source
    INTO v_completion_source
    FROM public.shipment_completion_events AS event
    WHERE event.shipment_id = p_shipment_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'COMPLETION_AUDIT_MISSING'::text, NULL::text, false;
      RETURN;
    END IF;

    RETURN QUERY SELECT true, NULL::text, v_completion_source, true;
    RETURN;
  END IF;

  IF NOT v_status = 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.disputes AS dispute
    WHERE dispute.shipment_id = p_shipment_id
      AND dispute.status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_HAS_ACTIVE_DISPUTE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer' THEN
    SELECT buyer_id INTO v_buyer_id
    FROM public.orders
    WHERE id = v_order_id;

    IF p_actor_id IS NULL OR v_buyer_id IS DISTINCT FROM p_actor_id THEN
      RETURN QUERY SELECT false, 'BUYER_REQUIRED'::text, NULL::text, false;
      RETURN;
    END IF;
  ELSIF p_actor_id IS NOT NULL OR v_buyer_confirmed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  ELSIF v_delivered_at IS NULL
    OR NOT (v_delivered_at <= now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  END IF;

  -- Shipments without a Stripe payment intent have no payout path since the
  -- internal balance was removed: refuse them before any state changes.
  IF NOT v_is_connect THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::text, NULL::text, false;
    RETURN;
  END IF;

  INSERT INTO public.shipment_completion_events (
    shipment_id,
    order_id,
    source,
    actor_id,
    idempotency_key,
    completed_at,
    is_connect
  ) VALUES (
    p_shipment_id,
    v_order_id,
    p_source,
    p_actor_id,
    p_idempotency_key,
    v_completed_at,
    v_is_connect
  );

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'INFO',
    'Connect shipment completion skipped deprecated wallet release',
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'source', p_source,
      'is_connect', true
    )
  );

  UPDATE public.shipments
  SET status = 'completed',
      completed_at = v_completed_at,
      buyer_confirmed_at = CASE
        WHEN p_source = 'buyer' THEN v_completed_at
        ELSE buyer_confirmed_at
      END,
      updated_at = v_completed_at
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::text, p_source, false;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'ERROR',
    'Shipment completion RPC failed',
    jsonb_build_object('shipment_id', p_shipment_id, 'sqlstate', SQLSTATE)
  );
  RETURN QUERY SELECT false, 'INTERNAL_ERROR'::text, NULL::text, false;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_confirm_shipment_delivery(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirm_shipment_delivery(uuid, text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_release_shipment_funds(p_shipment_id uuid)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- 1. Bloquear shipment
  PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- Connect guard: if shipment was paid via Stripe Connect, mark it completed.
  -- Stripe Connect handles fund routing; the payout is released from the admin queue.
  IF EXISTS (
    SELECT 1 FROM public.shipments
    WHERE id = p_shipment_id AND stripe_payment_intent_id IS NOT NULL
  ) THEN
    -- Mark shipment as completed
    UPDATE public.shipments SET status = 'completed' WHERE id = p_shipment_id;
    RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET'::TEXT; RETURN;
  END IF;

  -- Shipments without a Stripe payment intent have no payout path since the
  -- internal balance was removed: refuse instead of completing without a payout.
  RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::TEXT; RETURN;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_release_shipment_funds',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_release_shipment_funds(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_shipment_funds(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_resolve_dispute_to_seller(p_dispute_id uuid, p_admin_note text)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_seller_id UUID;
    v_buyer_id UUID;
    v_shipment_id UUID;
    v_status public.dispute_status;
    v_audit_id UUID;
BEGIN
    -- A. SEGURIDAD: Obtener ID desde JWT y validar sesión
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins
    IF NOT EXISTS (SELECT 1 FROM public.profiles_private WHERE id = v_auth_user_id AND role = 'admin') THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED_ADMIN_ONLY'::TEXT; RETURN;
    END IF;

    -- C. BLOQUEO Y ESTADO: Bloqueamos la fila
    SELECT order_id, seller_id, buyer_id, status, shipment_id
    INTO v_order_id, v_seller_id, v_buyer_id, v_status, v_shipment_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
    END IF;

    -- Permitimos resolver a favor del vendedor si está en investigación o si ya recibió el retorno (pero impugnó)
    IF v_status NOT IN ('open', 'under_review', 'return_delivered', 'waiting_return') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

    -- D. PAGO: Stripe Connect releases the seller's funds from the admin payout
    -- queue once the shipment is completed (F.1). Nothing moves in this function.

    -- F. ACTUALIZAR ESTADOS: Cerrar caso
    UPDATE public.disputes
    SET status = 'resolved',
        resolution_type = 'seller',
        admin_notes = COALESCE(admin_notes, '') || E'\n[ADMIN]: ' || p_admin_note,
        resolved_by = v_auth_user_id,
        updated_at = now()
    WHERE id = p_dispute_id;

    -- F.1 Actualizar a nivel shipment (post-migration) u order (pre-migration)
    IF v_shipment_id IS NOT NULL THEN
        UPDATE public.shipments SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_shipment_id;
    ELSE
        UPDATE public.orders SET status = 'completed', updated_at = now() WHERE id = v_order_id;
    END IF;

    -- G. AUDITORÍA: Rastro del Admin
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'DISPUTE_RESOLVE_SELLER', p_dispute_id, jsonb_build_object('order_id', v_order_id, 'note', p_admin_note))
    RETURNING id INTO v_audit_id;

    -- One notice per distinct participant, bound to this audited verdict occurrence.
    INSERT INTO public.notifications (
        user_id, type, title, message, action_path,
        event_kind, source_event_key, event_payload
    )
    SELECT recipients.user_id, recipients.type, recipients.title,
           recipients.message, '/profile/orders/' || v_order_id::text,
           'dispute.verdict',
           'dispute.verdict:' || p_dispute_id::text || ':' || v_audit_id::text,
           jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id, 'recipient_role', recipients.recipient_role)
    FROM (VALUES
        (v_seller_id, 'seller', 'success', 'Disputa resuelta a tu favor', 'La disputa se resolvió a tu favor. Consulta el pedido para conocer el estado del pago.'),
        (v_buyer_id, 'buyer', 'warning', 'Disputa resuelta', 'La disputa se resolvió a favor del vendedor. Consulta el pedido para conocer los detalles.')
    ) AS recipients(user_id, recipient_role, type, title, message)
    WHERE true AND (recipients.recipient_role = 'seller' OR v_seller_id IS DISTINCT FROM v_buyer_id)
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_seller', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_resolve_dispute_to_seller(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_dispute_to_seller(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_resolve_dispute_to_seller_as_admin(p_dispute_id uuid, p_admin_note text, p_admin_id uuid)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_seller_id UUID;
    v_buyer_id UUID;
    v_shipment_id UUID;
    v_status public.dispute_status;
    v_audit_id UUID;
BEGIN
    -- A. SECURITY: Actor supplied only by the verified-admin service boundary
    v_auth_user_id := p_admin_id;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_ACTOR';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins
    IF NOT EXISTS (SELECT 1 FROM public.profiles_private WHERE id = v_auth_user_id AND role = 'admin') THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED_ADMIN_ONLY'::TEXT; RETURN;
    END IF;

    -- C. BLOQUEO Y ESTADO: Bloqueamos la fila
    SELECT order_id, seller_id, buyer_id, status, shipment_id
    INTO v_order_id, v_seller_id, v_buyer_id, v_status, v_shipment_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
    END IF;

    -- Permitimos resolver a favor del vendedor si está en investigación o si ya recibió el retorno (pero impugnó)
    IF v_status NOT IN ('open', 'under_review', 'return_delivered', 'waiting_return') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

    -- D. PAGO: Stripe Connect releases the seller's funds from the admin payout
    -- queue once the shipment is completed (F.1). Nothing moves in this function.

    -- F. ACTUALIZAR ESTADOS: Cerrar caso
    UPDATE public.disputes
    SET status = 'resolved',
        resolution_type = 'seller',
        admin_notes = COALESCE(admin_notes, '') || E'\n[ADMIN]: ' || p_admin_note,
        resolved_by = v_auth_user_id,
        updated_at = now()
    WHERE id = p_dispute_id;

    -- F.1 Actualizar a nivel shipment (post-migration) u order (pre-migration)
    IF v_shipment_id IS NOT NULL THEN
        UPDATE public.shipments SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_shipment_id;
    ELSE
        UPDATE public.orders SET status = 'completed', updated_at = now() WHERE id = v_order_id;
    END IF;

    -- G. AUDITORÍA: Rastro del Admin
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'DISPUTE_RESOLVE_SELLER', p_dispute_id, jsonb_build_object('order_id', v_order_id, 'note', p_admin_note))
    RETURNING id INTO v_audit_id;

    -- One notice per distinct participant, bound to this audited verdict occurrence.
    INSERT INTO public.notifications (
        user_id, type, title, message, action_path,
        event_kind, source_event_key, event_payload
    )
    SELECT recipients.user_id, recipients.type, recipients.title,
           recipients.message, '/profile/orders/' || v_order_id::text,
           'dispute.verdict',
           'dispute.verdict:' || p_dispute_id::text || ':' || v_audit_id::text,
           jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id, 'recipient_role', recipients.recipient_role)
    FROM (VALUES
        (v_seller_id, 'seller', 'success', 'Disputa resuelta a tu favor', 'El equipo de Selene resolvió la disputa a tu favor. Una vez liberado el pago, el depósito puede tardar 1–4 días hábiles, dependiendo de tu banco. Consulta el estado del pago en tu pedido.'),
        (v_buyer_id, 'buyer', 'warning', 'Disputa resuelta a favor del vendedor', 'El equipo de Selene resolvió la disputa a favor del vendedor. No se aprobó un reembolso para esta disputa. Consulta los detalles en tu pedido.')
    ) AS recipients(user_id, recipient_role, type, title, message)
    WHERE true AND (recipients.recipient_role = 'seller' OR v_seller_id IS DISTINCT FROM v_buyer_id)
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_seller', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_resolve_dispute_to_seller_as_admin(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_dispute_to_seller_as_admin(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_log_return_payment(p_dispute_id uuid, p_stripe_id text, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_locked_id UUID;
BEGIN
    -- 1. Validar disputa con bloqueo pesimista
    SELECT id
      INTO v_locked_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'DISPUTE_NOT_FOUND: %', p_dispute_id USING ERRCODE = 'P0002';
    END IF;

    -- 2. Actualizar disputa: pago procesado + transición a return_shipped
    UPDATE public.disputes
    SET return_payout_id = p_stripe_id,
        return_payout_status = 'paid',
        status = 'return_shipped',
        updated_at = now()
    WHERE id = p_dispute_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_log_return_payment(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_log_return_payment(uuid, text, numeric) TO service_role;

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
                    -- Legacy path: refund via fn_complete_shipment_refund
                    SELECT success, error_message INTO v_success, v_err
                    FROM public.fn_complete_shipment_refund(v_dispute.shipment_id);

                    IF v_success THEN
                        UPDATE public.disputes
                        SET resolution_type = 'buyer_wins_timeout',
                            admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador.',
                            updated_at = now()
                        WHERE id = v_dispute.id;
                    END IF;
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
                -- fn_release_shipment_funds hace TODO atómicamente:
                -- shipment→completed (trigger→order)
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
$$;

REVOKE ALL ON FUNCTION public.fn_cron_dispute_shipping_timeout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cron_dispute_shipping_timeout() TO service_role;

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
        -- Legacy path: refund via fn_complete_shipment_refund
        SELECT * INTO v_success, v_err_msg
        FROM public.fn_complete_shipment_refund(v_dispute.shipment_id);

        IF v_success THEN
          v_processed := v_processed + 1;
        ELSE
          INSERT INTO public.system_logs (level, message, metadata)
          VALUES ('WARNING', 'Cron return-delivery-timeout: fallo en dispute',
                  jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err_msg));
          v_errors := v_errors + 1;
        END IF;
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

COMMIT;
