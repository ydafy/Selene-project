-- ============================================================================
-- T9e2 (#70 class): every path that returns a listing to the catalog applies
-- the seller account rule through one internal helper.
--
-- Why: 20261030120000_release_reservation_account_hold.sql made the two
-- reservation-release functions hold the listing of a suspended or banned
-- seller (HIDDEN + status_before_account_hold) instead of re-listing it. Three
-- more paths still wrote status = 'VERIFIED' without looking at the seller:
-- the refund branch of fn_finalize_checkout_recovery, fn_reserve_products
-- (stale-reservation cleanup and the partial-cart rollback) and
-- fn_cancel_shipment (the listings of a cancelled shipment).
--
-- Fix: public.fn_release_listings(p_product_ids, p_only_reserved,
-- p_only_expired) holds the rule once (share-locks the sellers' profiles_private
-- rows in id order, then one UPDATE with the status/hold CASE; a NULL seller
-- status reads as active). The five callers keep their own row filter, return
-- values, locks and error codes; only the release statement changed. In
-- fn_cancel_shipment the per-row loop became one set-based call and the unused
-- v_item declaration was dropped.
--
-- Copied from: the canonical files under supabase/queries/. The latest
-- migration defining fn_cancel_shipment (20261026015438_remove_wallet_writes_core)
-- matches its canonical file; fn_reserve_products and
-- fn_finalize_checkout_recovery are last defined by the schema baseline
-- (20261020100000), later migrations only touch their grants.
--
-- Data: the migration writes no existing row.
--
-- Grant review (AGENTS.md):
--   * fn_release_listings is SECURITY INVOKER and internal. EXECUTE is revoked
--     from PUBLIC, anon and authenticated (a client could otherwise release any
--     reserved or sold listing) and granted to service_role only.
--   * Callers: fn_release_stale_reservations and fn_release_products are
--     SECURITY INVOKER, service_role only, so they reach the helper as
--     service_role. fn_reserve_products, fn_finalize_checkout_recovery and
--     fn_cancel_shipment are SECURITY DEFINER owned by postgres, which keeps
--     EXECUTE on the helper as its owner; they run it as postgres.
--   * SELECT ... FOR SHARE on profiles_private needs UPDATE privilege:
--     service_role has UPDATE and SELECT on it (and bypasses RLS); postgres
--     owns it.
--   * The five callers keep their signatures; CREATE OR REPLACE keeps ACLs and
--     the REVOKE/GRANT restate service_role only (anonymous access is not
--     intended). Their grants are unchanged.
--
-- Lock order: the helper locks sellers before updating products, the same order
-- as fn_admin_update_user_status. fn_reserve_products (rollback) and
-- fn_finalize_checkout_recovery already hold product row locks when they call
-- it, so a suspension racing with them can deadlock; PostgreSQL aborts one
-- side with 40P01 and nothing commits half-done.
--
-- Canonical: supabase/queries/products/fn_release_listings.sql and the five
-- caller files (products/fn_release_stale_reservations.sql,
-- products/fn_release_products.sql, products/fn_reserve_products.sql,
-- orders/checkout_recovery.sql, orders/fn_cancel_shipment.sql)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_release_listings(
  p_product_ids UUID[],
  p_only_reserved BOOLEAN,
  p_only_expired BOOLEAN
)
RETURNS SETOF UUID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1
  FROM public.profiles_private pp
  WHERE pp.id IN (
    SELECT s.seller_id
    FROM public.products s
    WHERE s.id = ANY(p_product_ids)
      AND (NOT p_only_reserved OR s.status = 'RESERVED')
      AND (NOT p_only_expired OR s.reserved_at < now() - interval '10 minutes')
  )
  ORDER BY pp.id
  FOR SHARE;

  RETURN QUERY
  UPDATE public.products AS p
  SET status = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN 'VERIFIED'::public.product_status_enum
        ELSE 'HIDDEN'::public.product_status_enum
      END,
      status_before_account_hold = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN p.status_before_account_hold
        ELSE COALESCE(p.status_before_account_hold, 'VERIFIED'::public.product_status_enum)
      END,
      updated_at = now(),
      reserved_at = NULL
  FROM public.products AS s
  LEFT JOIN public.profiles_private AS pp ON pp.id = s.seller_id
  WHERE s.id = p.id
    AND p.id = ANY(p_product_ids)
    AND (NOT p_only_reserved OR p.status = 'RESERVED')
    AND (NOT p_only_expired OR p.reserved_at < now() - interval '10 minutes')
  RETURNING p.id;
END;
$$;

-- Internal: not callable by any client role. Callers are service_role (the two
-- SECURITY INVOKER release functions) and the postgres owner (the SECURITY
-- DEFINER callers), which keeps EXECUTE as owner.
REVOKE EXECUTE ON FUNCTION public.fn_release_listings(UUID[], BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_listings(UUID[], BOOLEAN, BOOLEAN)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_release_stale_reservations(
  p_product_ids UUID[] DEFAULT '{}'
)
RETURNS TABLE(released_id UUID)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT COALESCE(array_agg(s.id), '{}')
    INTO v_ids
  FROM public.products s
  WHERE s.status = 'RESERVED'
    AND s.reserved_at < now() - interval '10 minutes'
    AND (p_product_ids = '{}' OR s.id = ANY(p_product_ids));

  RETURN QUERY
  SELECT * FROM public.fn_release_listings(v_ids, true, true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_release_stale_reservations(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_stale_reservations(UUID[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_release_products(p_product_ids UUID[])
RETURNS TABLE(success BOOLEAN)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_release_listings(p_product_ids, true, false);

  RETURN QUERY SELECT true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_products(UUID[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_reserve_products(
  p_buyer_id UUID,
  p_product_ids UUID[]
)
RETURNS TABLE(total_price NUMERIC, success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
  v_sum NUMERIC;
  v_reserved_ids UUID[];
BEGIN
  -- 0. DEFENSA: Carrito nulo o vacío (retorno inmediato en 0ms)
  IF p_product_ids IS NULL OR cardinality(p_product_ids) = 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, false, 'EMPTY_CART'::TEXT;
    RETURN;
  END IF;

  -- Banned buyers cannot purchase; suspended buyers keep their own purchases
  IF EXISTS (
    SELECT 1 FROM public.profiles_private pp
    WHERE pp.id = p_buyer_id AND pp.status = 'banned'
  ) THEN
    RETURN QUERY SELECT 0::NUMERIC, false, 'ACCOUNT_RESTRICTED'::TEXT;
    RETURN;
  END IF;

  -- 1. LIMPIEZA IDEMPOTENTE: Recuperar reservas vencidas (> 10 min) de este carrito
  PERFORM public.fn_release_listings(p_product_ids, true, true);

  -- 2. SEGURO ANTI-DEADLOCK: Bloqueo determinístico en orden alfabético de UUID
  PERFORM 1
  FROM public.products
  WHERE id = ANY(p_product_ids)
  ORDER BY id
  FOR UPDATE;

  -- 3. RESERVA ATÓMICA: Solo productos VERIFIED que no sean del comprador
  --    ni de vendedores suspendidos o baneados
  WITH reserved AS (
    UPDATE public.products
    SET status = 'RESERVED',
        updated_at = now(),
        reserved_at = now()
    WHERE id = ANY(p_product_ids)
      AND status = 'VERIFIED'
      AND seller_id <> p_buyer_id
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles_private pp
        WHERE pp.id = products.seller_id
          AND pp.status IN ('suspended', 'banned')
      )
    RETURNING id, price
  )
  SELECT array_agg(id), COUNT(*), COALESCE(SUM(price), 0)
    INTO v_reserved_ids, v_count, v_sum
  FROM reserved;

  -- 4. ALL-OR-NOTHING: Si no se reservó el 100% del carrito, revertir lo parcial
  IF v_count = cardinality(p_product_ids) THEN
    RETURN QUERY SELECT v_sum, true, NULL::TEXT;
  ELSE
    IF v_count > 0 THEN
      PERFORM public.fn_release_listings(v_reserved_ids, true, false);
    END IF;
    RETURN QUERY SELECT 0::NUMERIC, false, 'SOME_PRODUCTS_UNAVAILABLE'::TEXT;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_reserve_products(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reserve_products(UUID, UUID[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_finalize_checkout_recovery(
  p_stripe_payment_intent_id TEXT,
  p_stripe_refund_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  IF NULLIF(p_stripe_refund_id, '') IS NULL THEN
    RAISE EXCEPTION 'STRIPE_REFUND_ID_REQUIRED';
  END IF;

  -- Lock the order first, then its reserved products by UUID. The caller may
  -- invoke this only after Stripe has confirmed the refund identifier.
  SELECT id INTO v_order_id
  FROM public.orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    UPDATE public.checkout_recovery_shells
    SET compensation_state = 'refunded',
        stripe_refund_id = p_stripe_refund_id,
        compensation_lease_expires_at = NULL,
        next_compensation_retry_at = NULL,
        updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
      AND compensation_state <> 'refunded';

    IF FOUND THEN
      RETURN jsonb_build_object('status', 'refunded', 'stripe_payment_intent_id', p_stripe_payment_intent_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.checkout_recovery_shells
      WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
        AND compensation_state = 'refunded'
    ) THEN
      RETURN jsonb_build_object('status', 'duplicate', 'stripe_payment_intent_id', p_stripe_payment_intent_id);
    END IF;

    RAISE EXCEPTION 'CHECKOUT_RECOVERY_TARGET_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = v_order_id
      AND compensation_state = 'refunded'
  ) THEN
    UPDATE public.checkout_recovery_shells
    SET compensation_state = 'refunded',
        stripe_refund_id = COALESCE(stripe_refund_id, p_stripe_refund_id),
        compensation_lease_expires_at = NULL,
        next_compensation_retry_at = NULL,
        updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
      AND compensation_state <> 'refunded';

    RETURN jsonb_build_object('status', 'duplicate', 'order_id', v_order_id);
  END IF;

  PERFORM p.id
  FROM public.products p
  JOIN public.order_items oi ON oi.product_id = p.id
  WHERE oi.order_id = v_order_id
    AND p.status = 'RESERVED'
  ORDER BY p.id
  FOR UPDATE;

  PERFORM public.fn_release_listings(
    ARRAY(SELECT oi.product_id FROM public.order_items oi WHERE oi.order_id = v_order_id),
    true,
    false
  );

  UPDATE public.orders
  SET status = 'refunded',
      payment_processing = false,
      payment_processing_reason = NULL,
      compensation_state = 'refunded',
      stripe_refund_id = p_stripe_refund_id,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = NULL,
      updated_at = now()
  WHERE id = v_order_id;

  RETURN jsonb_build_object('status', 'refunded', 'order_id', v_order_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_finalize_checkout_recovery(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finalize_checkout_recovery(TEXT, TEXT)
  TO service_role;

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
  PERFORM public.fn_release_listings(
    ARRAY(
      SELECT oi.product_id
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.shipment_id = p_shipment_id
    ),
    false,
    false
  );

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

REVOKE EXECUTE ON FUNCTION public.fn_cancel_shipment(UUID, TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancel_shipment(UUID, TEXT, TEXT, BIGINT)
  TO service_role;
