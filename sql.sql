-- =========================================================================
-- FASE 3: TRIGGER DE ESTADO DERIVADO CON MATRIZ DE PRIORIDAD Y BLINDAJE RLS
-- =========================================================================

-- 3.1 Función de derivación con matriz de prioridades
CREATE OR REPLACE FUNCTION public.fn_derive_order_status(p_order_id UUID)
RETURNS public.order_status_enum
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_statuses public.order_status_enum[];
BEGIN
  SELECT array_agg(DISTINCT s.status)
  INTO v_statuses
  FROM public.shipments s
  WHERE s.order_id = p_order_id;

  IF v_statuses IS NULL THEN
    RETURN 'pending';
  END IF;

  -- 1. Estados excepcionales (cualquier shipment → orden afectada)
  IF 'dispute'    = ANY(v_statuses) THEN RETURN 'dispute';  END IF;
  IF 'refunded'   = ANY(v_statuses) THEN RETURN 'refunded'; END IF;
  IF 'cancelled'  = ANY(v_statuses) THEN RETURN 'cancelled'; END IF;

  -- 2. Progreso logístico (el menos avanzado manda)
  IF 'paid'       = ANY(v_statuses) THEN RETURN 'paid';      END IF;
  IF 'preparing'  = ANY(v_statuses) THEN RETURN 'preparing'; END IF;
  IF 'shipped'    = ANY(v_statuses) THEN RETURN 'shipped';   END IF;
  IF 'delivered'  = ANY(v_statuses) THEN RETURN 'delivered'; END IF;

  -- 3. Todos completos
  IF 'completed'  = ALL(v_statuses) THEN RETURN 'completed'; END IF;

  RETURN 'paid';
END;
$$;

-- 3.2 Función trigger
CREATE OR REPLACE FUNCTION public.fn_shipments_status_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $$
BEGIN
  UPDATE public.orders
  SET status = public.fn_derive_order_status(NEW.order_id),
      updated_at = now()
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$;

-- 3.3 Trigger en la tabla shipments
DROP TRIGGER IF EXISTS trg_shipments_status ON public.shipments;
CREATE TRIGGER trg_shipments_status
  AFTER INSERT OR UPDATE OF status
  ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_shipments_status_trigger();

-- =========================================================================
-- FASE 4: FUNCIONES TRANSACCIONALES A NIVEL DE SHIPMENT
-- =========================================================================

-- 4.1 Confirmar entrega de un shipment individual (buyer)
DROP FUNCTION IF EXISTS public.fn_confirm_shipment_delivery;
CREATE OR REPLACE FUNCTION public.fn_confirm_shipment_delivery(p_shipment_id UUID)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER  -- wallets sin UPDATE policy; buyer NO debe mutar wallet del seller como INVOKER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status public.order_status_enum;
  v_buyer_id UUID;
  v_wallet_id UUID;
  v_wallet_balance NUMERIC;
  v_net_payout NUMERIC;
