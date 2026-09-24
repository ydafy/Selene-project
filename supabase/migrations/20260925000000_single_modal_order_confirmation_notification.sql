-- N5a: apply only after 20260924000000_notification_event_metadata.sql.
-- N4a only adds metadata; it does not establish server-authoritative identity.
-- REQUIRED BEFORE N5a: inventory deployed notification grants/RLS, index definition,
-- function ACL, and every privileged client-callable RPC that can insert legacy
-- notices. Apply a separate N4b restrictive grant/RLS cutover after checking
-- older client and RPC compatibility; do not guess REVOKEs or disable legacy
-- writers until the deployed inventory is reviewed. Preflight below rejects
-- effective client write privileges even if RLS currently denies their rows.
-- Whole-file transaction required; verify Dashboard transaction semantics
-- before manual execution. CREATE OR REPLACE retains the existing function ACL.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_create_shipments_from_single_payment'
      AND p.oid = 'public.fn_create_shipments_from_single_payment(text,text,bigint,text,jsonb)'::regprocedure
      AND p.prosecdef
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Settlement RPC ACL or SECURITY DEFINER differs from expected baseline';
  END IF;
  IF has_table_privilege('anon', 'public.notifications', 'INSERT')
     OR has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     OR has_table_privilege('anon', 'public.notifications', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
     OR has_column_privilege('anon', 'public.notifications', 'event_kind', 'INSERT')
     OR has_column_privilege('authenticated', 'public.notifications', 'event_kind', 'INSERT')
     OR has_column_privilege('anon', 'public.notifications', 'source_event_key', 'INSERT')
     OR has_column_privilege('authenticated', 'public.notifications', 'source_event_key', 'INSERT')
     OR has_column_privilege('anon', 'public.notifications', 'event_payload', 'INSERT')
     OR has_column_privilege('authenticated', 'public.notifications', 'event_payload', 'INSERT')
     OR has_column_privilege('anon', 'public.notifications', 'event_kind', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.notifications', 'event_kind', 'UPDATE')
     OR has_column_privilege('anon', 'public.notifications', 'source_event_key', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.notifications', 'source_event_key', 'UPDATE')
     OR has_column_privilege('anon', 'public.notifications', 'event_payload', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.notifications', 'event_payload', 'UPDATE') THEN
    RAISE EXCEPTION 'N4b restrictive notification grants required before N5a producer cutover';
  END IF;

  -- Verify arbiter identity, not just the name: ON CONFLICT inference requires
  -- precisely these two simple key columns and the same partial predicate.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    JOIN pg_catalog.pg_attribute key_column
      ON key_column.attrelid = i.indrelid AND key_column.attnum = i.indkey[0]
    JOIN pg_catalog.pg_attribute recipient_column
      ON recipient_column.attrelid = i.indrelid AND recipient_column.attnum = i.indkey[1]
    WHERE i.indrelid = 'public.notifications'::regclass
      AND c.relname = 'notifications_source_event_key_user_id_uidx'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indnkeyatts = 2 AND i.indnatts = 2
      AND key_column.attname = 'source_event_key'
      AND recipient_column.attname = 'user_id'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'Expected N4a partial unique notification arbiter is absent or incompatible';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_create_shipments_from_single_payment(
  p_stripe_payment_intent_id TEXT,
  p_stripe_charge_id TEXT,
  p_amount_received BIGINT,
  p_transfer_group TEXT,
  p_allocation JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_id UUID;
  v_address_id UUID;
  v_order_id UUID;
  v_total_amount NUMERIC;
  v_addr_snapshot JSONB;
  v_existing_order RECORD;
  v_existing_order_id UUID;
  v_settled_shipment_count INT;
  v_is_new_order BOOLEAN := false;
  v_row JSONB;
  v_seller_id UUID;
  v_shipment_id UUID;
  v_product_ids UUID[];
  v_gross_cents BIGINT;
  v_commission_cents BIGINT;
  v_shipping_cents BIGINT;
  v_net_cents BIGINT;
  v_product_record RECORD;
  v_expected_product_count INT;
  v_found_product_count INT;
  v_reserved_product_count INT;
  v_seller_gross_pesos NUMERIC;
  v_item_limit INT;
  v_item_index INT;
  v_item_commission NUMERIC;
  v_item_shipping NUMERIC;
  v_item_net NUMERIC;
  v_residual_commission NUMERIC := 0;
  v_residual_shipping NUMERIC := 0;
  v_residual_net NUMERIC := 0;
  v_order_amount NUMERIC;
  v_service_fee_amount NUMERIC := 0;
  v_failure_code TEXT;
BEGIN
  -- 1. Validate + extract structured allocation payload fields.
  v_buyer_id := (p_allocation ->> 'buyer_id')::UUID;
  v_address_id := NULLIF(p_allocation ->> 'address_id', '')::UUID;
  v_order_id := COALESCE(
    NULLIF(p_allocation ->> 'order_id', '')::UUID,
    NULLIF(p_allocation ->> 'order_group_id', '')::UUID
  );
  v_total_amount := p_amount_received / 100.0;

  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'BUYER_ID_REQUIRED';
  END IF;
  IF v_address_id IS NULL THEN
    RAISE EXCEPTION 'ADDRESS_ID_REQUIRED';
  END IF;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_ID_REQUIRED';
  END IF;

  -- 2. Address snapshot (validated against the buyer) — persisted on the shell.
  SELECT to_jsonb(a.*) INTO v_addr_snapshot
  FROM public.addresses a
  WHERE a.id = v_address_id
    AND a.user_id = v_buyer_id;
  IF v_addr_snapshot IS NULL THEN
    RAISE EXCEPTION 'ADDRESS_NOT_FOUND_OR_UNAUTHORIZED';
  END IF;

  -- 3. Idempotency: locate an existing order row for this PI id.
  SELECT id, payment_processing INTO v_existing_order
  FROM public.orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND buyer_id = v_buyer_id
  FOR UPDATE;

  IF v_existing_order.id IS NOT NULL THEN
    -- Count settled shipments tied to the shell. If any exist, the prior
    -- attempt fully succeeded — return duplicate WITHOUT any re-write.
    SELECT COUNT(*) INTO v_settled_shipment_count
    FROM public.shipments
    WHERE order_id = v_existing_order.id;

    IF v_settled_shipment_count > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', v_existing_order.id,
        'status', 'duplicate'
      );
    END IF;

    -- Prior attempt crashed mid-allocation. Re-use the shell id and re-attempt
    -- the allocation into the SAME order row (idempotent shipment insert below).
    v_existing_order_id := v_existing_order.id;

    -- Re-seed the shell's settlement identifiers in case the prior crash left
    -- them NULL (e.g. the shell was created by an even-earlier failure path).
    UPDATE public.orders
    SET stripe_charge_id = p_stripe_charge_id,
        stripe_transfer_group = p_transfer_group,
        payment_processing = false,
        payment_processing_reason = NULL,
        updated_at = now()
    WHERE id = v_existing_order_id;
  END IF;

  -- 4. Create the order shell (or re-use the recovered one) BEFORE the
  --    allocation attempt so a failed allocation leaves a recoverable row.
  --    status='pending' (NOT 'paid'); payment_processing=false until/if the
  --    inner allocation block raises.
  IF v_existing_order_id IS NULL THEN
    v_is_new_order := true;
    INSERT INTO public.orders (
      id,
      buyer_id,
      status,
      stripe_payment_intent_id,
      stripe_charge_id,
      stripe_transfer_group,
      payment_processing,
      service_fee_amount,
      total_amount,
      shipping_address
    ) VALUES (
      v_order_id,
      v_buyer_id,
      'pending',
      p_stripe_payment_intent_id,
      p_stripe_charge_id,
      p_transfer_group,
      false,
      0,
      v_total_amount,
      v_addr_snapshot
    )
    RETURNING id INTO v_existing_order_id;
  ELSE
    v_order_id := v_existing_order_id;
  END IF;

  -- 5. Allocation block: shipments + order_items + product SOLD. Any failure
  --    here rolls back ONLY this block (the shell above survives) and is
  --    caught, marking the shell payment_processing=true for admin recovery.
  BEGIN
    -- Include numeric aggregation in the recovery boundary: malformed
    -- commission data must leave a durable payment_processing shell too.
    SELECT COALESCE(SUM((r->>'commission_cents')::BIGINT), 0)
      INTO v_service_fee_amount
    FROM jsonb_array_elements(p_allocation -> 'rows') AS r;

    FOR v_row IN
      SELECT * FROM jsonb_array_elements(p_allocation -> 'rows')
    LOOP
      v_seller_id := (v_row ->> 'seller_id')::UUID;
      v_shipment_id := (v_row ->> 'shipment_id')::UUID;
      v_gross_cents := (v_row ->> 'gross_cents')::BIGINT;
      v_commission_cents := (v_row ->> 'commission_cents')::BIGINT;
      v_shipping_cents := (v_row ->> 'shipping_cents')::BIGINT;
      v_net_cents := (v_row ->> 'net_cents')::BIGINT;

      SELECT array_agg(pid::UUID) INTO v_product_ids
      FROM jsonb_array_elements_text(v_row -> 'product_ids') AS pid;

      IF v_product_ids IS NULL OR array_length(v_product_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'PRODUCT_IDS_REQUIRED';
      END IF;

      IF array_length(v_product_ids, 1) <> 1 THEN
        RAISE EXCEPTION 'ONE_PRODUCT_PER_SHIPMENT_REQUIRED';
      END IF;

      v_expected_product_count := array_length(v_product_ids, 1);

      SELECT COUNT(*) INTO v_found_product_count
      FROM public.products
      WHERE id = ANY(v_product_ids)
        AND seller_id = v_seller_id;

      IF v_found_product_count <> v_expected_product_count THEN
        RAISE EXCEPTION 'PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED';
      END IF;

      SELECT COUNT(*) INTO v_reserved_product_count
      FROM public.products
      WHERE id = ANY(v_product_ids)
        AND seller_id = v_seller_id
        AND status = 'RESERVED';

      IF v_reserved_product_count <> v_expected_product_count THEN
        RAISE EXCEPTION 'PRODUCT_NOT_RESERVED';
      END IF;

      -- Seed the shipment in a sub-pending state; only advanced to 'paid'
      -- AFTER all order_items for the row are persisted. The deterministic
      -- shipment id is the source of truth — ON CONFLICT DO NOTHING keeps a
      -- recovered re-attempt from duplicating a partially-written shipment.
      INSERT INTO public.shipments (
        id,
        order_id,
        seller_id,
        status,
        stripe_payment_intent_id,
        shipping_cost
      ) VALUES (
        v_shipment_id,
        v_existing_order_id,
        v_seller_id,
        'preparing',
        p_stripe_payment_intent_id,
        v_shipping_cents
      )
      ON CONFLICT (id) DO NOTHING;

      -- Distribute the seller-level commission/shipping/net across the row's
      -- products proportionally by price, with the LAST product absorbing the
      -- residual so SUM(items) reconciles EXACTLY to the seller row. The
      -- allocator upfront guarantees gross = commission + shipping + net at the
      -- seller level; we preserve that invariant per-seller, not per-item.
      v_seller_gross_pesos := v_gross_cents / 100.0;
      v_item_limit := v_expected_product_count;
      v_residual_commission := v_commission_cents / 100.0;
      v_residual_shipping := v_shipping_cents / 100.0;
      v_residual_net := v_net_cents / 100.0;

      v_item_index := 0;
      FOR v_product_record IN
        SELECT id, price
        FROM public.products
        WHERE id = ANY(v_product_ids)
          AND seller_id = v_seller_id
          AND status = 'RESERVED'
        ORDER BY id
        FOR UPDATE
      LOOP
        v_item_index := v_item_index + 1;
        IF v_item_index = v_item_limit THEN
          -- Last item: absorb the exact residual so the row sums reconcile.
          v_item_commission := v_residual_commission;
          v_item_shipping := v_residual_shipping;
          v_item_net := v_residual_net;
        ELSE
          v_item_commission := round(
            (v_commission_cents / 100.0) * (v_product_record.price / v_seller_gross_pesos),
            2
          );
          v_item_shipping := round(
            (v_shipping_cents / 100.0) * (v_product_record.price / v_seller_gross_pesos),
            2
          );
          v_item_net := round(
            (v_net_cents / 100.0) * (v_product_record.price / v_seller_gross_pesos),
            2
          );
          v_residual_commission := v_residual_commission - v_item_commission;
          v_residual_shipping := v_residual_shipping - v_item_shipping;
          v_residual_net := v_residual_net - v_item_net;
        END IF;

        INSERT INTO public.order_items (
          order_id,
          shipment_id,
          seller_id,
          product_id,
          price_at_purchase,
          commission_amount,
          shipping_amount,
          shipping_payer,
          net_payout
        ) VALUES (
          v_existing_order_id,
          v_shipment_id,
          v_seller_id,
          v_product_record.id,
          v_product_record.price,
          v_item_commission,
          v_item_shipping,
          'seller',
          v_item_net
        )
        ON CONFLICT DO NOTHING;
      END LOOP;

      -- Mark the row's RESERVED products SOLD only after their order_items
      -- are durably persisted (preserves the spec invariant).
      UPDATE public.products
      SET status = 'SOLD', updated_at = now()
      WHERE id = ANY(v_product_ids)
        AND seller_id = v_seller_id
        AND status = 'RESERVED';

      -- Advance THIS shipment to 'paid' now that its allocation is durable.
      UPDATE public.shipments
      SET status = 'paid', updated_at = now()
      WHERE id = v_shipment_id
        AND status = 'preparing';
    END LOOP;

    -- All shipments are durable; pin the order's fee tally and derive status.
    UPDATE public.orders
    SET service_fee_amount = COALESCE(v_service_fee_amount / 100.0, 0),
        total_amount = v_total_amount,
        updated_at = now()
    WHERE id = v_existing_order_id;

    PERFORM fn_derive_order_status(v_existing_order_id);

    -- Derivation alone is not proof of full allocation: check every persisted
    -- shipment and the expected row count before publishing the paid event.
    SELECT COUNT(*) INTO v_settled_shipment_count
    FROM public.shipments s
    WHERE s.order_id = v_existing_order_id;
    IF v_settled_shipment_count = 0
       OR v_settled_shipment_count <> jsonb_array_length(p_allocation -> 'rows')
       OR EXISTS (
         SELECT 1 FROM public.shipments s
         WHERE s.order_id = v_existing_order_id AND s.status <> 'paid'
       ) THEN
      RAISE EXCEPTION 'INCOMPLETE_PAID_ALLOCATION';
    END IF;

    -- Union deduplicates the buyer if they are also a shipment seller.
    -- Both the recipients and the order identity come from persisted rows.
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload,
      type, title, message, action_path
    )
    SELECT recipients.user_id,
           'order.payment_confirmed',
           'order.payment_confirmed:' || v_existing_order_id::text,
           jsonb_build_object('order_id', v_existing_order_id),
           'success',
           CASE WHEN recipients.user_id = o.buyer_id THEN 'Compra confirmada'
                ELSE 'Nueva venta confirmada' END,
           CASE WHEN recipients.user_id = o.buyer_id THEN 'Tu pago fue confirmado.'
                ELSE 'Recibiste una nueva venta.' END,
           '/profile/orders/' || o.id::text
    FROM public.orders o
    CROSS JOIN LATERAL (
      SELECT o.buyer_id AS user_id
      UNION
      SELECT DISTINCT s.seller_id AS user_id
      FROM public.shipments s
      WHERE s.order_id = v_existing_order_id
    ) recipients
    WHERE o.id = v_existing_order_id
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    -- Clear any prior recovery flag: this attempt fully settled.
    UPDATE public.orders
    SET payment_processing = false,
        payment_processing_reason = NULL,
        stripe_charge_id = p_stripe_charge_id,
        stripe_transfer_group = p_transfer_group
    WHERE id = v_existing_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_existing_order_id,
      'status', 'created'
    );
  EXCEPTION WHEN OTHERS THEN
    -- Allocation write failed. The inner block is rolled back (no shipment/
    -- order_item/SOLD writes persist); the shell above survives. Surface it
    -- to admin ops recovery: status stays 'pending' with payment_processing.
    v_failure_code := CASE
      WHEN SQLERRM IN (
        'ONE_PRODUCT_PER_SHIPMENT_REQUIRED',
        'PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED',
        'PRODUCT_NOT_RESERVED'
      ) OR SQLERRM LIKE 'INVALID_%' THEN SQLERRM
      ELSE 'SETTLEMENT_TRANSIENT_FAILURE'
    END;

    UPDATE public.orders
    SET payment_processing = true,
        payment_processing_reason = v_failure_code,
        stripe_charge_id = COALESCE(p_stripe_charge_id, stripe_charge_id),
        stripe_transfer_group = COALESCE(p_transfer_group, stripe_transfer_group),
        updated_at = now()
    WHERE id = v_existing_order_id;

    RETURN jsonb_build_object(
      'success', false,
      'order_id', v_existing_order_id,
      'status', 'payment_processing',
      'error', SQLERRM,
      'failure_code', v_failure_code,
      'runtime_version', 'single_modal_settlement_v2'
    );
  END;
END;
$$;

COMMIT;
