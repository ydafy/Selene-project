SET local check_function_bodies = off;

DROP VIEW "public"."admin_connect_payout_release_view";

DROP VIEW "public"."admin_disputes_monitor_view";

-- Hand edit: pg-delta wrote the renames as drop plus add, which loses data.
-- Rename and convert pesos to integer cents instead (S4). The two dead
-- columns have no writer and are dropped (S5). The checks are added after
-- the conversion, below the settlement function.
ALTER TABLE "public"."order_items"
  DROP COLUMN "insurance_amount";

ALTER TABLE "public"."order_items"
  DROP COLUMN "sat_tax_withholding";

ALTER TABLE "public"."order_items"
  RENAME COLUMN "price_at_purchase" TO "price_at_purchase_cents";

ALTER TABLE "public"."order_items"
  ALTER COLUMN "price_at_purchase_cents" TYPE bigint USING round(price_at_purchase_cents * 100)::bigint;

ALTER TABLE "public"."order_items"
  RENAME COLUMN "commission_amount" TO "commission_amount_cents";

ALTER TABLE "public"."order_items"
  ALTER COLUMN "commission_amount_cents" DROP DEFAULT;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "commission_amount_cents" TYPE bigint USING round(commission_amount_cents * 100)::bigint;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "commission_amount_cents" SET DEFAULT 0;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "commission_amount_cents" SET NOT NULL;

ALTER TABLE "public"."order_items"
  RENAME COLUMN "shipping_amount" TO "shipping_amount_cents";

ALTER TABLE "public"."order_items"
  ALTER COLUMN "shipping_amount_cents" DROP DEFAULT;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "shipping_amount_cents" TYPE bigint USING round(shipping_amount_cents * 100)::bigint;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "shipping_amount_cents" SET DEFAULT 0;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "shipping_amount_cents" SET NOT NULL;

ALTER TABLE "public"."order_items"
  RENAME COLUMN "net_payout" TO "net_payout_cents";

ALTER TABLE "public"."order_items"
  ALTER COLUMN "net_payout_cents" DROP DEFAULT;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "net_payout_cents" TYPE bigint USING round(net_payout_cents * 100)::bigint;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "net_payout_cents" SET DEFAULT 0;

ALTER TABLE "public"."order_items"
  ALTER COLUMN "net_payout_cents" SET NOT NULL;

ALTER TABLE "public"."orders"
  RENAME COLUMN "total_amount" TO "total_amount_cents";

ALTER TABLE "public"."orders"
  ALTER COLUMN "total_amount_cents" TYPE bigint USING round(total_amount_cents * 100)::bigint;

ALTER TABLE "public"."orders"
  RENAME COLUMN "service_fee_amount" TO "service_fee_amount_cents";

ALTER TABLE "public"."orders"
  ALTER COLUMN "service_fee_amount_cents" DROP DEFAULT;

ALTER TABLE "public"."orders"
  ALTER COLUMN "service_fee_amount_cents" TYPE bigint USING round(service_fee_amount_cents * 100)::bigint;

ALTER TABLE "public"."orders"
  ALTER COLUMN "service_fee_amount_cents" SET DEFAULT 0;

ALTER TABLE "public"."orders"
  ALTER COLUMN "service_fee_amount_cents" SET NOT NULL;

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
  v_total_amount_cents BIGINT;
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
  v_item_limit INT;
  v_item_index INT;
  v_item_commission_cents BIGINT;
  v_item_shipping_cents BIGINT;
  v_item_net_cents BIGINT;
  v_residual_commission_cents BIGINT := 0;
  v_residual_shipping_cents BIGINT := 0;
  v_residual_net_cents BIGINT := 0;
  v_service_fee_amount_cents BIGINT := 0;
  v_failure_code TEXT;
