BEGIN;

-- One purchased listing is one fulfillment, label, tracking and payout unit.
-- Do not repair or delete production data here. Legacy seller-grouped rows
-- require a maintainer-owned clean pre-launch reset before this invariant can
-- be enabled safely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.order_items
    WHERE shipment_id IS NOT NULL
    GROUP BY shipment_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'PRELAUNCH_RESET_REQUIRED:LEGACY_GROUPED_SHIPMENTS'
      USING DETAIL = 'Found legacy grouped shipment links: multiple order_items reference one shipment.',
            HINT = 'Perform the approved clean pre-launch reset, then retry this migration. This migration never deletes order data.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS order_items_shipment_id_unique
  ON public.order_items (shipment_id)
  WHERE shipment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS order_items_order_product_unique
  ON public.order_items (order_id, product_id);

ALTER TABLE public.system_settings
  DROP CONSTRAINT IF EXISTS system_settings_envia_tuple_check,
  ADD CONSTRAINT system_settings_envia_tuple_check CHECK (
    (envia_carrier IS NULL AND envia_service IS NULL AND envia_print_format IS NULL AND envia_print_size IS NULL AND listing_quote_reference_destination IS NULL)
    OR (
      envia_carrier = 'paquetexpress'
      AND lower(regexp_replace(btrim(envia_service), '\s+', ' ', 'g')) = 'ground'
      AND length(trim(envia_print_format)) > 0
      AND length(trim(envia_print_size)) > 0
      AND jsonb_typeof(listing_quote_reference_destination) = 'object'
      AND listing_quote_reference_destination ?& ARRAY['name', 'phone', 'street', 'number', 'district', 'city', 'state', 'country', 'postalCode']
      AND length(trim(listing_quote_reference_destination ->> 'name')) > 0
      AND length(trim(listing_quote_reference_destination ->> 'phone')) > 0
      AND length(trim(listing_quote_reference_destination ->> 'street')) > 0
      AND length(trim(listing_quote_reference_destination ->> 'number')) > 0
      AND length(trim(listing_quote_reference_destination ->> 'district')) > 0
      AND length(trim(listing_quote_reference_destination ->> 'city')) > 0
      AND length(trim(listing_quote_reference_destination ->> 'state')) > 0
      AND upper(listing_quote_reference_destination ->> 'state') <> 'MX'
      AND listing_quote_reference_destination ->> 'country' = 'MX'
      AND listing_quote_reference_destination ->> 'postalCode' ~ '^[0-9]{5}$'
    )
  );

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS label_quote_carrier TEXT,
  ADD COLUMN IF NOT EXISTS label_quote_service TEXT,
  ADD COLUMN IF NOT EXISTS label_quote_cost_cents BIGINT,
  ADD COLUMN IF NOT EXISTS label_quote_reference TEXT,
  ADD COLUMN IF NOT EXISTS label_quote_rated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS label_quote_input_hash TEXT;

