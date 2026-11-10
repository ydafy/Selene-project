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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_resolve_shipment_label_reconciliation"(uuid, uuid, text, text, text, text, text, bigint) TO "service_role";

COMMENT ON FUNCTION "public"."fn_resolve_shipment_label_reconciliation"(uuid, uuid, text, text, text, text, text, bigint) IS 'Service-only (SECURITY DEFINER): an active admin resolves a shipment stuck in label generation as label_found (continues as generated) or no_label (released to unclaimed, still paid). The shipment row is locked; a shipment that is no longer stuck returns already_resolved. The audit is the shipment_label_events row with the actor, resolution, previous state and note.';

REVOKE ALL ON FUNCTION "public"."fn_resolve_shipment_label_reconciliation"(uuid, uuid, text, text, text, text, text, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_resolve_shipment_label_reconciliation"(uuid, uuid, text, text, text, text, text, bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_resolve_shipment_label_reconciliation"(uuid, uuid, text, text, text, text, text, bigint) FROM PUBLIC, "anon", "authenticated";