BEGIN
  -- 1. Validate + extract structured allocation payload fields.
  v_buyer_id := (p_allocation ->> 'buyer_id')::UUID;
  v_address_id := NULLIF(p_allocation ->> 'address_id', '')::UUID;
  v_order_id := COALESCE(
    NULLIF(p_allocation ->> 'order_id', '')::UUID,
    NULLIF(p_allocation ->> 'order_group_id', '')::UUID
  );
  v_total_amount_cents := p_amount_received;

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
      service_fee_amount_cents,
      total_amount_cents,
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
      v_total_amount_cents,
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
      INTO v_service_fee_amount_cents
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
      -- Every amount is integer cents; each share rounds to the nearest cent.
      v_item_limit := v_expected_product_count;
      v_residual_commission_cents := v_commission_cents;
      v_residual_shipping_cents := v_shipping_cents;
      v_residual_net_cents := v_net_cents;

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
          v_item_commission_cents := v_residual_commission_cents;
          v_item_shipping_cents := v_residual_shipping_cents;
          v_item_net_cents := v_residual_net_cents;
        ELSE
          v_item_commission_cents := round(
            v_commission_cents::NUMERIC * v_product_record.price_cents / v_gross_cents
          )::BIGINT;
          v_item_shipping_cents := round(
            v_shipping_cents::NUMERIC * v_product_record.price_cents / v_gross_cents
          )::BIGINT;
          v_item_net_cents := round(
            v_net_cents::NUMERIC * v_product_record.price_cents / v_gross_cents
          )::BIGINT;
          v_residual_commission_cents := v_residual_commission_cents - v_item_commission_cents;
          v_residual_shipping_cents := v_residual_shipping_cents - v_item_shipping_cents;
          v_residual_net_cents := v_residual_net_cents - v_item_net_cents;
        END IF;

        INSERT INTO public.order_items (
          order_id,
          shipment_id,
          seller_id,
          product_id,
          price_at_purchase_cents,
          commission_amount_cents,
          shipping_amount_cents,
          shipping_payer,
          net_payout_cents
        ) VALUES (
          v_existing_order_id,
          v_shipment_id,
          v_seller_id,
          v_product_record.id,
          v_product_record.price_cents,
          v_item_commission_cents,
          v_item_shipping_cents,
          'seller',
          v_item_net_cents
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
    SET service_fee_amount_cents = COALESCE(v_service_fee_amount_cents, 0),
        total_amount_cents = v_total_amount_cents,
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

ALTER TABLE "public"."order_items"
  ADD CONSTRAINT "order_items_commission_amount_cents_check" CHECK ((commission_amount_cents >= 0));

ALTER TABLE "public"."order_items"
  ADD CONSTRAINT "order_items_net_payout_cents_check" CHECK ((net_payout_cents >= 0));

ALTER TABLE "public"."order_items"
  ADD CONSTRAINT "order_items_price_at_purchase_cents_check" CHECK ((price_at_purchase_cents >= 0));

ALTER TABLE "public"."order_items"
  ADD CONSTRAINT "order_items_shipping_amount_cents_check" CHECK ((shipping_amount_cents >= 0));

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_service_fee_amount_cents_check" CHECK ((service_fee_amount_cents >= 0));

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_total_amount_cents_check" CHECK ((total_amount_cents >= 0));

CREATE VIEW "public"."admin_connect_payout_release_view" WITH (security_invoker=true) AS  WITH shipment_amounts AS (
         SELECT s.id AS shipment_id,
            s.seller_id,
            s.order_id,
            s.status,
            s.completed_at,
            s.stripe_payment_intent_id,
            s.stripe_payout_id,
            s.shipping_cost,
            pp.stripe_account_id,
            pp.stripe_onboarding_status,
            p.username AS seller_name,
            (s.status = 'completed'::public.order_status_enum) AS is_completed,
            (s.completed_at IS NOT NULL) AS has_completed_at,
            (s.stripe_payment_intent_id IS NOT NULL) AS has_connect_payment_intent,
            GREATEST(
                CASE
                    WHEN (o.stripe_transfer_group IS NOT NULL) THEN (COALESCE(sum(oi.net_payout_cents), (0)::numeric))::integer
                    ELSE ((COALESCE(sum(oi.net_payout_cents), (0)::numeric))::integer - COALESCE(s.shipping_cost, 0))
                END, 0) AS release_amount_cents,
            ((s.shipping_cost IS NOT NULL) AND (s.shipping_cost > 0)) AS has_shipping_cost_cents,
            (EXISTS ( SELECT 1
                   FROM public.disputes d
                  WHERE ((d.shipment_id = s.id) AND (d.status = ANY (ARRAY['open'::public.dispute_status, 'under_review'::public.dispute_status, 'waiting_return'::public.dispute_status, 'return_shipped'::public.dispute_status, 'return_delivered'::public.dispute_status]))))) AS has_active_dispute,
            (EXISTS ( SELECT 1
                   FROM public.connect_payout_run_shipments crs
                  WHERE ((crs.shipment_id = s.id) AND (crs.status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'reconciliation_needed'::text]))))) AS has_active_release,
            o.stripe_transfer_group AS transfer_group,
            s.stripe_transfer_id
           FROM ((((public.shipments s
             JOIN public.orders o ON ((o.id = s.order_id)))
             LEFT JOIN public.order_items oi ON ((oi.shipment_id = s.id)))
             LEFT JOIN public.profiles_private pp ON ((pp.id = s.seller_id)))
             LEFT JOIN public.profiles p ON ((p.id = s.seller_id)))
          GROUP BY s.id, s.seller_id, s.order_id, s.status, s.completed_at, s.stripe_payment_intent_id, s.stripe_payout_id, s.shipping_cost, pp.stripe_account_id, pp.stripe_onboarding_status, p.username, o.stripe_transfer_group, s.stripe_transfer_id
        )
 SELECT sa.shipment_id,
    sa.seller_id,
    sa.seller_name,
    sa.order_id,
    sa.status,
    sa.completed_at,
    sa.stripe_payment_intent_id,
    sa.stripe_account_id,
    sa.stripe_onboarding_status,
    sa.release_amount_cents,
    (sa.is_completed AND sa.has_completed_at AND sa.has_connect_payment_intent AND (NOT sa.has_active_dispute) AND (NOT sa.has_active_release) AND (payout_run.id IS NULL) AND ((sa.transfer_group IS NOT NULL) OR sa.has_shipping_cost_cents) AND (sa.stripe_account_id IS NOT NULL) AND (sa.stripe_onboarding_status = 'complete'::public.stripe_onboarding_status) AND (sa.release_amount_cents > 0)) AS is_eligible,
        CASE
            WHEN (NOT sa.is_completed) THEN 'shipment_not_completed'::text
            WHEN (NOT sa.has_completed_at) THEN 'missing_completed_at'::text
            WHEN (NOT sa.has_connect_payment_intent) THEN 'missing_connect_payment_intent'::text
            WHEN sa.has_active_dispute THEN 'active_dispute'::text
            WHEN sa.has_active_release THEN 'already_released'::text
            WHEN (payout_run.status = 'canceled'::text) THEN 'payout_canceled_manual_review'::text
            WHEN (payout_run.status = 'failed'::text) THEN 'payout_failed_retry_required'::text
            WHEN (payout_run.id IS NOT NULL) THEN 'payout_run_history_requires_review'::text
            WHEN ((sa.transfer_group IS NULL) AND (NOT sa.has_shipping_cost_cents)) THEN 'missing_shipping_cost'::text
            WHEN (sa.stripe_account_id IS NULL) THEN 'missing_stripe_account'::text
            WHEN ((sa.stripe_onboarding_status <> 'complete'::public.stripe_onboarding_status) OR (sa.stripe_onboarding_status IS NULL)) THEN 'seller_not_payout_ready'::text
            WHEN (sa.release_amount_cents <= 0) THEN 'missing_release_amount'::text
            ELSE NULL::text
        END AS ineligible_reason,
    sa.transfer_group,
    sa.stripe_transfer_id,
    payout_run.id AS payout_run_id,
    payout_run.status AS payout_run_status,
    payout_run.amount AS payout_run_amount_cents,
    payout_run.failure_reason AS payout_run_failure_reason,
    payout_run.failed_at AS payout_run_failed_at,
    payout_run.retry_of_run_id,
    COALESCE(((payout_run.status = 'failed'::text) AND (NOT payout_run.has_protected_release) AND (NOT payout_run.has_retry_child)), false) AS is_retryable,
    COALESCE((payout_run.status = 'canceled'::text), false) AS requires_manual_review,
    payout_run.paid_at AS payout_run_paid_at
   FROM (shipment_amounts sa
     LEFT JOIN LATERAL ( SELECT pr.id,
            pr.status,
            pr.amount,
            pr.failure_reason,
            pr.failed_at,
            pr.paid_at,
            pr.retry_of_run_id,
            (EXISTS ( SELECT 1
                   FROM public.connect_payout_runs retry_child
                  WHERE (retry_child.retry_of_run_id = pr.id))) AS has_retry_child,
            (EXISTS ( SELECT 1
                   FROM (public.connect_payout_run_shipments source_mapping
                     JOIN public.connect_payout_run_shipments protected_mapping ON ((protected_mapping.shipment_id = source_mapping.shipment_id)))
                  WHERE ((source_mapping.run_id = pr.id) AND (protected_mapping.status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'reconciliation_needed'::text]))))) AS has_protected_release
           FROM (public.connect_payout_run_shipments crs
             JOIN public.connect_payout_runs pr ON ((pr.id = crs.run_id)))
          WHERE (crs.shipment_id = sa.shipment_id)
          ORDER BY pr.created_at DESC, pr.id DESC
         LIMIT 1) payout_run ON (true));

