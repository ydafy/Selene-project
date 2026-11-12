-- Move six functions that PostgREST never calls from public to internal
-- (odd/tasks/internal-schema.md S5, T2): fn_reconcile_connect_payments (run by
-- the reconcile-connect-payments pg_cron job, rescheduled here, so the job gets
-- a new jobid), fn_derive_order_status, fn_generate_profile_username,
-- fn_refresh_seller_stats, fn_shipment_label_is_stuck and
-- normalize_publication_rate (called only by other SQL). Their callers now name
-- them as internal.<function>; the bodies are unchanged except that each moved
-- function now sets search_path to '' (every reference in them is qualified).
-- Grant review: each moved function keeps its SECURITY mode and grants EXECUTE
-- to service_role only; PUBLIC, anon and authenticated get nothing, and they
-- have no USAGE on schema internal. Every caller is SECURITY DEFINER (runs as
-- postgres) except fn_shipments_status_trigger, which runs as the role that
-- updates shipments: only service_role and postgres can, and both have USAGE
-- on internal and EXECUTE on fn_derive_order_status. The cron job runs as
-- postgres.
SET local check_function_bodies = off;

SELECT cron.unschedule('reconcile-connect-payments');

DROP FUNCTION "public"."fn_derive_order_status"(uuid);

DROP FUNCTION "public"."fn_generate_profile_username"(text);

DROP FUNCTION "public"."fn_reconcile_connect_payments"();

DROP FUNCTION "public"."fn_refresh_seller_stats"(uuid);

DROP FUNCTION "public"."fn_shipment_label_is_stuck"(public.order_status_enum, text, timestamp WITH time zone);

DROP FUNCTION "public"."normalize_publication_rate"(numeric);

CREATE OR REPLACE FUNCTION internal.fn_derive_order_status (
  p_order_id uuid
)
  RETURNS public.order_status_enum
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_statuses public.order_status_enum[];
BEGIN
  -- Obtenemos de forma fidedigna (bypassando RLS) todos los estados de los paquetes del pedido
  SELECT array_agg(DISTINCT s.status)
  INTO v_statuses
  FROM public.shipments s
  WHERE s.order_id = p_order_id;

  -- Si se calcula antes de que se creen los shipments, se asume pendiente
  IF v_statuses IS NULL THEN
    RETURN 'pending';
  END IF;

  -- 1. Estados excepcionales (cualquier shipment afectado contamina el estado global por seguridad)
  IF 'dispute'    = ANY(v_statuses) THEN RETURN 'dispute';  END IF;
  IF 'refunded'   = ANY(v_statuses) THEN RETURN 'refunded'; END IF;
  IF 'cancelled'  = ANY(v_statuses) THEN RETURN 'cancelled'; END IF;

  -- 2. Progreso logístico (el cuello de botella o paquete menos avanzado manda en la visualización general)
  IF 'paid'       = ANY(v_statuses) THEN RETURN 'paid';      END IF;
  IF 'preparing'  = ANY(v_statuses) THEN RETURN 'preparing'; END IF;
  IF 'shipped'    = ANY(v_statuses) THEN RETURN 'shipped';   END IF;
  IF 'delivered'  = ANY(v_statuses) THEN RETURN 'delivered'; END IF;

  -- 3. Todos los paquetes completados de forma unánime
  IF 'completed'  = ALL(v_statuses) THEN RETURN 'completed'; END IF;

  RETURN 'paid';
END;
$function$;