BEGIN
  -- 1. Bloquear shipment
  SELECT order_id, seller_id, status INTO v_order_id, v_seller_id, v_status
  FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Validar caller es el comprador
  SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_order_id;
  IF v_buyer_id IS DISTINCT FROM auth.uid() THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 3. Validar status del shipment
  IF v_status NOT IN ('shipped', 'delivered') THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE'::TEXT; RETURN;
  END IF;

  -- 4. Validar que no haya disputa activa en este shipment
  IF EXISTS (
    SELECT 1 FROM public.disputes
    WHERE shipment_id = p_shipment_id AND status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_HAS_ACTIVE_DISPUTE'::TEXT; RETURN;
  END IF;

  -- 5. Validar wallet del seller
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_seller_id) THEN
    RETURN QUERY SELECT false, format('SELLER_WALLET_NOT_FOUND: %s', v_seller_id); RETURN;
  END IF;

  -- 6. Calcular net_payout de este shipment
  SELECT COALESCE(SUM(net_payout), 0) INTO v_net_payout
  FROM public.order_items
  WHERE shipment_id = p_shipment_id;

  -- 7. Mutación financiera (solo este shipment)
  SELECT id, available_balance INTO v_wallet_id, v_wallet_balance
  FROM public.wallets WHERE user_id = v_seller_id FOR UPDATE;

  UPDATE public.wallets
  SET pending_balance = GREATEST(0, pending_balance - v_net_payout),
      available_balance = available_balance + v_net_payout,
      updated_at = now()
  WHERE id = v_wallet_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'WALLET_UPDATE_FAILED'::TEXT; RETURN;
  END IF;

  INSERT INTO public.wallet_transactions
    (wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description)
  VALUES (
    v_wallet_id, v_order_id, p_shipment_id, v_net_payout, v_net_payout,
    v_wallet_balance + v_net_payout, 'release',
    'Liberación por confirmación del comprador — Shipment ' || p_shipment_id
  );

  -- 8. Marcar shipment completado (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_confirm_shipment_delivery',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

-- API hardening
REVOKE EXECUTE ON FUNCTION public.fn_confirm_shipment_delivery(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_confirm_shipment_delivery(UUID) TO authenticated;

-- 4.2 Liberación automática 48h para un shipment (cron)
DROP FUNCTION IF EXISTS public.fn_release_shipment_funds;
CREATE OR REPLACE FUNCTION public.fn_release_shipment_funds(p_shipment_id UUID)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status public.order_status_enum;
  v_delivered_at TIMESTAMPTZ;
  v_wallet_id UUID;
  v_wallet_balance NUMERIC;
  v_net_payout NUMERIC;
BEGIN
  -- 1. Bloquear shipment
  SELECT order_id, seller_id, status, delivered_at
    INTO v_order_id, v_seller_id, v_status, v_delivered_at
  FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Solo shipments entregados
  IF v_status != 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_DELIVERED'::TEXT; RETURN;
  END IF;

  -- 3. Ignorar si hay disputa activa
  IF EXISTS (
    SELECT 1 FROM public.disputes
    WHERE shipment_id = p_shipment_id AND status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_IN_ACTIVE_DISPUTE'::TEXT; RETURN;
  END IF;

  -- 4. Tiempo de gracia 48h
  IF v_delivered_at > (now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'GRACE_PERIOD_ACTIVE'::TEXT; RETURN;
  END IF;

  -- 5. Calcular net_payout de este shipment (COALESCE por defensa ante NULL)
  SELECT COALESCE(SUM(net_payout), 0) INTO v_net_payout
  FROM public.order_items
  WHERE shipment_id = p_shipment_id;

  -- 6. Validar wallet del seller
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_seller_id) THEN
    RETURN QUERY SELECT false, format('SELLER_WALLET_NOT_FOUND: %s', v_seller_id); RETURN;
  END IF;

  -- 7. Liberar fondos
  SELECT id, available_balance INTO v_wallet_id, v_wallet_balance
  FROM public.wallets WHERE user_id = v_seller_id FOR UPDATE;

  UPDATE public.wallets
  SET pending_balance = GREATEST(0, pending_balance - v_net_payout),
      available_balance = available_balance + v_net_payout,
      updated_at = now()
  WHERE id = v_wallet_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'WALLET_UPDATE_FAILED'::TEXT; RETURN;
  END IF;

  INSERT INTO public.wallet_transactions
    (wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description)
  VALUES (
    v_wallet_id, v_order_id, p_shipment_id, v_net_payout, v_net_payout,
    v_wallet_balance + v_net_payout, 'release',
    'Liberación automática post-entrega (48h) — Shipment ' || p_shipment_id
  );

  -- 8. Marcar completado (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_release_shipment_funds',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

-- API hardening: solo service_role (cron/edge functions), NO accessible por REST
REVOKE EXECUTE ON FUNCTION public.fn_release_shipment_funds(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_release_shipment_funds(UUID) TO service_role;

-- 4.3 Cancelar un shipment individual (admin, seller o sistema)
DROP FUNCTION IF EXISTS public.fn_cancel_shipment;
CREATE OR REPLACE FUNCTION public.fn_cancel_shipment(
  p_shipment_id UUID,
  p_cancelled_by_role TEXT,
  p_reason TEXT
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER  -- muta wallets del seller, RLS bloquea UPDATE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status public.order_status_enum;
  v_buyer_id UUID;
  v_wallet_id UUID;
  v_wallet_pending NUMERIC;
  v_wallet_available NUMERIC;
  v_total_refund NUMERIC;
  v_item RECORD;
BEGIN
  -- 1. Bloquear shipment
  SELECT order_id, seller_id, status INTO v_order_id, v_seller_id, v_status
  FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT true, 'ALREADY_CANCELLED'::TEXT; RETURN;
  END IF;

  IF v_status NOT IN ('paid', 'preparing') THEN
    RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT; RETURN;
  END IF;

  -- 2. Autorización según rol declarado (estructura estricta: solo roles explícitos pasan)
  IF p_cancelled_by_role = 'admin' THEN
    IF NOT is_admin() THEN
      RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;
  ELSIF p_cancelled_by_role = 'seller' THEN
    IF auth.uid() IS DISTINCT FROM v_seller_id THEN
      RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;
  ELSIF p_cancelled_by_role = 'system' THEN
    -- cron/service_role, sin check adicional
    NULL;
  ELSE
    -- cualquier rol no reconocido (buyer, hacker, etc.) → rechazar
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 3. Obtener buyer_id para notificaciones
  SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_order_id;

  -- 4. Sumar net_payout del shipment (una sola operación)
  SELECT COALESCE(SUM(COALESCE(net_payout, 0)), 0) INTO v_total_refund
  FROM public.order_items WHERE shipment_id = p_shipment_id;

  -- 5. Revertir wallet del seller (una sola vez)
  SELECT id, pending_balance, available_balance
    INTO v_wallet_id, v_wallet_pending, v_wallet_available
  FROM public.wallets WHERE user_id = v_seller_id FOR UPDATE;

  IF v_wallet_id IS NOT NULL THEN
    UPDATE public.wallets
    SET pending_balance = GREATEST(0, pending_balance - v_total_refund),
        updated_at = now()
    WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions
      (wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description)
    VALUES (
      v_wallet_id, v_order_id, p_shipment_id,
      0, -v_total_refund,
      v_wallet_available,  -- available_balance intacto (el dinero estaba en escrow)
      'adjustment',
      'Cancelación (' || p_cancelled_by_role || '): ' || p_reason
    );
  END IF;

  -- 6. Liberar productos + notificar vendedor (loop liviano, sin wallet)
  FOR v_item IN
    SELECT oi.product_id, p.name as prod_name
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.shipment_id = p_shipment_id
  LOOP
    UPDATE public.products
    SET status = 'VERIFIED', reserved_at = NULL, updated_at = now()
    WHERE id = v_item.product_id;

    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (
      v_seller_id, 'warning',
      'Venta Cancelada',
      'Tu producto "' || v_item.prod_name || '" ha regresado a tu inventario por cancelación.',
      '/profile/listings'
    );
  END LOOP;

  -- 7. Marcar shipment cancelado (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_shipment_id;

  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES (
    v_buyer_id, 'info',
    'Pedido Cancelado',
    'Tu reembolso ha sido procesado. El dinero regresará a tu cuenta según los tiempos de tu banco.',
    '/profile/orders'
  );

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('CRITICAL', 'Fallo en fn_cancel_shipment',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

-- API hardening
REVOKE EXECUTE ON FUNCTION public.fn_cancel_shipment(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cancel_shipment(UUID, TEXT, TEXT) TO authenticated;

-- 4.4 fn_create_order_from_payment modificada (crea 1 order + N shipments)
CREATE OR REPLACE FUNCTION public.fn_create_order_from_payment(
  p_buyer_id UUID,
  p_stripe_intent_id TEXT,
  p_total_amount NUMERIC,
  p_service_fee NUMERIC,
  p_address_id UUID,
  p_product_ids UUID[]
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_addr_snapshot JSONB;
  v_prod RECORD;
  v_seller RECORD;
  v_wallet_id UUID;
  v_wallet_pending NUMERIC;
  v_net_payout NUMERIC;
  v_commission_pct NUMERIC;
  v_shipment_id UUID;
  v_shipments_cache JSONB := '{}'::JSONB; -- {seller_id: shipment_id}
  v_wallet_available NUMERIC;
BEGIN
  -- 1. Idempotencia
  IF EXISTS (SELECT 1 FROM public.orders WHERE stripe_payment_intent_id = p_stripe_intent_id) THEN
    RETURN QUERY SELECT true, 'ALREADY_PROCESSED'::TEXT; RETURN;
  END IF;

  -- 2. Config
  SELECT service_fee_pct INTO v_commission_pct FROM public.system_settings LIMIT 1;

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

    v_net_payout := v_prod.price - (v_prod.price * v_commission_pct) - COALESCE(v_prod.shipping_cost, 0);

    -- Asignar shipment_id según el seller
    v_shipment_id := (v_shipments_cache ->> v_prod.seller_id::TEXT)::UUID;

    INSERT INTO public.order_items (
      order_id, product_id, seller_id, price_at_purchase,
      commission_amount, shipping_amount, net_payout, shipment_id
    )
    VALUES (
      v_order_id, v_prod.id, v_prod.seller_id, v_prod.price,
      (v_prod.price * v_commission_pct), COALESCE(v_prod.shipping_cost, 0),
      v_net_payout, v_shipment_id
    );

    -- Wallet
    SELECT id, pending_balance, available_balance
      INTO v_wallet_id, v_wallet_pending, v_wallet_available
    FROM public.wallets WHERE user_id = v_prod.seller_id FOR UPDATE;

    UPDATE public.wallets
    SET pending_balance = pending_balance + v_net_payout,
        updated_at = now()
    WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description
    )
    VALUES (
      v_wallet_id, v_order_id, v_shipment_id, v_prod.price, v_net_payout,
      v_wallet_available,  -- available_balance intacto (el cobro entra a pending)
      'sale_proceeds',
      'Venta: ' || v_prod.name
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

-- API hardening: solo service_role (edge function webhook), NO accesible por REST
REVOKE EXECUTE ON FUNCTION public.fn_create_order_from_payment(UUID, TEXT, NUMERIC, NUMERIC, UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_order_from_payment(UUID, TEXT, NUMERIC, NUMERIC, UUID, UUID[]) TO service_role;

-- 4.5 Refund de shipment individual — función NUEVA, no toca fn_complete_dispute_refund (vieja) que sigue viva
CREATE OR REPLACE FUNCTION public.fn_complete_shipment_refund(p_shipment_id UUID)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER  -- muta wallets, RLS bloquea UPDATE como INVOKER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_buyer_id UUID;
  v_shipment_status TEXT;
  v_net_payout NUMERIC;
  v_wallet_id UUID;
  v_wallet_available NUMERIC;
  v_dispute_id UUID;
BEGIN
  -- 1. Validar shipment y obtener datos
  SELECT s.order_id, s.seller_id, s.status::TEXT, o.buyer_id
  INTO v_order_id, v_seller_id, v_shipment_status, v_buyer_id
  FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 1b. No reembolsar shipments ya refunded o completed (fondos ya liberados)
  IF v_shipment_status IN ('refunded', 'completed', 'cancelled', 'pending') THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_REFUNDABLE'::TEXT; RETURN;
  END IF;

  -- 2. Obtener dispute asociado
  SELECT id INTO v_dispute_id FROM public.disputes
  WHERE shipment_id = p_shipment_id AND status NOT IN ('resolved', 'rejected')
  LIMIT 1;

  -- 3. Calcular net_payout de este shipment (COALESCE por defensa ante NULL)
  SELECT COALESCE(SUM(net_payout), 0) INTO v_net_payout
  FROM public.order_items WHERE shipment_id = p_shipment_id;

  -- 4. Revertir pending_balance del seller
  UPDATE public.wallets
  SET pending_balance = GREATEST(0, pending_balance - v_net_payout),
      updated_at = now()
  WHERE user_id = v_seller_id
  RETURNING id, available_balance INTO v_wallet_id, v_wallet_available;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'WALLET_UPDATE_FAILED'::TEXT; RETURN;
  END IF;

  -- 5. Ledger
  INSERT INTO public.wallet_transactions (wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description)
  VALUES (v_wallet_id, v_order_id, p_shipment_id, -v_net_payout, -v_net_payout, v_wallet_available, 'refund', 'Reembolso por disputa resuelta — Shipment ' || p_shipment_id);

  -- 6. Liberar productos de este shipment
  UPDATE public.products SET status = 'IN_REVIEW', updated_at = now()
  WHERE id IN (SELECT product_id FROM public.order_items WHERE shipment_id = p_shipment_id);

  -- 7. Marcar shipment como refunded (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'refunded', updated_at = now()
  WHERE id = p_shipment_id;

  -- 8. Resolver la disputa si existe
  IF v_dispute_id IS NOT NULL THEN
    UPDATE public.disputes
    SET status = 'resolved', resolution_type = 'buyer', updated_at = now()
    WHERE id = v_dispute_id;
  END IF;

  -- 9. Notificaciones
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

-- API hardening
REVOKE EXECUTE ON FUNCTION public.fn_complete_shipment_refund(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_complete_shipment_refund(UUID) TO service_role;

-- 4.6 Confirmar retorno + gatillar refund — función NUEVA, no toca fn_confirm_return_receipt (vieja) que sigue viva
CREATE OR REPLACE FUNCTION public.fn_seller_confirm_return_shipment(p_shipment_id UUID)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER  -- llama a fn_complete_shipment_refund que muta wallets
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_seller_id UUID;
  v_order_id UUID;
  v_dispute_id UUID;
  v_dispute_status public.dispute_status;
BEGIN
  -- 1. Validar shipment
  SELECT s.seller_id, s.order_id INTO v_seller_id, v_order_id
  FROM public.shipments s WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Obtener dispute activo de este shipment
  SELECT id, status INTO v_dispute_id, v_dispute_status
  FROM public.disputes
  WHERE shipment_id = p_shipment_id AND seller_id = v_seller_id
  ORDER BY created_at DESC LIMIT 1;

  IF v_dispute_id IS NULL THEN
    RETURN QUERY SELECT false, 'NO_ACTIVE_DISPUTE'::TEXT; RETURN;
  END IF;

  -- 3. Autorización: seller del shipment o admin con override
  IF v_seller_id IS DISTINCT FROM auth.uid() AND NOT is_admin() THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 4. Validar status de la disputa
  IF v_dispute_status NOT IN ('return_delivered', 'waiting_return') THEN
    RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
  END IF;

  -- 5. Actualizar disputa
  UPDATE public.disputes
  SET status = 'resolved',
      resolution_type = 'buyer',
      return_delivered_at = COALESCE(return_delivered_at, now()),
      admin_notes = COALESCE(admin_notes, '') || CASE WHEN is_admin() THEN E'\n[SYSTEM]: Administrador forzó confirmación de retorno.' ELSE E'\n[SYSTEM]: Vendedor confirmó recepción manual.' END,
      updated_at = now()
  WHERE id = v_dispute_id;

  -- 6. Auditoría (solo admins, seller no contamina la bitácora administrativa)
  IF is_admin() THEN
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (auth.uid(), 'ADMIN_FORCED_RETURN_CONFIRMATION', v_dispute_id, jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id));
  END IF;

  -- 7. Gatillar refund del shipment
  RETURN QUERY SELECT * FROM public.fn_complete_shipment_refund(p_shipment_id);

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_seller_confirm_return_shipment',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

-- API hardening
REVOKE EXECUTE ON FUNCTION public.fn_seller_confirm_return_shipment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_seller_confirm_return_shipment(UUID) TO authenticated;

-- =========================================================================
-- FASE 4.7 — CRON: Auto-complete 48h para shipments delivered
-- =========================================================================

-- Función batch que el cron llama sin parámetros
DROP FUNCTION IF EXISTS public.fn_cron_release_shipment_funds;
CREATE OR REPLACE FUNCTION public.fn_cron_release_shipment_funds()
RETURNS TABLE(total_processed INT, total_errors INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_shipment_id   UUID;
  v_processed     INT := 0;
  v_errors        INT := 0;
  v_success       BOOLEAN;
  v_error_message TEXT;
BEGIN
  FOR v_shipment_id IN
    SELECT s.id
    FROM public.shipments s
    WHERE s.status = 'delivered'
      AND s.delivered_at < now() - interval '48 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.disputes d
        WHERE d.shipment_id = s.id
          AND d.status NOT IN ('resolved', 'rejected')
      )
  LOOP
    BEGIN
      SELECT * INTO v_success, v_error_message
      FROM public.fn_release_shipment_funds(v_shipment_id);

      IF v_success THEN
        v_processed := v_processed + 1;
      ELSE
        INSERT INTO public.system_logs (level, message, metadata)
        VALUES ('WARNING', 'Cron release-shipment-funds: fallo lógico en shipment',
                jsonb_build_object('shipment_id', v_shipment_id, 'error', v_error_message));
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('ERROR', 'Cron release-shipment-funds: excepción física en shipment',
              jsonb_build_object('shipment_id', v_shipment_id, 'error', SQLERRM));
      v_errors := v_errors + 1;
    END;
  END LOOP;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Cron release-shipment-funds completado',
          jsonb_build_object('processed', v_processed, 'errors', v_errors));

  RETURN QUERY SELECT v_processed, v_errors;
END;
$$;

-- API hardening
REVOKE EXECUTE ON FUNCTION public.fn_cron_release_shipment_funds() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cron_release_shipment_funds() TO service_role;

-- Schedule: ejecutar cada hora
SELECT cron.schedule(
  'release-shipment-funds',
  '0 * * * *',
  'SELECT * FROM public.fn_cron_release_shipment_funds()'
);

-- =========================================================================
-- FASE 4.8 — RPC para track-returns: marca retorno como entregado
-- =========================================================================

DROP FUNCTION IF EXISTS public.fn_mark_return_delivered;
CREATE OR REPLACE FUNCTION public.fn_mark_return_delivered(p_dispute_id UUID)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_status      TEXT;
  v_buyer_id    UUID;
  v_seller_id   UUID;
  v_order_id    UUID;
BEGIN
  -- 1. Validar dispute y obtener datos para notificaciones
  SELECT d.status::TEXT, d.buyer_id, d.seller_id, d.order_id
  INTO v_status, v_buyer_id, v_seller_id, v_order_id
  FROM public.disputes d WHERE d.id = p_dispute_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Solo avanzar si está en flujo de retorno activo
  IF v_status NOT IN ('waiting_return', 'return_shipped') THEN
    RETURN QUERY SELECT false, format('INVALID_DISPUTE_STATUS: %s', v_status); RETURN;
  END IF;

  -- 3. Marcar como entregado
  UPDATE public.disputes
  SET status = 'return_delivered',
      return_delivered_at = now(),
      updated_at = now()
  WHERE id = p_dispute_id;

  -- 4. Notificaciones
  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES
    (v_seller_id, 'warning', 'Retorno Entregado', 'Has recibido el producto devuelto. Tienes 7 días para revisarlo y reportar anomalías.', '/profile/orders/' || v_order_id),
    (v_buyer_id, 'info', 'Paquete devuelto', 'El vendedor ha recibido el producto. Tu reembolso se procesará en breve.', '/profile/orders/' || v_order_id);

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_mark_return_delivered',
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

-- API hardening
REVOKE EXECUTE ON FUNCTION public.fn_mark_return_delivered(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_mark_return_delivered(UUID) TO service_role;

-- =========================================================================
-- FASE 4.9 — RPC para track-shipments: marca shipment como delivered (NO libera fondos)
-- =========================================================================

DROP FUNCTION IF EXISTS public.fn_mark_shipment_delivered;
CREATE OR REPLACE FUNCTION public.fn_mark_shipment_delivered(p_shipment_id UUID)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  -- 1. Validar shipment
  SELECT status::TEXT INTO v_current_status
  FROM public.shipments WHERE id = p_shipment_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Solo avanzar si está en tránsito
  IF v_current_status NOT IN ('shipped', 'preparing') THEN
    RETURN QUERY SELECT false, format('INVALID_SHIPMENT_STATUS: %s', v_current_status); RETURN;
  END IF;

  -- 3. Marcar como entregado — SOLO inicia el reloj de 48h, NO libera fondos
  UPDATE public.shipments
  SET status = 'delivered',
      delivered_at = now(),
      updated_at = now()
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_mark_shipment_delivered',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

-- API hardening
REVOKE EXECUTE ON FUNCTION public.fn_mark_shipment_delivered(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_mark_shipment_delivered(UUID) TO service_role;

-- =========================================================================
-- FASE 10 — CRON: Auto-refund 48h después de return_delivered
-- =========================================================================

-- Busca disputes en return_delivered > 48h y gatilla refund automático
DROP FUNCTION IF EXISTS public.fn_cron_return_delivery_timeout;
CREATE OR REPLACE FUNCTION public.fn_cron_return_delivery_timeout()
RETURNS TABLE(total_processed INT, total_errors INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_dispute    RECORD;
  v_processed  INT := 0;
  v_errors     INT := 0;
  v_success    BOOLEAN;
  v_err_msg    TEXT;
BEGIN
  FOR v_dispute IN
    SELECT d.id, d.shipment_id, d.buyer_id, d.seller_id, d.order_id
    FROM public.disputes d
    WHERE d.status = 'return_delivered'
      AND d.updated_at < now() - interval '48 hours'
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT * INTO v_success, v_err_msg
      FROM public.fn_complete_shipment_refund(v_dispute.shipment_id);

      IF v_success THEN
        -- Notificar
        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES
          (v_dispute.buyer_id, 'success', 'Reembolso Completado', 'Tu reembolso ha sido procesado. El vendedor no confirmó la recepción del retorno.', '/profile/orders/' || v_dispute.order_id),
          (v_dispute.seller_id, 'warning', 'Retorno sin Confirmar', 'No confirmaste la recepción del retorno en 48h. El reembolso al comprador fue procesado automáticamente.', '/profile/orders/' || v_dispute.order_id);
        v_processed := v_processed + 1;
      ELSE
        INSERT INTO public.system_logs (level, message, metadata)
        VALUES ('WARNING', 'Cron return-delivery-timeout: fallo en dispute',
                jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err_msg));
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

-- API hardening
REVOKE EXECUTE ON FUNCTION public.fn_cron_return_delivery_timeout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cron_return_delivery_timeout() TO service_role;

-- Schedule: cada hora
SELECT cron.schedule(
  'return-delivery-timeout',
  '0 * * * *',
  'SELECT * FROM public.fn_cron_return_delivery_timeout()'
);

-- =========================================================================
-- FASE 4.10 — Init return label: validación centralizada + auditoría
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_seller_initiate_return_label(
  p_dispute_id UUID,
  p_caller_id UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_seller_id   UUID;
  v_status      TEXT;
  v_shipment_id UUID;
BEGIN
  -- 1. Validar dispute existe
  SELECT d.seller_id, d.status::TEXT, d.shipment_id
  INTO v_seller_id, v_status, v_shipment_id
  FROM public.disputes d WHERE d.id = p_dispute_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Validar caller es el seller
  IF v_seller_id IS DISTINCT FROM p_caller_id THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 3. Validar dispute en estado correcto
  IF v_status IS DISTINCT FROM 'waiting_return' THEN
    RETURN QUERY SELECT false,
      format('INVALID_DISPUTE_STATUS: %s', v_status)::TEXT;
    RETURN;
  END IF;

  -- 4. Auditoría (idempotente — siempre loguea, no hay side effect)
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Return label initiated by seller',
    jsonb_build_object(
      'dispute_id', p_dispute_id,
      'shipment_id', v_shipment_id,
      'seller_id', v_seller_id
    ));

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

-- API hardening
REVOKE EXECUTE ON FUNCTION public.fn_seller_initiate_return_label(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_seller_initiate_return_label(UUID, UUID) TO service_role;
