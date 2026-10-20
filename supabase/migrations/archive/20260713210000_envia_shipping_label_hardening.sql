BEGIN;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS envia_carrier TEXT,
  ADD COLUMN IF NOT EXISTS envia_service TEXT,
  ADD COLUMN IF NOT EXISTS envia_print_format TEXT,
  ADD COLUMN IF NOT EXISTS envia_print_size TEXT,
  ADD COLUMN IF NOT EXISTS listing_quote_reference_destination JSONB;

ALTER TABLE public.system_settings
  DROP CONSTRAINT IF EXISTS system_settings_envia_tuple_check,
  ADD CONSTRAINT system_settings_envia_tuple_check CHECK (
    (envia_carrier IS NULL AND envia_service IS NULL AND envia_print_format IS NULL AND envia_print_size IS NULL AND listing_quote_reference_destination IS NULL)
    OR (
      envia_carrier = 'paquetexpress'
      AND length(trim(envia_service)) > 0
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

-- Production Paquetexpress service and print values are intentionally unset until
-- an operator validates them. The all-null tuple fails closed in Edge validation.
INSERT INTO public.system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS label_generation_state TEXT NOT NULL DEFAULT 'unclaimed',
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS print_format TEXT,
  ADD COLUMN IF NOT EXISTS print_size TEXT,
  ADD COLUMN IF NOT EXISTS label_provider_cost_cents BIGINT,
  ADD COLUMN IF NOT EXISTS label_generated_at TIMESTAMPTZ;

ALTER TABLE public.shipments
  DROP CONSTRAINT IF EXISTS shipments_label_generation_state_check,
  ADD CONSTRAINT shipments_label_generation_state_check CHECK (
    label_generation_state IN ('unclaimed', 'claimed', 'retryable_rejected', 'orphan_pending', 'generated')
  ),
  DROP CONSTRAINT IF EXISTS shipments_label_provider_cost_cents_check,
  ADD CONSTRAINT shipments_label_provider_cost_cents_check CHECK (
    label_provider_cost_cents IS NULL OR label_provider_cost_cents >= 0
  ),
  DROP CONSTRAINT IF EXISTS shipments_label_claim_check,
  ADD CONSTRAINT shipments_label_claim_check CHECK (
    (label_generation_state IN ('claimed', 'orphan_pending')) = (claim_token IS NOT NULL)
  );

UPDATE public.shipments
SET label_generation_state = 'generated', label_generated_at = COALESCE(shipped_at, updated_at, now())
WHERE label_url IS NOT NULL OR envia_shipment_id IS NOT NULL OR tracking_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS shipments_label_generation_state_idx
  ON public.shipments (label_generation_state) WHERE label_generation_state IN ('claimed', 'orphan_pending');

CREATE TABLE IF NOT EXISTS public.shipment_label_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('claimed', 'sent', 'rejected', 'orphaned', 'generated', 'reconciled')),
  actor_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    NOT metadata ?| ARRAY['name', 'phone', 'street', 'number', 'district', 'label_url', 'raw_provider_response', 'token', 'authorization']
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shipment_label_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shipment label events are append-only" ON public.shipment_label_events
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.fn_claim_shipment_label(p_shipment_id UUID, p_seller_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_state TEXT; v_seller_id UUID; v_token UUID; v_claim_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT seller_id, label_generation_state, claim_expires_at INTO v_seller_id, v_state, v_claim_expires_at FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF v_seller_id IS DISTINCT FROM p_seller_id THEN RAISE EXCEPTION 'SELLER_MISMATCH'; END IF;
  IF v_state = 'generated' THEN RETURN jsonb_build_object('status', 'generated'); END IF;
  IF v_state = 'claimed' AND v_claim_expires_at <= now() THEN
    UPDATE public.shipments SET label_generation_state = 'orphan_pending', claim_expires_at = NULL, updated_at = now() WHERE id = p_shipment_id;
    INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id, metadata) VALUES (p_shipment_id, 'orphaned', p_seller_id, jsonb_build_object('errorClass', 'stale_claim_requires_reconciliation'));
    RETURN jsonb_build_object('status', 'orphan_pending', 'reconciliation_required', true);
  END IF;
  IF v_state = 'claimed' THEN RETURN jsonb_build_object('status', 'claimed_conflict'); END IF;
  IF v_state = 'orphan_pending' THEN RETURN jsonb_build_object('status', 'orphan_pending'); END IF;
  v_token := gen_random_uuid();
  UPDATE public.shipments SET label_generation_state = 'claimed', claim_token = v_token, claim_expires_at = now() + interval '15 minutes', updated_at = now()
  WHERE id = p_shipment_id AND status = 'paid' AND label_generation_state IN ('unclaimed', 'retryable_rejected');
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'ineligible'); END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id) VALUES (p_shipment_id, 'claimed', p_seller_id);
  RETURN jsonb_build_object('status', 'claimed', 'claim_token', v_token);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_mark_shipment_label_sent(p_shipment_id UUID, p_claim_token UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments SET claim_expires_at = now() + interval '15 minutes', updated_at = now()
  WHERE id = p_shipment_id AND label_generation_state = 'claimed' AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type) VALUES (p_shipment_id, 'sent');
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_finalize_shipment_label(p_shipment_id UUID, p_claim_token UUID, p_envia_shipment_id TEXT, p_tracking_number TEXT, p_label_url TEXT, p_carrier TEXT, p_service TEXT, p_print_format TEXT, p_print_size TEXT, p_provider_cost_cents BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_envia_shipment_id IS NULL OR p_tracking_number IS NULL OR p_label_url IS NULL OR p_provider_cost_cents < 0 THEN RAISE EXCEPTION 'INVALID_PROVIDER_RESULT'; END IF;
  UPDATE public.shipments SET envia_shipment_id = p_envia_shipment_id, tracking_number = p_tracking_number, label_url = p_label_url, carrier = p_carrier, service = p_service, print_format = p_print_format, print_size = p_print_size, label_provider_cost_cents = p_provider_cost_cents, label_generation_state = 'generated', label_generated_at = now(), claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = p_shipment_id AND label_generation_state = 'claimed' AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type) VALUES (p_shipment_id, 'generated');
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_mark_shipment_label_rejected(p_shipment_id UUID, p_claim_token UUID, p_error_class TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments SET label_generation_state = 'retryable_rejected', claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = p_shipment_id AND label_generation_state = 'claimed' AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, metadata) VALUES (p_shipment_id, 'rejected', jsonb_build_object('errorClass', p_error_class));
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_mark_shipment_label_orphan(p_shipment_id UUID, p_claim_token UUID, p_error_class TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments SET label_generation_state = 'orphan_pending', claim_expires_at = NULL, updated_at = now()
  WHERE id = p_shipment_id AND label_generation_state = 'claimed' AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, metadata) VALUES (p_shipment_id, 'orphaned', jsonb_build_object('errorClass', p_error_class));
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_reconcile_shipment_label(p_shipment_id UUID, p_actor_id UUID, p_envia_shipment_id TEXT, p_tracking_number TEXT, p_label_url TEXT, p_carrier TEXT, p_service TEXT, p_print_format TEXT, p_print_size TEXT, p_provider_cost_cents BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT role INTO v_role FROM public.profiles_private WHERE id = p_actor_id;
  IF v_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY'; END IF;
  IF p_envia_shipment_id IS NULL OR btrim(p_envia_shipment_id) = '' OR p_tracking_number IS NULL OR btrim(p_tracking_number) = '' OR p_label_url IS NULL OR btrim(p_label_url) = '' OR p_carrier IS NULL OR btrim(p_carrier) = '' OR p_service IS NULL OR btrim(p_service) = '' OR p_print_format IS NULL OR btrim(p_print_format) = '' OR p_print_size IS NULL OR btrim(p_print_size) = '' OR p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0 THEN RAISE EXCEPTION 'INVALID_PROVIDER_RESULT'; END IF;
  UPDATE public.shipments SET envia_shipment_id = p_envia_shipment_id, tracking_number = p_tracking_number, label_url = p_label_url, carrier = p_carrier, service = p_service, print_format = p_print_format, print_size = p_print_size, label_provider_cost_cents = p_provider_cost_cents, label_generation_state = 'generated', label_generated_at = now(), claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = p_shipment_id AND label_generation_state = 'orphan_pending';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id) VALUES (p_shipment_id, 'reconciled', p_actor_id);
  RETURN true;
END; $$;

REVOKE EXECUTE ON FUNCTION public.fn_claim_shipment_label(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_shipment_label(UUID, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_mark_shipment_label_sent(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mark_shipment_label_sent(UUID, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_finalize_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finalize_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_mark_shipment_label_rejected(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mark_shipment_label_rejected(UUID, UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_mark_shipment_label_orphan(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mark_shipment_label_orphan(UUID, UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_reconcile_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

COMMIT;
