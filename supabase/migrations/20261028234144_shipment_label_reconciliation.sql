-- B6.1a (S3, S6): an admin bucket for shipments stuck in label generation.
--
-- A paid shipment whose label outcome is unproven (orphan_pending, or claimed/generation_sent with an expired claim)
-- has no way out today: the buyer cannot cancel, the paid-timeout cron skips it and nothing calls
-- fn_reconcile_shipment_label. The admin checks the Envia panel and records one of two outcomes:
--   label_found: the label exists; the shipment continues as generated and preparing (fn_reconcile_shipment_label).
--   no_label: no label was created; the shipment returns to unclaimed, still paid, so the seller can generate again,
--     a cancellation can claim it and auto-cancel-orders can refund it after expiry. No money, order or notification change.
-- The audit is a shipment_label_events row (actor, time, resolution, previous state, note); a new 'released' event type
-- is allowed for no_label. Legacy rows are not repaired (S2).
--
-- fn_reconcile_shipment_label gains an optional p_note and now accepts the stale claimed/generation_sent states
-- through fn_shipment_label_is_stuck (one definition of stuck for list, resolve and reconcile); its admin check is the
-- active-admin rule of is_admin() and of the B5.8b acknowledge function. It has no caller today, so the 10-argument
-- function is dropped instead of leaving an overload.
--
-- Grant review: every function here is SECURITY DEFINER (the helper is plain SQL) with search_path = '' and is limited
-- to service_role (PUBLIC, anon and authenticated revoked, restated explicitly because a new database grants EXECUTE
-- to them by default; see 20261028222400). Each writer and the list check auth.role() themselves. Clients never reach
-- them; the admin Edge Functions (B6.1b) do, after their own admin check.
BEGIN;

-- The release writes a 'released' event next to the existing ones.
ALTER TABLE public.shipment_label_events
  DROP CONSTRAINT shipment_label_events_event_type_check,
  ADD CONSTRAINT shipment_label_events_event_type_check CHECK (
    event_type IN ('claimed', 'sent', 'rejected', 'orphaned', 'generated', 'reconciled', 'released')
  );

-- The one definition of "stuck". An expired claim uses the same rule as fn_claim_shipment_label (<= clock_timestamp()).
CREATE OR REPLACE FUNCTION public.fn_shipment_label_is_stuck(
  p_status public.order_status_enum,
  p_state TEXT,
  p_claim_expires_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_status = 'paid' AND (
      p_state = 'orphan_pending'
      OR (p_state IN ('claimed', 'generation_sent') AND p_claim_expires_at <= clock_timestamp())
    ),
    false)
$$;

COMMENT ON FUNCTION public.fn_shipment_label_is_stuck(public.order_status_enum, TEXT, TIMESTAMPTZ) IS
  'Service-only helper: true for a paid shipment whose label outcome is unproven (orphan_pending, or claimed/generation_sent with an expired claim). Shared by the list, the resolve and the reconcile functions.';

REVOKE EXECUTE ON FUNCTION public.fn_shipment_label_is_stuck(public.order_status_enum, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_shipment_label_is_stuck(public.order_status_enum, TEXT, TIMESTAMPTZ) TO service_role;

DROP FUNCTION public.fn_reconcile_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION public.fn_reconcile_shipment_label(
  p_shipment_id UUID,
  p_actor_id UUID,
  p_envia_shipment_id TEXT,
  p_tracking_number TEXT,
  p_label_url TEXT,
  p_carrier TEXT,
  p_service TEXT,
  p_print_format TEXT,
  p_print_size TEXT,
  p_provider_cost_cents BIGINT,
  p_note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF NOT FOUND OR NOT public.fn_shipment_label_is_stuck(v_status, v_state, v_claim_expires_at) THEN
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
$$;

COMMENT ON FUNCTION public.fn_reconcile_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) IS
  'Service-only (SECURITY DEFINER): an active admin records the label that exists at Envia for a stuck shipment (see fn_shipment_label_is_stuck); it becomes generated and preparing and a reconciled event keeps the actor and note. Returns false when the shipment is not stuck.';

REVOKE EXECUTE ON FUNCTION public.fn_reconcile_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;

-- Stuck shipments, oldest first, with what an admin needs to find the label in the Envia panel. Read-only.
-- stuck_at: the orphaned event for an orphan, claim_expires_at for an expired claim.
CREATE OR REPLACE FUNCTION public.fn_list_shipment_label_reconciliations()
RETURNS TABLE (
  shipment_id UUID,
  order_id UUID,
  seller_id UUID,
  seller_name TEXT,
  buyer_id UUID,
  buyer_name TEXT,
  shipment_created_at TIMESTAMPTZ,
  label_generation_state TEXT,
  stuck_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  last_label_event_at TIMESTAMPTZ,
  quote_carrier TEXT,
  quote_service TEXT,
  quote_cost_cents BIGINT,
  quote_rated_at TIMESTAMPTZ,
  origin_postal_code TEXT,
  origin_city TEXT,
  destination_postal_code TEXT,
  destination_city TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    WHERE public.fn_shipment_label_is_stuck(s.status, s.label_generation_state, s.claim_expires_at)
  ) stuck
  ORDER BY stuck.stuck_at ASC, stuck.id ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_list_shipment_label_reconciliations() IS
  'Service-only (SECURITY DEFINER): paid shipments whose label outcome is unproven (orphan_pending, or claimed/generation_sent with an expired claim), oldest first, with the seller, buyer, frozen quote and postal codes an admin needs to find the label in the Envia panel. Read-only.';

REVOKE EXECUTE ON FUNCTION public.fn_list_shipment_label_reconciliations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_shipment_label_reconciliations() TO service_role;

-- Records the admin's decision for a stuck shipment under the shipment row lock.
--   label_found: the label exists at Envia; delegates to fn_reconcile_shipment_label (generated, preparing).
--     Carrier and service come from the frozen quote (settings as fallback); print format and size from system_settings,
--     the same source generate-shipping-label used to create the label.
--   no_label: no label was created; the shipment returns to unclaimed (status stays paid), so the seller can generate
--     again, a cancellation can claim it and auto-cancel-orders can refund it after expiry. No money, order or notification change.
-- The audit is the append-only shipment_label_events row (actor_id, created_at, metadata resolution, from_state, note).
-- A shipment that is no longer stuck returns already_resolved and nothing changes.
CREATE OR REPLACE FUNCTION public.fn_resolve_shipment_label_reconciliation(
  p_shipment_id UUID,
  p_actor_id UUID,
  p_resolution TEXT,
  p_note TEXT,
  p_envia_shipment_id TEXT DEFAULT NULL,
  p_tracking_number TEXT DEFAULT NULL,
  p_label_url TEXT DEFAULT NULL,
  p_provider_cost_cents BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

  IF NOT public.fn_shipment_label_is_stuck(v_shipment.status, v_shipment.label_generation_state, v_shipment.claim_expires_at) THEN
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
$$;

COMMENT ON FUNCTION public.fn_resolve_shipment_label_reconciliation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) IS
  'Service-only (SECURITY DEFINER): an active admin resolves a shipment stuck in label generation as label_found (continues as generated) or no_label (released to unclaimed, still paid). The shipment row is locked; a shipment that is no longer stuck returns already_resolved. The audit is the shipment_label_events row with the actor, resolution, previous state and note.';

REVOKE EXECUTE ON FUNCTION public.fn_resolve_shipment_label_reconciliation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_shipment_label_reconciliation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

COMMIT;
