-- =========================================================================
-- Liberación automática 48h para un shipment (cron)
-- =========================================================================
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

  -- Connect guard: if shipment was paid via Stripe Connect, skip wallet release.
  -- Stripe Connect handles fund routing and automatic payouts. Wallet operations
  -- only apply to legacy (pre-Connect) orders.
  IF EXISTS (
    SELECT 1 FROM public.shipments
    WHERE id = p_shipment_id AND stripe_payment_intent_id IS NOT NULL
  ) THEN
    -- Mark shipment as completed without touching wallets
    UPDATE public.shipments SET status = 'completed' WHERE id = p_shipment_id;
    RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET'::TEXT; RETURN;
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
