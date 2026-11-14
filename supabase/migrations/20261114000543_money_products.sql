SET local check_function_bodies = off;

DROP VIEW "public"."admin_product_queue_view";

DROP VIEW "public"."products_public";

DROP FUNCTION "public"."fn_reserve_products"(uuid, uuid[]);

-- Hand edit: pg-delta wrote the renames as drop plus add, which loses data.
-- Rename and convert pesos to integer cents instead (S4).
ALTER TABLE "public"."products"
  RENAME COLUMN "price" TO "price_cents";

ALTER TABLE "public"."products"
  ALTER COLUMN "price_cents" TYPE bigint USING round(price_cents * 100)::bigint;

ALTER TABLE "public"."products"
  RENAME COLUMN "shipping_cost" TO "shipping_cost_cents";

ALTER TABLE "public"."products"
  ALTER COLUMN "shipping_cost_cents" DROP DEFAULT;

ALTER TABLE "public"."products"
  ALTER COLUMN "shipping_cost_cents" TYPE bigint USING round(shipping_cost_cents * 100)::bigint;

ALTER TABLE "public"."products"
  ALTER COLUMN "shipping_cost_cents" SET DEFAULT 0;

ALTER TABLE "public"."products"
  ALTER COLUMN "shipping_cost_cents" SET NOT NULL;