REVOKE ALL ON TABLE "public"."admin_connect_payout_release_view" FROM "anon", "authenticated";

CREATE VIEW "public"."admin_disputes_monitor_view" WITH (security_invoker=true) AS  SELECT d.id AS dispute_id,
    d.created_at AS dispute_date,
    d.updated_at AS resolved_at,
    d.status AS dispute_status,
    "left"(d.description, 100) AS dispute_description_preview,
    d.resolution_type,
    o.id AS order_id,
    o.total_amount_cents,
    o.status AS order_status,
    b.id AS buyer_id,
    b.username AS buyer_username,
    s.id AS seller_id,
    s.username AS seller_username
   FROM (((public.disputes d
     LEFT JOIN public.orders o ON ((d.order_id = o.id)))
     LEFT JOIN public.profiles b ON ((d.buyer_id = b.id)))
     LEFT JOIN public.profiles s ON ((d.seller_id = s.id)));

REVOKE ALL ON TABLE "public"."admin_disputes_monitor_view" FROM "anon";

COMMENT ON COLUMN "public"."connect_payout_runs"."amount" IS 'Total payout amount in cents. Single-modal orders use the checkout-fixed sum of order_items.net_payout_cents; legacy orders retain the shipment shipping_cost deduction.';

COMMENT ON COLUMN "public"."order_items"."commission_amount_cents" IS 'Monto retenido por Selene como comisión de plataforma, en centavos enteros';

COMMENT ON COLUMN "public"."order_items"."net_payout_cents" IS 'Monto final a transferir al vendedor tras todas las deducciones, en centavos enteros';

COMMENT ON COLUMN "public"."order_items"."price_at_purchase_cents" IS 'Precio del producto al momento de la compra, en centavos enteros';

COMMENT ON COLUMN "public"."order_items"."shipping_amount_cents" IS 'Monto descontado al vendedor para cubrir la logística de envío, en centavos enteros';

COMMENT ON COLUMN "public"."orders"."service_fee_amount_cents" IS 'Sum of the Selene commission of every shipment in the order, in integer cents.';

COMMENT ON COLUMN "public"."orders"."total_amount_cents" IS 'Amount the buyer paid for the order, in integer cents.';

REVOKE ALL ON TABLE "public"."admin_connect_payout_release_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_connect_payout_release_view" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_connect_payout_release_view" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_disputes_monitor_view" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_disputes_monitor_view" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_disputes_monitor_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_disputes_monitor_view" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_disputes_monitor_view" TO "service_role";
