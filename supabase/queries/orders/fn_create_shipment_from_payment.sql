BEGIN;

-- RPC: fn_create_shipment_from_payment
-- Description: Retired seller-grouped settlement entrypoint. The active
-- single-modal checkout persists one shipment per purchased product.
--
-- Args:
--   p_stripe_payment_intent_id: Stripe PI ID from webhook
--   p_amount_received: Total amount in centavos from Stripe for this seller PI
--   p_metadata: JSONB metadata with seller_id, buyer_id, address_id, product_ids,
--               order_group_id/order_id, commission, seller shipping deduction,
--               and insurance cents
-- Returns: { order_id, shipment_id, is_new_order, status }
--
-- Idempotent: if stripe_payment_intent_id already exists, returns existing data.
-- NO wallet operations — Stripe Connect handles fund holding/release.

CREATE OR REPLACE FUNCTION public.fn_create_shipment_from_payment(
  p_stripe_payment_intent_id TEXT,
  p_amount_received BIGINT,
  p_metadata JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_id UUID;
  v_buyer_id UUID;
  v_address_id UUID;
  v_addr_snapshot JSONB;
  v_order_group_id TEXT;
  v_commission_cents BIGINT;
  v_seller_shipping_deduction_cents BIGINT;
  v_total_sellers INT;
  v_existing_shipment RECORD;
  v_existing_order_id UUID;
  v_order_id UUID;
  v_shipment_id UUID;
  v_product_ids UUID[];
  v_order_amount NUMERIC;
  v_commission_amount NUMERIC;
  v_is_new_order BOOLEAN := false;
BEGIN
  RAISE EXCEPTION 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED'
    USING HINT = 'Use the single-modal per-product settlement flow.';

  -- Extract and validate metadata.
  v_seller_id := (p_metadata ->> 'seller_id')::UUID;
  v_buyer_id := (p_metadata ->> 'buyer_id')::UUID;
  v_address_id := NULLIF(p_metadata ->> 'address_id', '')::UUID;
  v_order_group_id := p_metadata ->> 'order_group_id';
  v_commission_cents := (p_metadata ->> 'commission_cents')::BIGINT;
  v_seller_shipping_deduction_cents := COALESCE(
    (p_metadata ->> 'seller_shipping_deduction_cents')::BIGINT,
    (p_metadata ->> 'shipping_cents')::BIGINT,
    0
  );
  v_total_sellers := (p_metadata ->> 'total_sellers')::INT;
  v_order_amount := p_amount_received / 100.0;
  v_commission_amount := COALESCE(v_commission_cents, 0) / 100.0;

  IF v_address_id IS NULL THEN
    RAISE EXCEPTION 'ADDRESS_ID_REQUIRED';
  END IF;

  SELECT to_jsonb(a.*) INTO v_addr_snapshot
  FROM public.addresses a
  WHERE a.id = v_address_id
    AND a.user_id = v_buyer_id;

  IF v_addr_snapshot IS NULL THEN
    RAISE EXCEPTION 'ADDRESS_NOT_FOUND_OR_UNAUTHORIZED';
  END IF;

  -- Stripe metadata values are strings, so product_ids is a JSON string.
  SELECT array_agg(pid::UUID) INTO v_product_ids
  FROM jsonb_array_elements_text((p_metadata ->> 'product_ids')::jsonb) AS pid;

  IF v_product_ids IS NULL OR array_length(v_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_IDS_REQUIRED';
  END IF;

  -- Idempotency: check if this PI was already processed.
  SELECT id, order_id INTO v_existing_shipment
  FROM public.shipments
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id', v_existing_shipment.order_id,
      'shipment_id', v_existing_shipment.id,
      'is_new_order', false,
      'status', 'duplicate'
    );
  END IF;

  -- Connect checkout sends a shared UUID for every seller PI in the order.
  v_order_id := COALESCE(
    NULLIF(p_metadata ->> 'order_id', '')::UUID,
    NULLIF(v_order_group_id, '')::UUID
  );

  IF v_order_id IS NOT NULL THEN
    SELECT id INTO v_existing_order_id
    FROM public.orders
    WHERE id = v_order_id
      AND buyer_id = v_buyer_id
    FOR UPDATE;
  END IF;

  -- First seller PI creates the order. Later seller PIs add to totals.
  IF v_existing_order_id IS NULL THEN
    v_is_new_order := true;

    IF v_order_id IS NULL THEN
      INSERT INTO public.orders (
        buyer_id,
        status,
        stripe_payment_intent_id,
        service_fee_amount,
        total_amount,
        shipping_address
      ) VALUES (
        v_buyer_id,
        'paid',
        NULL,
        v_commission_amount,
        v_order_amount,
        v_addr_snapshot
      )
      RETURNING id INTO v_order_id;
    ELSE
      INSERT INTO public.orders (
        id,
        buyer_id,
        status,
        stripe_payment_intent_id,
        service_fee_amount,
        total_amount,
        shipping_address
      ) VALUES (
        v_order_id,
        v_buyer_id,
        'paid',
        NULL,
        v_commission_amount,
        v_order_amount,
        v_addr_snapshot
      )
      RETURNING id INTO v_order_id;
    END IF;
  ELSE
    v_order_id := v_existing_order_id;

    UPDATE public.orders
    SET total_amount = total_amount + v_order_amount,
        service_fee_amount = COALESCE(service_fee_amount, 0) + v_commission_amount,
        updated_at = now()
    WHERE id = v_order_id;
  END IF;

  -- Persist the seller-facing estimated shipping deduction from Stripe metadata.
  -- Prefer seller_shipping_deduction_cents; shipping_cents is a legacy fallback.
  -- This is the payout deduction basis and is known before label generation.
  INSERT INTO public.shipments (
    order_id,
    seller_id,
    status,
    stripe_payment_intent_id,
    shipping_cost
  ) VALUES (
    v_order_id,
    v_seller_id,
    'paid',
    p_stripe_payment_intent_id,
    v_seller_shipping_deduction_cents
  )
  RETURNING id INTO v_shipment_id;

  INSERT INTO public.order_items (
    order_id,
    shipment_id,
    seller_id,
    product_id,
    price_at_purchase,
    shipping_amount,
    net_payout
  )
  SELECT
    v_order_id,
    v_shipment_id,
    v_seller_id,
    p.id,
    p.price,
    0,
    ROUND(p.price * 0.94, 2)
  FROM public.products p
  WHERE p.id = ANY(v_product_ids)
    AND p.seller_id = v_seller_id;

  WITH seller_products AS (
    SELECT p.id
    FROM public.products p
    WHERE p.seller_id = v_seller_id
      AND p.status = 'RESERVED'
      AND p.id = ANY(v_product_ids)
  )
  UPDATE public.products
  SET status = 'SOLD', updated_at = now()
  FROM seller_products
  WHERE products.id = seller_products.id;

  IF v_total_sellers IS NOT NULL AND v_total_sellers > 0 THEN
    PERFORM fn_derive_order_status(v_order_id);
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'shipment_id', v_shipment_id,
    'is_new_order', v_is_new_order,
    'status', 'created'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_create_shipment_from_payment(TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_shipment_from_payment(TEXT, BIGINT, JSONB) TO service_role;

COMMIT;
