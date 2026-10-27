-- ============================================================================
-- remove-legacy-wallet T4 (S1, S4): core functions stop touching the wallet.
--
-- Stripe Connect replaced the internal wallet, so the six functions below no
-- longer read or write public.wallets, public.wallet_transactions or
-- public.payout_requests. Every other effect is unchanged: signup still
-- provisions profiles and profiles_private; order creation still builds the
-- order, shipments, items and notifications; order and shipment cancellation
-- still release products and notify; refund completion still marks the
-- shipment refunded, resolves the dispute and notifies; account closure keeps
-- every Connect, order, shipment, dispute and refund blocker.
--
-- Removed, wallet-only behavior:
--   * fn_on_auth_user_created: the wallet row created for each new user.
--   * fn_create_order_from_payment: the seller pending_balance credit and the
--     'sale_proceeds' wallet_transactions row per item.
--   * fn_cancel_order / fn_cancel_shipment: the pending_balance reversal and
--     the 'adjustment' ledger row (fn_cancel_shipment also drops the
--     v_total_refund sum that only fed it).
--   * fn_complete_shipment_refund: the pending_balance reversal, the 'refund'
--     ledger row and the WALLET_UPDATE_FAILED error code (wallet-only).
--   * fn_close_account: the unreleased wallet balance and pending
--     payout_requests conditions of the 'pending_payouts' blocker. The Connect
--     payout conditions of that blocker stay.
--
-- Signatures, SECURITY DEFINER/INVOKER, search_path, volatility and owner are
-- those deployed (CREATE OR REPLACE keeps owner and volatility).
--
-- Grant review: no function here is meant for API roles. Production grants
-- EXECUTE to postgres and service_role only, so each function restates
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE TO
-- service_role. fn_create_order_from_payment is SECURITY INVOKER and
-- fn_on_auth_user_created is a trigger function; both keep the same grants.
--
-- Canonical copies: supabase/queries/triggers/auth/fn_on_auth_user_created.sql,
-- supabase/queries/orders/{fn_create_order_from_payment,fn_cancel_order,
-- fn_cancel_shipment}.sql, supabase/queries/shipments/
-- fn_complete_shipment_refund.sql and supabase/queries/auth/fn_close_account.sql.
-- Apply this OR those, not both.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_on_auth_user_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_typed text := NULLIF(btrim(NEW.raw_user_meta_data->>'username'), '');
  v_source text;
  v_username text;
BEGIN
  IF v_typed IS NOT NULL THEN
    IF char_length(v_typed) NOT BETWEEN 3 AND 20 THEN
      RAISE EXCEPTION 'Username must be between 3 and 20 characters'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_typed) THEN
      RAISE EXCEPTION 'Username "%" is already taken', v_typed
        USING ERRCODE = 'unique_violation';
    END IF;
    v_username := v_typed;
  ELSE
    v_source := COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(btrim(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1)
    );
    v_username := public.fn_generate_profile_username(v_source);
  END IF;

  -- A. Public profile. A concurrent signup can take the chosen username
  -- between the check and the insert: retry a derived one, reject a typed one.
  LOOP
    BEGIN
      INSERT INTO public.profiles (
        id, username, avatar_url, is_verified_seller
      )
      VALUES (
        NEW.id,
        v_username,
        NEW.raw_user_meta_data->>'avatar_url',
        false
      )
      ON CONFLICT (id) DO NOTHING;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_typed IS NOT NULL THEN
        RAISE EXCEPTION 'Username "%" is already taken', v_typed
          USING ERRCODE = 'unique_violation';
      END IF;
      v_username := public.fn_generate_profile_username(v_source);
    END;
  END LOOP;

  -- B. Private profile (email, role, status — Zero Trust)
  INSERT INTO public.profiles_private (id, email, role, status)
  VALUES (NEW.id, NEW.email, 'user', 'active')
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN check_violation OR unique_violation THEN
    RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'FALLO CRÍTICO EN SETUP DE USUARIO: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_on_auth_user_created() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_on_auth_user_created() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_create_order_from_payment(p_buyer_id uuid, p_stripe_intent_id text, p_total_amount numeric, p_service_fee numeric, p_address_id uuid, p_product_ids uuid[])
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order_id UUID;
  v_addr_snapshot JSONB;
  v_prod RECORD;
  v_seller RECORD;
  v_net_payout NUMERIC;
  v_commission_pct NUMERIC;
  v_isr_pct NUMERIC;
  v_iva_pct NUMERIC;
  v_sat_withholding NUMERIC;
  v_shipment_id UUID;
  v_shipments_cache JSONB := '{}'::JSONB; -- {seller_id: shipment_id}