CREATE OR REPLACE FUNCTION internal.fn_generate_profile_username (
  p_raw text
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix text;
  v_attempt int := 0;
  v_digits int;
BEGIN
  v_base := lower(
    translate(coalesce(p_raw, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')
  );
  v_base := regexp_replace(v_base, '[^a-z0-9_.]', '', 'g');
  IF char_length(v_base) < 3 THEN
    v_base := v_base || 'user';
  END IF;
  -- "deleted_" is reserved for closed accounts (fn_close_account). A bare
  -- "deleted" counts too: a collision suffix would turn it into deleted_NNNN.
  IF v_base = 'deleted' OR v_base LIKE 'deleted\_%' THEN
    v_base := 'user_' || v_base;
  END IF;
  v_base := left(v_base, 20);

  v_candidate := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE username = v_candidate
    );
    v_attempt := v_attempt + 1;
    -- Bound the search so the auth insert can never loop forever; with up to
    -- 10^8 suffixes per base this is unreachable in practice.
    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'Could not generate a free username for base %', v_base;
    END IF;
    -- Widen the suffix every 5 attempts so a crowded base still resolves.
    v_digits := least(4 + v_attempt / 5, 8);
    v_suffix := '_' || lpad(
      floor(random() * power(10, v_digits))::bigint::text, v_digits, '0'
    );
    v_candidate := left(v_base, 20 - char_length(v_suffix)) || v_suffix;
  END LOOP;

  RETURN v_candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION internal.fn_reconcile_connect_payments()
  RETURNS TABLE (
    shipment_id uuid,
    status      text,
    action      text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  -- Find shipments in 'paid' status older than 1 hour that have no
  -- stripe_payment_intent_id — these missed the webhook.
  RETURN QUERY
  SELECT
    s.id,
    s.status::TEXT,
    'MANUAL_REVIEW'::TEXT
  FROM public.shipments s -- Fixed: added 'public.' schema prefix
  WHERE s.stripe_payment_intent_id IS NULL
    AND s.status = 'paid'
    AND s.created_at < NOW() - INTERVAL '1 hour'
    AND s.created_at > '2026-06-01'::TIMESTAMPTZ -- Only Connect-era shipments
  LIMIT 100;
END;
$function$;

CREATE OR REPLACE FUNCTION internal.fn_refresh_seller_stats (
  p_seller_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_avg_rating NUMERIC;
    v_rev_count INTEGER;
    v_sales_count INTEGER;
BEGIN
    -- 1. Cálculo de reseñas en un solo escaneo
    SELECT 
        COALESCE(ROUND(AVG(rating)::numeric, 1), 0.0),
        COUNT(*)
    INTO v_avg_rating, v_rev_count
    FROM public.reviews
    WHERE seller_id = p_seller_id;

    -- 2. Cálculo de ventas completadas
    SELECT COUNT(DISTINCT o.id)
    INTO v_sales_count
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE oi.seller_id = p_seller_id
    AND o.status = 'completed';

    -- 3. Actualización atómica en el perfil
    UPDATE public.profiles
    SET
        average_rating = v_avg_rating,
        total_reviews = v_rev_count,
        total_sales = v_sales_count
    WHERE id = p_seller_id;

EXCEPTION WHEN OTHERS THEN
    -- Registro en la Caja Negra (Metadata JSONB)
    INSERT INTO public.system_logs (level, message, metadata) 
    VALUES ('ERROR', 'Fallo en recálculo de reputación', 
            jsonb_build_object('seller_id', p_seller_id, 'error', SQLERRM));
END;
$function$;

CREATE OR REPLACE FUNCTION internal.fn_shipment_label_is_stuck (
  p_status           public.order_status_enum,
  p_state            text,
  p_claim_expires_at timestamp with time zone
)
  RETURNS boolean
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  SELECT COALESCE(
    p_status = 'paid' AND (
      p_state = 'orphan_pending'
      OR (p_state IN ('claimed', 'generation_sent') AND p_claim_expires_at <= clock_timestamp())
    ),
    false)
$function$;

CREATE OR REPLACE FUNCTION internal.normalize_publication_rate (
  p_rate numeric
)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  SELECT CASE
    WHEN p_rate IS NULL OR p_rate < 0 THEN NULL
    WHEN p_rate <= 1 THEN p_rate
    WHEN p_rate <= 100 THEN p_rate / 100
    ELSE p_rate / 10000
  END;
$function$;

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
    internal.normalize_publication_rate(service_fee_pct),
    internal.normalize_publication_rate(insurance_rate)
  INTO v_shipping_buffer_cents, v_commission_rate, v_insurance_rate
  FROM public.system_settings
  WHERE id = 1;

  IF v_product.shipping_cost IS NULL
    OR v_shipping_buffer_cents IS NULL
    OR v_commission_rate IS NULL
    OR v_insurance_rate IS NULL THEN
    RAISE EXCEPTION 'LEGACY_PUBLICATION_ECONOMICS_UNAVAILABLE';
  END IF;

  v_reserve_cents :=
    round(v_product.shipping_cost * 100)::BIGINT
    + v_shipping_buffer_cents
    + ceil(round(v_product.price * 100)::NUMERIC * v_insurance_rate)::BIGINT;

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

CREATE OR REPLACE FUNCTION public.fn_list_shipment_label_reconciliations()
  RETURNS TABLE (
    shipment_id             uuid,
    order_id                uuid,
    seller_id               uuid,
    seller_name             text,
    buyer_id                uuid,
    buyer_name              text,
    shipment_created_at     timestamp with time zone,
    label_generation_state  text,
    stuck_at                timestamp with time zone,
    claim_expires_at        timestamp with time zone,
    last_label_event_at     timestamp with time zone,
    quote_carrier           text,
    quote_service           text,
    quote_cost_cents        bigint,
    quote_rated_at          timestamp with time zone,
    origin_postal_code      text,
    origin_city             text,
    destination_postal_code text,
    destination_city        text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  RETURN QUERY
  SELECT stuck.* FROM (
    SELECT s.id, s.order_id, s.seller_id, sp.username, o.buyer_id, bp.username, s.created_at,
           s.label_generation_state,
           CASE WHEN s.label_generation_state = 'orphan_pending'
                THEN COALESCE(e.orphaned_at, e.last_at, s.updated_at)
                ELSE s.claim_expires_at END AS stuck_at,
           s.claim_expires_at, e.last_at,
           s.label_quote_carrier, s.label_quote_service, s.label_quote_cost_cents, s.label_quote_rated_at,
           s.origin_address ->> 'zip_code', s.origin_address ->> 'city',
           o.shipping_address ->> 'zip_code', o.shipping_address ->> 'city'
    FROM public.shipments s
    JOIN public.orders o ON o.id = s.order_id
    LEFT JOIN public.profiles sp ON sp.id = s.seller_id
    LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
    LEFT JOIN LATERAL (
      SELECT max(le.created_at) FILTER (WHERE le.event_type = 'orphaned') AS orphaned_at,
             max(le.created_at) AS last_at
      FROM public.shipment_label_events le WHERE le.shipment_id = s.id
    ) e ON true
    WHERE internal.fn_shipment_label_is_stuck(s.status, s.label_generation_state, s.claim_expires_at)
  ) stuck
  ORDER BY stuck.stuck_at ASC, stuck.id ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_on_auth_user_created()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
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
    v_username := internal.fn_generate_profile_username(v_source);
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
      v_username := internal.fn_generate_profile_username(v_source);
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_reconcile_shipment_label (
  p_shipment_id         uuid,
  p_actor_id            uuid,
  p_envia_shipment_id   text,
  p_tracking_number     text,
  p_label_url           text,
  p_carrier             text,
  p_service             text,
  p_print_format        text,
  p_print_size          text,
  p_provider_cost_cents bigint,
  p_note                text   DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_note TEXT := btrim(p_note);
  v_status public.order_status_enum;
  v_state TEXT;
  v_claim_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Same rule as is_admin(): an active admin in profiles_private.
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_actor_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;
  IF p_note IS NOT NULL AND (v_note = '' OR char_length(v_note) > 200) THEN
    RAISE EXCEPTION 'INVALID_RESOLUTION_NOTE';
  END IF;
  IF p_envia_shipment_id IS NULL OR btrim(p_envia_shipment_id) = '' OR p_tracking_number IS NULL OR btrim(p_tracking_number) = '' OR p_label_url IS NULL OR btrim(p_label_url) = '' OR p_print_format IS NULL OR btrim(p_print_format) = '' OR p_print_size IS NULL OR btrim(p_print_size) = '' OR p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0 OR lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress' OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) <> 'ground' THEN
    RAISE EXCEPTION 'INVALID_PROVIDER_RESULT';
  END IF;

  SELECT status, label_generation_state, claim_expires_at
    INTO v_status, v_state, v_claim_expires_at
    FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR NOT internal.fn_shipment_label_is_stuck(v_status, v_state, v_claim_expires_at) THEN
    RETURN false;
  END IF;

  UPDATE public.shipments
  SET envia_shipment_id = p_envia_shipment_id,
      tracking_number = p_tracking_number,
      label_url = p_label_url,
      carrier = p_carrier,
      service = p_service,
      print_format = p_print_format,
      print_size = p_print_size,
      label_provider_cost_cents = p_provider_cost_cents,
      label_generation_state = 'generated',
      status = 'preparing',
      label_generated_at = now(),
      claim_token = NULL,
      claim_expires_at = NULL,
      updated_at = now()
  WHERE id = p_shipment_id;

  INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id, metadata)
  VALUES (p_shipment_id, 'reconciled', p_actor_id,
    jsonb_build_object('resolution', 'label_found', 'from_state', v_state)
      || CASE WHEN v_note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('note', v_note) END);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_resolve_shipment_label_reconciliation (
  p_shipment_id         uuid,
  p_actor_id            uuid,
  p_resolution          text,
  p_note                text,
  p_envia_shipment_id   text   DEFAULT NULL::text,
  p_tracking_number     text   DEFAULT NULL::text,
  p_label_url           text   DEFAULT NULL::text,
  p_provider_cost_cents bigint DEFAULT NULL::bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_note TEXT := btrim(p_note);
  v_shipment public.shipments%ROWTYPE;
  v_settings public.system_settings%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- The actor is stored on the event, so it must be an active admin by the same rule as is_admin().
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_actor_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF p_resolution IS NULL OR p_resolution NOT IN ('label_found', 'no_label') THEN
    RAISE EXCEPTION 'INVALID_RESOLUTION';
  END IF;
  IF v_note IS NULL OR v_note = '' OR char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'INVALID_RESOLUTION_NOTE';
  END IF;
  IF p_resolution = 'no_label' AND (p_envia_shipment_id IS NOT NULL OR p_tracking_number IS NOT NULL
      OR p_label_url IS NOT NULL OR p_provider_cost_cents IS NOT NULL) THEN
    RAISE EXCEPTION 'UNEXPECTED_PROVIDER_FIELDS';
  END IF;

  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  IF NOT internal.fn_shipment_label_is_stuck(v_shipment.status, v_shipment.label_generation_state, v_shipment.claim_expires_at) THEN
    RETURN jsonb_build_object(
      'result', 'already_resolved',
      'shipment_id', v_shipment.id,
      'status', v_shipment.status,
      'label_generation_state', v_shipment.label_generation_state);
  END IF;

  IF p_resolution = 'label_found' THEN
    SELECT * INTO v_settings FROM public.system_settings LIMIT 1;
    IF v_settings.envia_print_format IS NULL OR v_settings.envia_print_size IS NULL THEN
      RAISE EXCEPTION 'LABEL_SETTINGS_MISSING';
    END IF;
    IF NOT public.fn_reconcile_shipment_label(
      p_shipment_id, p_actor_id, p_envia_shipment_id, p_tracking_number, p_label_url,
      COALESCE(v_shipment.label_quote_carrier, v_settings.envia_carrier),
      COALESCE(v_shipment.label_quote_service, v_settings.envia_service),
      v_settings.envia_print_format, v_settings.envia_print_size, p_provider_cost_cents, v_note) THEN
      RAISE EXCEPTION 'SHIPMENT_LABEL_NOT_STUCK';
    END IF;
  ELSE
    UPDATE public.shipments
      SET label_generation_state = 'unclaimed', claim_token = NULL, claim_expires_at = NULL, updated_at = now()
      WHERE id = p_shipment_id;
    INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id, metadata)
      VALUES (p_shipment_id, 'released', p_actor_id,
        jsonb_build_object('resolution', 'no_label', 'from_state', v_shipment.label_generation_state, 'note', v_note));
  END IF;

  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id;
  RETURN jsonb_build_object(
    'result', 'resolved',
    'resolution', p_resolution,
    'shipment_id', v_shipment.id,
    'status', v_shipment.status,
    'label_generation_state', v_shipment.label_generation_state);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_shipments_status_trigger()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  -- Actualiza el estado de la orden global reactivamente tras cada cambio en shipments
  UPDATE public.orders
  SET status = internal.fn_derive_order_status(NEW.order_id),
      updated_at = now()
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_trigger_review_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
    -- Llamamos al trabajador que actualizamos en el Paso 1
    PERFORM internal.fn_refresh_seller_stats(COALESCE(NEW.seller_id, OLD.seller_id));
    
    RETURN NULL; -- Correcto para triggers AFTER

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en trigger tr_after_review_change',
            jsonb_build_object(
                'operation', TG_OP,
                'seller_id', COALESCE(NEW.seller_id, OLD.seller_id),
                'error', SQLERRM
            ));
    RAISE; -- Forzamos rollback para evitar inconsistencia
END;
$function$;

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

    IF NEW.price IS NOT DISTINCT FROM OLD.price
      AND NEW.shipping_cost IS NOT DISTINCT FROM OLD.shipping_cost THEN
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
    internal.normalize_publication_rate(service_fee_pct),
    internal.normalize_publication_rate(insurance_rate)
  INTO v_shipping_buffer_cents, v_commission_rate, v_insurance_rate
  FROM public.system_settings
  WHERE id = 1;

  IF v_shipping_buffer_cents IS NULL
    OR v_commission_rate IS NULL
    OR v_insurance_rate IS NULL
    OR NEW.shipping_cost IS NULL THEN
    RAISE EXCEPTION 'PUBLICATION_ECONOMICS_CONFIGURATION_REQUIRED';
  END IF;

  v_expected_reserve_cents :=
    round(NEW.shipping_cost * 100)::BIGINT
    + v_shipping_buffer_cents
    + ceil(round(NEW.price * 100)::NUMERIC * v_insurance_rate)::BIGINT;

  IF NEW.publication_shipping_reserve_cents IS DISTINCT FROM v_expected_reserve_cents
    OR NEW.publication_commission_rate IS DISTINCT FROM v_commission_rate
    OR NEW.publication_insurance_rate IS DISTINCT FROM v_insurance_rate THEN
    RAISE EXCEPTION 'INVALID_OR_STALE_PUBLICATION_ECONOMICS';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION "internal"."fn_shipment_label_is_stuck"(public.order_status_enum, text, timestamp with time zone) IS 'Service-only helper: true for a paid shipment whose label outcome is unproven (orphan_pending, or claimed/generation_sent with an expired claim). Shared by the list, the resolve and the reconcile functions.';

REVOKE ALL ON FUNCTION "internal"."fn_derive_order_status"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "internal"."fn_derive_order_status"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "internal"."fn_generate_profile_username"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "internal"."fn_generate_profile_username"(text) TO "service_role";

REVOKE ALL ON FUNCTION "internal"."fn_reconcile_connect_payments"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "internal"."fn_reconcile_connect_payments"() TO "service_role";

REVOKE ALL ON FUNCTION "internal"."fn_refresh_seller_stats"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "internal"."fn_refresh_seller_stats"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "internal"."fn_shipment_label_is_stuck"(public.order_status_enum, text, timestamp WITH time zone) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "internal"."fn_shipment_label_is_stuck"(public.order_status_enum, text, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "internal"."normalize_publication_rate"(numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "internal"."normalize_publication_rate"(numeric) TO "service_role";

SELECT cron.schedule_in_database('reconcile-connect-payments', '0 */6 * * *', 'select * from internal.fn_reconcile_connect_payments()', 'postgres', NULL, true);