ALTER TABLE public.shipments
  DROP CONSTRAINT IF EXISTS shipments_label_generation_state_check,
  ADD CONSTRAINT shipments_label_generation_state_check CHECK (
    label_generation_state IN ('unclaimed', 'claimed', 'generation_sent', 'retryable_rejected', 'orphan_pending', 'generated')
  ),
  DROP CONSTRAINT IF EXISTS shipments_label_claim_check,
  ADD CONSTRAINT shipments_label_claim_check CHECK (
    (label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')) = (claim_token IS NOT NULL)
  ),
  ADD CONSTRAINT shipments_label_quote_cost_cents_check CHECK (
    label_quote_cost_cents IS NULL OR label_quote_cost_cents >= 0
  );

ALTER TABLE public.shipments
  DROP CONSTRAINT IF EXISTS shipments_label_provider_cost_cents_check,
  ADD CONSTRAINT shipments_label_provider_cost_cents_check CHECK (
    label_provider_cost_cents IS NULL OR label_provider_cost_cents >= 0
  );

-- Retire the seller-grouped settlement RPC at the database boundary as well as
-- in the webhook. Existing rows remain untouched; new grouped shipments fail.
CREATE OR REPLACE FUNCTION public.fn_create_shipment_from_payment(
  p_stripe_payment_intent_id TEXT,
  p_amount_received BIGINT,
  p_metadata JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED'
    USING HINT = 'Use the single-modal per-product settlement flow.';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_create_shipment_from_payment(TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_shipment_from_payment(TEXT, BIGINT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_persist_shipment_label_quote(
  p_shipment_id UUID,
  p_claim_token UUID,
  p_carrier TEXT,
  p_service TEXT,
  p_quote_cost_cents BIGINT,
  p_quote_reference TEXT,
  p_input_hash TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress'
     OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) <> 'ground'
     OR p_quote_cost_cents IS NULL OR p_quote_cost_cents < 0
     OR p_input_hash IS NULL OR btrim(p_input_hash) = '' THEN
    RAISE EXCEPTION 'INVALID_ACCEPTED_RATE';
  END IF;
  UPDATE public.shipments
  SET label_quote_carrier = p_carrier,
      label_quote_service = p_service,
      label_quote_cost_cents = p_quote_cost_cents,
      label_quote_reference = NULLIF(btrim(p_quote_reference), ''),
      label_quote_rated_at = now(),
      label_quote_input_hash = p_input_hash,
      updated_at = now()
  WHERE id = p_shipment_id
    AND label_generation_state = 'claimed'
    AND claim_token = p_claim_token;
  RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_mark_shipment_label_sent(p_shipment_id UUID, p_claim_token UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments SET label_generation_state = 'generation_sent', claim_expires_at = now() + interval '15 minutes', updated_at = now()
  WHERE id = p_shipment_id AND label_generation_state = 'claimed' AND claim_token = p_claim_token
    AND lower(label_quote_carrier) = 'paquetexpress'
    AND lower(regexp_replace(label_quote_service, '\s+', ' ', 'g')) = 'ground'
    AND label_quote_cost_cents IS NOT NULL AND label_quote_input_hash IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type) VALUES (p_shipment_id, 'sent');
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_finalize_shipment_label(p_shipment_id UUID, p_claim_token UUID, p_envia_shipment_id TEXT, p_tracking_number TEXT, p_label_url TEXT, p_carrier TEXT, p_service TEXT, p_print_format TEXT, p_print_size TEXT, p_provider_cost_cents BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_envia_shipment_id IS NULL OR p_tracking_number IS NULL OR p_label_url IS NULL OR p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0 OR lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress' OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) <> 'ground' THEN RAISE EXCEPTION 'INVALID_PROVIDER_RESULT'; END IF;
  UPDATE public.shipments SET envia_shipment_id = p_envia_shipment_id, tracking_number = p_tracking_number, label_url = p_label_url, carrier = p_carrier, service = p_service, print_format = p_print_format, print_size = p_print_size, label_provider_cost_cents = p_provider_cost_cents, label_generation_state = 'generated', status = 'preparing', label_generated_at = now(), claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = p_shipment_id AND status = 'paid' AND label_generation_state = 'generation_sent' AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type) VALUES (p_shipment_id, 'generated');
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_reconcile_shipment_label(p_shipment_id UUID, p_actor_id UUID, p_envia_shipment_id TEXT, p_tracking_number TEXT, p_label_url TEXT, p_carrier TEXT, p_service TEXT, p_print_format TEXT, p_print_size TEXT, p_provider_cost_cents BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT role INTO v_role FROM public.profiles_private WHERE id = p_actor_id;
  IF v_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY'; END IF;
  IF p_envia_shipment_id IS NULL OR btrim(p_envia_shipment_id) = '' OR p_tracking_number IS NULL OR btrim(p_tracking_number) = '' OR p_label_url IS NULL OR btrim(p_label_url) = '' OR p_print_format IS NULL OR btrim(p_print_format) = '' OR p_print_size IS NULL OR btrim(p_print_size) = '' OR p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0 OR lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress' OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) <> 'ground' THEN RAISE EXCEPTION 'INVALID_PROVIDER_RESULT'; END IF;
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
  WHERE id = p_shipment_id AND status = 'paid' AND label_generation_state = 'orphan_pending';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id)
  VALUES (p_shipment_id, 'reconciled', p_actor_id);
  RETURN true;
END; $$;

-- A request may have reached Envia after `generation_sent`; it must never be
-- reclaimed for another provider call. Deterministic rejections can be retried,
-- while uncertainty remains reconciliation-only with the original claim token.
CREATE OR REPLACE FUNCTION public.fn_claim_shipment_label(p_shipment_id UUID, p_seller_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_state TEXT; v_seller_id UUID; v_token UUID; v_claim_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT seller_id, label_generation_state, claim_expires_at
    INTO v_seller_id, v_state, v_claim_expires_at
    FROM public.shipments
    WHERE id = p_shipment_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF v_seller_id IS DISTINCT FROM p_seller_id THEN RAISE EXCEPTION 'SELLER_MISMATCH'; END IF;
  IF v_state = 'generated' THEN RETURN jsonb_build_object('status', 'generated'); END IF;
  IF v_state IN ('claimed', 'generation_sent')
    AND v_claim_expires_at IS NOT NULL
    AND v_claim_expires_at <= now() THEN
    UPDATE public.shipments
      SET label_generation_state = 'orphan_pending', claim_expires_at = NULL, updated_at = now()
      WHERE id = p_shipment_id
        AND label_generation_state IN ('claimed', 'generation_sent');
    INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id, metadata)
      VALUES (p_shipment_id, 'orphaned', p_seller_id,
        jsonb_build_object('errorClass', 'stale_claim_requires_reconciliation'));
    RETURN jsonb_build_object('status', 'orphan_pending', 'reconciliation_required', true);
  END IF;
  IF v_state IN ('claimed', 'generation_sent') THEN
    RETURN jsonb_build_object('status', 'claimed_conflict');
  END IF;
  IF v_state = 'orphan_pending' THEN RETURN jsonb_build_object('status', 'orphan_pending'); END IF;
  v_token := gen_random_uuid();
  UPDATE public.shipments
    SET label_generation_state = 'claimed', claim_token = v_token,
        claim_expires_at = now() + interval '15 minutes', updated_at = now()
    WHERE id = p_shipment_id
      AND status = 'paid'
      AND label_generation_state IN ('unclaimed', 'retryable_rejected');
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'ineligible'); END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id)
    VALUES (p_shipment_id, 'claimed', p_seller_id);
  RETURN jsonb_build_object('status', 'claimed', 'claim_token', v_token);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_mark_shipment_label_rejected(
  p_shipment_id UUID,
  p_claim_token UUID,
  p_error_class TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments
    SET label_generation_state = 'retryable_rejected', claim_token = NULL,
        claim_expires_at = NULL, updated_at = now()
    WHERE id = p_shipment_id
      AND label_generation_state IN ('claimed', 'generation_sent')
      AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, metadata)
    VALUES (p_shipment_id, 'rejected', jsonb_build_object('errorClass', p_error_class));
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_mark_shipment_label_orphan(
  p_shipment_id UUID,
  p_claim_token UUID,
  p_error_class TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments
    SET label_generation_state = 'orphan_pending', claim_expires_at = NULL, updated_at = now()
    WHERE id = p_shipment_id
      AND label_generation_state IN ('claimed', 'generation_sent')
      AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, metadata)
    VALUES (p_shipment_id, 'orphaned', jsonb_build_object('errorClass', p_error_class));
  RETURN true;
END; $$;

REVOKE EXECUTE ON FUNCTION public.fn_persist_shipment_label_quote(UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_persist_shipment_label_quote(UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_mark_shipment_label_sent(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mark_shipment_label_sent(UUID, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_finalize_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finalize_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_reconcile_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

COMMIT;