BEGIN
  -- 1. Idempotencia
  IF EXISTS (SELECT 1 FROM public.orders WHERE stripe_payment_intent_id = p_stripe_intent_id) THEN
    RETURN QUERY SELECT true, 'ALREADY_PROCESSED'::TEXT; RETURN;
  END IF;

  -- 2. Config
  SELECT service_fee_pct, isr_withholding_pct, iva_withholding_pct
    INTO v_commission_pct, v_isr_pct, v_iva_pct
  FROM public.system_settings LIMIT 1;

  -- 3. Snapshot de dirección
  SELECT to_jsonb(a.*) INTO v_addr_snapshot FROM public.addresses a
  WHERE id = p_address_id AND user_id = p_buyer_id;

  IF v_addr_snapshot IS NULL THEN
    RETURN QUERY SELECT false, 'ADDRESS_NOT_FOUND_OR_UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 4. Crear la orden
  INSERT INTO public.orders (buyer_id, stripe_payment_intent_id, total_amount, status, shipping_address, service_fee_amount)
  VALUES (p_buyer_id, p_stripe_intent_id, p_total_amount, 'paid', v_addr_snapshot, p_service_fee)
  RETURNING id INTO v_order_id;

  -- 5. Crear shipments: uno por seller distinto
  FOR v_seller IN
    SELECT DISTINCT seller_id FROM public.products WHERE id = ANY(p_product_ids)
  LOOP
    INSERT INTO public.shipments (order_id, seller_id, status)
    VALUES (v_order_id, v_seller.seller_id, 'paid')
    RETURNING id INTO v_shipment_id;

    v_shipments_cache := jsonb_set(
      v_shipments_cache,
      ARRAY[v_seller.seller_id::TEXT],
      to_jsonb(v_shipment_id)
    );
  END LOOP;

  -- 6. Procesar cada producto
  FOR v_prod IN
    SELECT id, name, price, seller_id, shipping_cost, status
    FROM public.products
    WHERE id = ANY(p_product_ids)
    FOR UPDATE
  LOOP
    IF v_prod.status IS DISTINCT FROM 'VERIFIED' THEN
      RETURN QUERY SELECT false, format('PRODUCT_NOT_AVAILABLE: %s (status: %s)', v_prod.name, v_prod.status); RETURN;
    END IF;

    v_sat_withholding := v_prod.price * (v_isr_pct + v_iva_pct);
    v_net_payout := v_prod.price - (v_prod.price * v_commission_pct) - v_sat_withholding - COALESCE(v_prod.shipping_cost, 0);

    -- Asignar shipment_id según el seller
    v_shipment_id := (v_shipments_cache ->> v_prod.seller_id::TEXT)::UUID;

    INSERT INTO public.order_items (
      order_id, product_id, seller_id, price_at_purchase,
      commission_amount, shipping_amount, net_payout, shipment_id, sat_tax_withholding
    )
    VALUES (
      v_order_id, v_prod.id, v_prod.seller_id, v_prod.price,
      (v_prod.price * v_commission_pct), COALESCE(v_prod.shipping_cost, 0),
      v_net_payout, v_shipment_id, v_sat_withholding
    );

    -- Marcar vendido
    UPDATE public.products SET status = 'SOLD', updated_at = now() WHERE id = v_prod.id;

    -- Notificación vendedor
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (v_prod.seller_id, 'success', '¡Vendido!', 'Has vendido: ' || v_prod.name, '/profile/orders/' || v_order_id);
  END LOOP;

  -- 7. Notificación comprador
  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES (p_buyer_id, 'success', '¡Compra Exitosa!', 'Tu pedido ha sido confirmado.', '/profile/orders/' || v_order_id);

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_order_from_payment(uuid, text, numeric, numeric, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_order_from_payment(uuid, text, numeric, numeric, uuid, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_cancel_order(p_order_id uuid, p_reason text, p_cancelled_by_role text)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_status public.order_status_enum;
    v_buyer_id UUID;
    v_item RECORD;
BEGIN
    -- 1. Bloqueo y Validación de la Orden
    SELECT status, buyer_id INTO v_status, v_buyer_id
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE; -- Bloqueamos la fila para evitar cambios externos durante el proceso

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'::TEXT;
        RETURN;
    END IF;

    IF v_status = 'cancelled' THEN
        RETURN QUERY SELECT true, 'ALREADY_CANCELLED'::TEXT;
        RETURN;
    END IF;

    IF v_status != 'paid' THEN
        RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT;
        RETURN;
    END IF;

    -- 2. Loop de Reversión (Optimizado con JOIN)
    FOR v_item IN
        SELECT
            oi.product_id,
            oi.seller_id,
            p.name as prod_name
        FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = p_order_id
    LOOP

        -- A. Liberar Producto
        UPDATE public.products
        SET status = 'VERIFIED',
            reserved_at = NULL,
            updated_at = now()
        WHERE id = v_item.product_id;

        -- B. Notificación al Vendedor
        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES (
            v_item.seller_id,
            'warning',
            'Venta Cancelada',
            'Tu producto "' || v_item.prod_name || '" ha regresado a tu inventario por cancelación.',
            '/profile/listings'
        );
    END LOOP;

    -- 3. Finalizar Orden y Notificar al Comprador
    UPDATE public.orders
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = p_order_id;

    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (
        v_buyer_id,
        'info',
        'Pedido Cancelado',
        'Tu reembolso ha sido procesado. El dinero regresará a tu cuenta según los tiempos de tu banco.',
        '/profile/orders'
    );

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico en logs del sistema
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('CRITICAL', 'Fallo en fn_cancel_order', jsonb_build_object('order_id', p_order_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cancel_order(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancel_order(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_cancel_shipment(
  p_shipment_id UUID,
  p_cancelled_by_role TEXT,
  p_reason TEXT,
  p_cancellation_loss_cents BIGINT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status public.order_status_enum;
  v_buyer_id UUID;
  v_item RECORD;
  v_actual_stripe_fee_cents BIGINT;
  v_cancellation_loss_cents BIGINT;
  v_loss_update_cents BIGINT;
  v_next_cancellation_loss_cents BIGINT;
  v_refund_status TEXT;
  v_refund_resolved_at TIMESTAMPTZ;
BEGIN
  -- 1. Lock shipment and validate eligibility.
  SELECT order_id, seller_id, status
    INTO v_order_id, v_seller_id, v_status
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT true, 'ALREADY_CANCELLED'::TEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('paid', 'preparing') THEN
    RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT;
    RETURN;
  END IF;

  -- 2. Service-role-only mutation; Edge Functions/crons validate the actor.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT;
    RETURN;
  END IF;

  IF p_cancelled_by_role NOT IN ('buyer', 'seller', 'system') THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT;
    RETURN;
  END IF;

  -- The Stripe refund must be recorded as succeeded before the business
  -- cancellation: every caller records it first, so a missing operation or a
  -- NULL status means no confirmed refund. The one exception is a failed or
  -- canceled refund an admin resolved (fn_resolve_shipment_cancellation_refund).
  SELECT refund_status, refund_resolved_at INTO v_refund_status, v_refund_resolved_at
  FROM public.shipment_cancellation_operations
  WHERE shipment_id = p_shipment_id;

  IF v_refund_status IS DISTINCT FROM 'succeeded' AND v_refund_resolved_at IS NULL THEN
    RETURN QUERY SELECT false, 'REFUND_NOT_SUCCEEDED'::TEXT;
    RETURN;
  END IF;

  -- 3. Lock order for refund-loss reconciliation.
  SELECT buyer_id, actual_stripe_fee_cents, cancellation_loss_cents
    INTO v_buyer_id, v_actual_stripe_fee_cents, v_cancellation_loss_cents
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  -- 4. Release products before publishing the shipment transition.
  FOR v_item IN
    SELECT oi.product_id
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.shipment_id = p_shipment_id
  LOOP
    UPDATE public.products
    SET status = 'VERIFIED', reserved_at = NULL, updated_at = now()
    WHERE id = v_item.product_id;
  END LOOP;

  -- 5. Mark the shipment cancelled and persist any reconciled loss.
  UPDATE public.shipments
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_shipment_id;

  IF p_cancellation_loss_cents IS NOT NULL AND v_actual_stripe_fee_cents IS NOT NULL THEN
    v_loss_update_cents := p_cancellation_loss_cents;
    v_next_cancellation_loss_cents := LEAST(
      COALESCE(v_actual_stripe_fee_cents, 0),
      COALESCE(v_cancellation_loss_cents, 0) + v_loss_update_cents
    );

    UPDATE public.orders
    SET cancellation_loss_cents = v_next_cancellation_loss_cents,
        updated_at = now()
    WHERE id = v_order_id;
  END IF;

  -- One notice per distinct recipient for this committed shipment transition.
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    type, title, message, action_path
  )
  SELECT recipients.user_id,
         'shipment.cancelled',
         'shipment.cancelled:' || p_shipment_id::text,
         jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id,
                            'recipient_role', recipients.recipient_role),
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'info' ELSE 'warning' END,
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'Pedido cancelado'
              ELSE 'Venta cancelada' END,
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'Se canceló un envío de tu pedido.'
              ELSE 'Se canceló tu envío; los productos regresaron a tu inventario.' END,
         '/profile/orders/' || v_order_id::text
  -- WHERE true disambiguates INSERT ... SELECT from JOIN ON before ON CONFLICT.
  FROM (
    SELECT v_buyer_id AS user_id, 'buyer' AS recipient_role
    UNION ALL
    SELECT v_seller_id, 'seller' WHERE v_seller_id IS DISTINCT FROM v_buyer_id
  ) recipients
  WHERE true
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'CRITICAL',
    'Fallo en fn_cancel_shipment',
    jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM)
  );
  RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cancel_shipment(uuid, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancel_shipment(uuid, text, text, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_complete_shipment_refund(p_shipment_id uuid)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_buyer_id UUID;
  v_shipment_status TEXT;
  v_stripe_payment_intent_id TEXT;
  v_dispute_id UUID;
BEGIN
  -- 1. Validar shipment y obtener datos (Usa public.shipments y public.orders)
  SELECT s.order_id, s.seller_id, s.status::TEXT, s.stripe_payment_intent_id, o.buyer_id
  INTO v_order_id, v_seller_id, v_shipment_status, v_stripe_payment_intent_id, v_buyer_id
  FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- Connect guard: Connect refunds are handled by Stripe reverse_transfer in
  -- resolve-dispute-refund. For Connect-era shipments this function only marks
  -- the shipment refunded.
  IF v_stripe_payment_intent_id IS NOT NULL THEN
    UPDATE public.shipments
    SET status = 'refunded', updated_at = now()
    WHERE id = p_shipment_id;
    RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET_REFUND'::TEXT; RETURN;
  END IF;

  -- 1b. No reembolsar shipments ya refunded o completed (fondos ya liberados)
  IF v_shipment_status IN ('refunded', 'completed', 'cancelled', 'pending') THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_REFUNDABLE'::TEXT; RETURN;
  END IF;

  -- 2. Obtener dispute asociado
  SELECT id INTO v_dispute_id FROM public.disputes
  WHERE shipment_id = p_shipment_id AND status NOT IN ('resolved', 'rejected')
  LIMIT 1;

  -- 3. Liberar productos de este shipment
  UPDATE public.products SET status = 'IN_REVIEW', updated_at = now()
  WHERE id IN (SELECT product_id FROM public.order_items WHERE shipment_id = p_shipment_id);

  -- 4. Marcar shipment como refunded (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'refunded', updated_at = now()
  WHERE id = p_shipment_id;

  -- 5. Resolver la disputa si existe
  IF v_dispute_id IS NOT NULL THEN
    UPDATE public.disputes
    SET status = 'resolved', resolution_type = 'buyer', updated_at = now()
    WHERE id = v_dispute_id;
  END IF;

  -- 6. Notificaciones
  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES
    (v_buyer_id, 'success', 'Reembolso Finalizado', 'Tu dinero ha sido devuelto.', '/profile/orders/' || v_order_id),
    (v_seller_id, 'warning', 'Producto Reembolsado', 'El producto está en revisión técnica.', '/profile/orders/' || v_order_id);

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_complete_shipment_refund',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_complete_shipment_refund(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_complete_shipment_refund(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_close_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status public.account_status;
  v_customer_id text;
  v_account_id text;
  v_closure public.account_closures%ROWTYPE;
  v_closed_at timestamptz := now();
  v_username text;
  v_attempt integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- A. Lock the private profile: concurrent closures of one user serialize here.
  SELECT status, stripe_customer_id, stripe_account_id
    INTO v_status, v_customer_id, v_account_id
  FROM public.profiles_private
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Idempotent retry: report the stored cleanup state and change nothing.
  SELECT * INTO v_closure FROM public.account_closures WHERE user_id = p_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_closed',
      'closed_at', v_closure.closed_at,
      'stripe_customer_id', v_closure.stripe_customer_id,
      'stripe_account_id', v_closure.stripe_account_id,
      'stripe_customer_cleanup', v_closure.stripe_customer_cleanup,
      'stripe_account_cleanup', v_closure.stripe_account_cleanup,
      'storage_cleanup', v_closure.storage_cleanup
    );
  END IF;

  -- B. Suspended and banned accounts keep their evidence and cannot self-close.
  IF v_status IN ('suspended', 'banned') THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'account_restricted');
  END IF;

  -- C. Lock the user's listings so no sale or edit slips in during the checks
  -- (ordered by id like fn_reserve_products, so a concurrent cart cannot deadlock).
  PERFORM 1 FROM public.products WHERE seller_id = p_user_id ORDER BY id FOR UPDATE;

  -- Seller side: shipments, orders and listings still moving.
  IF EXISTS (
    SELECT 1 FROM public.shipments s
    WHERE s.seller_id = p_user_id
      AND s.status NOT IN ('completed', 'cancelled', 'refunded')
  ) OR EXISTS (
    SELECT 1 FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.seller_id = p_user_id
      AND o.status NOT IN ('completed', 'cancelled', 'refunded')
  ) OR EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.seller_id = p_user_id
      AND p.status IN ('RESERVED', 'IN_DISPUTE')
      AND p.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'active_shipments');
  END IF;

  -- Buyer side: orders not finished.
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.buyer_id = p_user_id
      AND o.status NOT IN ('completed', 'cancelled', 'refunded')
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'active_orders');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.disputes d
    WHERE (d.buyer_id = p_user_id OR d.seller_id = p_user_id)
      AND d.status IN ('open', 'under_review', 'waiting_return', 'return_shipped', 'return_delivered')
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'open_disputes');
  END IF;

  -- Seller funds: a completed Connect shipment is released only when its latest
  -- payout run is paid (same rule as admin_connect_payout_release_view). Runs
  -- still pending or needing reconciliation block as well.
  IF EXISTS (
    SELECT 1 FROM public.admin_connect_payout_release_view v
    WHERE v.seller_id = p_user_id
      AND v.status = 'completed'
      AND v.stripe_payment_intent_id IS NOT NULL
      AND v.release_amount_cents > 0
      AND v.payout_run_status IS DISTINCT FROM 'paid'
  ) OR EXISTS (
    SELECT 1 FROM public.connect_payout_runs r
    WHERE r.seller_id = p_user_id
      AND r.status IN ('pending_reconciliation', 'reconciliation_needed')
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'pending_payouts');
  END IF;

  -- Refunds in flight: a started shipment cancellation whose refund is not
  -- settled (pending, failed or canceled and not resolved by an admin, or the
  -- cancellation itself unfinished) and orders still compensating a payment.
  IF EXISTS (
    SELECT 1
    FROM public.shipment_cancellation_operations c
    JOIN public.shipments s ON s.id = c.shipment_id
    JOIN public.orders o ON o.id = c.order_id
    WHERE (o.buyer_id = p_user_id OR s.seller_id = p_user_id)
      AND c.external_started_at IS NOT NULL
      AND c.refund_resolved_at IS NULL
      AND (
        c.refund_status IN ('pending', 'requires_action', 'failed', 'canceled')
        OR s.status NOT IN ('cancelled', 'refunded')
      )
  ) OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.compensation_state IS NOT NULL
      AND o.compensation_state <> 'refunded'
      AND (
        o.buyer_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.order_items oi
          WHERE oi.order_id = o.id AND oi.seller_id = p_user_id
        )
      )
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'pending_refunds');
  END IF;

  -- D. Anonymize. The public profile becomes a deleted user. The username is
  -- "deleted_" plus 12 hex characters (within the 3..20 rule); a taken
  -- candidate (another closure or a name a user chose) moves to the next one,
  -- so UNIQUE (username) never aborts the closure.
  LOOP
    v_username := 'deleted_' || substr(md5(p_user_id::text || v_attempt::text), 1, 12);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE username = v_username AND id <> p_user_id
    );
    v_attempt := v_attempt + 1;
  END LOOP;

  UPDATE public.profiles SET
    username = v_username,
    avatar_url = NULL,
    is_verified_seller = false,
    deleted_at = now(),
    updated_at = now()
  WHERE id = p_user_id;

  -- The closed account stays banned: a still-valid access token cannot publish,
  -- sell or request payouts, and no routine admin action reactivates it.
  UPDATE public.profiles_private SET
    email = NULL,
    phone_number = NULL,
    stripe_customer_id = NULL,
    stripe_account_id = NULL,
    last_sign_in_at = NULL,
    role = 'user',
    status = 'banned',
    status_reason = 'account_closed',
    status_updated_at = now(),
    status_updated_by = 'system:account_closure',
    updated_at = now()
  WHERE id = p_user_id;

  DELETE FROM public.payment_methods WHERE user_id = p_user_id;
  DELETE FROM public.favorites WHERE user_id = p_user_id;
  DELETE FROM public.blocked_users WHERE blocker_id = p_user_id OR blocked_id = p_user_id;
  DELETE FROM public.notifications WHERE user_id = p_user_id;

  -- A shipment keeps its origin address id, so an address a shipment points to
  -- cannot be deleted; its personal data is scrubbed in place instead.
  DELETE FROM public.addresses a
  WHERE a.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.shipments s WHERE s.origin_address_id = a.id
    );
  UPDATE public.addresses SET
    full_name = 'Deleted',
    phone = '',
    street_line1 = '',
    street_line2 = NULL,
    street_number = NULL,
    district = NULL,
    city = '',
    state = '',
    zip_code = '',
    latitude = NULL,
    longitude = NULL,
    instructions = NULL,
    label = 'deleted',
    is_default = false,
    deleted_at = COALESCE(deleted_at, now())
  WHERE user_id = p_user_id;

  -- Listings never sold are soft-deleted like fn_admin_soft_delete_product does.
  -- Listings that appear in order_items stay as ledger rows but are hidden from
  -- sale unless already SOLD.
  UPDATE public.products SET deleted_at = now(), status = 'HIDDEN',
    status_before_account_hold = NULL, updated_at = now()
  WHERE seller_id = p_user_id
    AND deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi WHERE oi.product_id = products.id
    );
  UPDATE public.products SET status = 'HIDDEN',
    status_before_account_hold = NULL, updated_at = now()
  WHERE seller_id = p_user_id
    AND deleted_at IS NULL
    AND status NOT IN ('SOLD', 'HIDDEN');

  -- E. Auth side. The auth.users row stays (ledger foreign keys point to it)
  -- but loses every credential and identifier, and is banned for good. The
  -- timestamp is a finite far-future value GoTrue can parse ('infinity' is not).
  -- fn_on_auth_user_updated mirrors the NULL email into profiles_private.
  UPDATE auth.users SET
    email = NULL,
    phone = NULL,
    encrypted_password = '',
    email_confirmed_at = NULL,
    phone_confirmed_at = NULL,
    last_sign_in_at = NULL,
    raw_user_meta_data = '{}'::jsonb,
    raw_app_meta_data = jsonb_build_object('account_closed', true),
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change_token_current = '',
    email_change = '',
    phone_change = '',
    phone_change_token = '',
    reauthentication_token = '',
    banned_until = timestamptz '9999-01-01 00:00:00+00',
    updated_at = now()
  WHERE id = p_user_id;

  DELETE FROM auth.identities WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  DELETE FROM auth.mfa_factors WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;
  DELETE FROM auth.flow_state WHERE user_id = p_user_id;
  DELETE FROM auth.webauthn_credentials WHERE user_id = p_user_id;

  -- F. Record the closure and hand the Stripe ids to the caller for cleanup.
  INSERT INTO public.account_closures (
    user_id, closed_at, stripe_customer_id, stripe_account_id,
    stripe_customer_cleanup, stripe_account_cleanup, storage_cleanup
  ) VALUES (
    p_user_id, v_closed_at, v_customer_id, v_account_id,
    CASE WHEN v_customer_id IS NULL THEN 'not_needed' ELSE 'pending' END,
    CASE WHEN v_account_id IS NULL THEN 'not_needed' ELSE 'pending' END,
    'pending'
  );

  RETURN jsonb_build_object(
    'status', 'closed',
    'closed_at', v_closed_at,
    'stripe_customer_id', v_customer_id,
    'stripe_account_id', v_account_id,
    'stripe_customer_cleanup', CASE WHEN v_customer_id IS NULL THEN 'not_needed' ELSE 'pending' END,
    'stripe_account_cleanup', CASE WHEN v_account_id IS NULL THEN 'not_needed' ELSE 'pending' END,
    'storage_cleanup', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_close_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_close_account(uuid) TO service_role;

COMMIT;