CREATE OR REPLACE FUNCTION public.backfill_product_publication_economics (
  p_product_id uuid
)
  RETURNS TABLE (
    publication_shipping_reserve_cents bigint,
    publication_commission_rate        numeric,
    publication_insurance_rate         numeric
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_shipping_buffer_cents BIGINT;
  v_commission_rate NUMERIC;
  v_insurance_rate NUMERIC;
  v_reserve_cents BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  IF v_product.publication_shipping_reserve_cents IS NOT NULL
    OR v_product.publication_commission_rate IS NOT NULL
    OR v_product.publication_insurance_rate IS NOT NULL THEN
    IF v_product.publication_shipping_reserve_cents IS NULL
      OR v_product.publication_commission_rate IS NULL
      OR v_product.publication_insurance_rate IS NULL THEN
      RAISE EXCEPTION 'INVALID_PUBLICATION_ECONOMICS_SNAPSHOT';
    END IF;
    RETURN QUERY SELECT
      v_product.publication_shipping_reserve_cents,
      v_product.publication_commission_rate,
      v_product.publication_insurance_rate;
    RETURN;
  END IF;

  SELECT
    shipping_buffer_cents,
    service_fee_pct,
    insurance_rate
  INTO v_shipping_buffer_cents, v_commission_rate, v_insurance_rate
  FROM public.system_settings
  WHERE id = 1;

  IF v_product.shipping_cost_cents IS NULL
    OR v_shipping_buffer_cents IS NULL
    OR v_commission_rate IS NULL
    OR v_insurance_rate IS NULL THEN
    RAISE EXCEPTION 'LEGACY_PUBLICATION_ECONOMICS_UNAVAILABLE';
  END IF;

  v_reserve_cents :=
    v_product.shipping_cost_cents
    + v_shipping_buffer_cents
    + ceil(v_product.price_cents::NUMERIC * v_insurance_rate)::BIGINT;

  UPDATE public.products
  SET publication_shipping_reserve_cents = v_reserve_cents,
      publication_commission_rate = v_commission_rate,
      publication_insurance_rate = v_insurance_rate,
      updated_at = now()
  WHERE id = p_product_id;

  RETURN QUERY SELECT v_reserve_cents, v_commission_rate, v_insurance_rate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_shipments_from_single_payment (
  p_stripe_payment_intent_id text,
  p_stripe_charge_id         text,
  p_amount_received          bigint,
  p_transfer_group           text,
  p_allocation               jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
        SELECT id, price_cents
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
            (v_commission_cents / 100.0) * ((v_product_record.price_cents / 100.0) / v_seller_gross_pesos),
            2
          );
          v_item_shipping := round(
            (v_shipping_cents / 100.0) * ((v_product_record.price_cents / 100.0) / v_seller_gross_pesos),
            2
          );
          v_item_net := round(
            (v_net_cents / 100.0) * ((v_product_record.price_cents / 100.0) / v_seller_gross_pesos),
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
          v_product_record.price_cents / 100.0,
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

    PERFORM internal.fn_derive_order_status(v_existing_order_id);

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
           jsonb_build_object('order_id', v_existing_order_id, 'recipient_role',
             CASE WHEN recipients.user_id = o.buyer_id THEN 'buyer' ELSE 'seller' END),
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_reserve_products (
  p_buyer_id    uuid,
  p_product_ids uuid[]
)
  RETURNS TABLE (
    total_price_cents bigint,
    success           boolean,
    error_message     text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_count INT;
  v_sum BIGINT;
  v_reserved_ids UUID[];
BEGIN
  -- 0. DEFENSA: Carrito nulo o vacío (retorno inmediato en 0ms)
  IF p_product_ids IS NULL OR cardinality(p_product_ids) = 0 THEN
    RETURN QUERY SELECT 0::BIGINT, false, 'EMPTY_CART'::TEXT;
    RETURN;
  END IF;

  -- Banned buyers cannot purchase; suspended buyers keep their own purchases
  IF EXISTS (
    SELECT 1 FROM public.profiles_private pp
    WHERE pp.id = p_buyer_id AND pp.status = 'banned'
  ) THEN
    RETURN QUERY SELECT 0::BIGINT, false, 'ACCOUNT_RESTRICTED'::TEXT;
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
    RETURNING id, price_cents
  )
  SELECT array_agg(id), COUNT(*), COALESCE(SUM(price_cents), 0)::BIGINT
    INTO v_reserved_ids, v_count, v_sum
  FROM reserved;

  -- 4. ALL-OR-NOTHING: Si no se reservó el 100% del carrito, revertir lo parcial
  IF v_count = cardinality(p_product_ids) THEN
    RETURN QUERY SELECT v_sum, true, NULL::TEXT;
  ELSE
    IF v_count > 0 THEN
      PERFORM public.fn_release_listings(v_reserved_ids, true, false);
    END IF;
    RETURN QUERY SELECT 0::BIGINT, false, 'SOME_PRODUCTS_UNAVAILABLE'::TEXT;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_reserve_products"(uuid, uuid[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.validate_product_publication_economics()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_shipping_buffer_cents BIGINT;
  v_commission_rate NUMERIC;
  v_insurance_rate NUMERIC;
  v_expected_reserve_cents BIGINT;
  v_old_empty BOOLEAN;
  v_new_empty BOOLEAN;
BEGIN
  v_new_empty := NEW.publication_shipping_reserve_cents IS NULL
    AND NEW.publication_commission_rate IS NULL
    AND NEW.publication_insurance_rate IS NULL;

  IF TG_OP = 'INSERT' THEN
    IF v_new_empty THEN
      RAISE EXCEPTION 'PUBLICATION_SNAPSHOT_REQUIRED';
    END IF;
  ELSE
    v_old_empty := OLD.publication_shipping_reserve_cents IS NULL
      AND OLD.publication_commission_rate IS NULL
      AND OLD.publication_insurance_rate IS NULL;

    IF NEW.price_cents IS NOT DISTINCT FROM OLD.price_cents
      AND NEW.shipping_cost_cents IS NOT DISTINCT FROM OLD.shipping_cost_cents THEN
      IF NEW.publication_shipping_reserve_cents IS NOT DISTINCT FROM OLD.publication_shipping_reserve_cents
        AND NEW.publication_commission_rate IS NOT DISTINCT FROM OLD.publication_commission_rate
        AND NEW.publication_insurance_rate IS NOT DISTINCT FROM OLD.publication_insurance_rate THEN
        RETURN NEW;
      END IF;
      IF NOT v_old_empty THEN
        RAISE EXCEPTION 'PUBLICATION_ECONOMICS_IMMUTABLE';
      END IF;
    ELSE
      IF NOT v_old_empty AND v_new_empty THEN
        RAISE EXCEPTION 'PUBLICATION_SNAPSHOT_REQUIRED';
      END IF;
      IF v_new_empty THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  SELECT
    shipping_buffer_cents,
    service_fee_pct,
    insurance_rate
  INTO v_shipping_buffer_cents, v_commission_rate, v_insurance_rate
  FROM public.system_settings
  WHERE id = 1;

  IF v_shipping_buffer_cents IS NULL
    OR v_commission_rate IS NULL
    OR v_insurance_rate IS NULL
    OR NEW.shipping_cost_cents IS NULL THEN
    RAISE EXCEPTION 'PUBLICATION_ECONOMICS_CONFIGURATION_REQUIRED';
  END IF;

  v_expected_reserve_cents :=
    NEW.shipping_cost_cents
    + v_shipping_buffer_cents
    + ceil(NEW.price_cents::NUMERIC * v_insurance_rate)::BIGINT;

  IF NEW.publication_shipping_reserve_cents IS DISTINCT FROM v_expected_reserve_cents
    OR NEW.publication_commission_rate IS DISTINCT FROM v_commission_rate
    OR NEW.publication_insurance_rate IS DISTINCT FROM v_insurance_rate THEN
    RAISE EXCEPTION 'INVALID_OR_STALE_PUBLICATION_ECONOMICS';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_price_cents_check" CHECK (((price_cents >= 1000) AND (price_cents <= 50000000)));

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_shipping_cost_cents_check" CHECK ((shipping_cost_cents >= 0));

CREATE VIEW "public"."admin_product_queue_view" WITH (security_invoker=true) AS  SELECT id,
    created_at,
    name,
    description,
    price_cents,
    category,
    condition,
    usage,
    images,
    status,
    specifications,
    seller_id,
    views,
    aspect_ratio,
    verification_data,
    rejection_reason,
    shipping_cost_cents,
    shipping_payer,
    origin_zip,
    package_preset,
    updated_at,
    reserved_at,
    verified_at,
    locked_by,
    locked_at,
    fts,
    deleted_at
   FROM public.products
  WHERE ((status = 'PENDING_VERIFICATION'::public.product_status_enum) AND (deleted_at IS NULL) AND public.is_admin())
  ORDER BY created_at;

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "anon";

CREATE VIEW "public"."products_public" WITH (security_barrier=true) AS  SELECT id,
    seller_id,
    name,
    description,
    price_cents,
    category,
    condition,
    usage,
    images,
    specifications,
    aspect_ratio,
    status,
    views,
    created_at,
    fts
   FROM public.products p
  WHERE ((deleted_at IS NULL) AND (status = ANY (ARRAY['VERIFIED'::public.product_status_enum, 'SOLD'::public.product_status_enum, 'PENDING_VERIFICATION'::public.product_status_enum, 'IN_REVIEW'::public.product_status_enum])));

REVOKE ALL ON FUNCTION "public"."fn_reserve_products"(uuid, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_reserve_products"(uuid, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_reserve_products"(uuid, uuid[]) TO "service_role";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_product_queue_view" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_product_queue_view" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_product_queue_view" TO "service_role";

REVOKE ALL ON TABLE "public"."products_public" FROM "anon";

GRANT SELECT ON TABLE "public"."products_public" TO "anon";

REVOKE ALL ON TABLE "public"."products_public" FROM "authenticated";

GRANT SELECT ON TABLE "public"."products_public" TO "authenticated";

REVOKE ALL ON TABLE "public"."products_public" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."products_public" TO "postgres";

REVOKE ALL ON TABLE "public"."products_public" FROM "service_role";

GRANT SELECT ON TABLE "public"."products_public" TO "service_role";
