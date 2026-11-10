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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_reconcile_shipment_label"(uuid, uuid, text, text, text, text, text, text, text, bigint, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_reconcile_shipment_label"(uuid, uuid, text, text, text, text, text, text, text, bigint, text) IS 'Service-only (SECURITY DEFINER): an active admin records the label that exists at Envia for a stuck shipment (see fn_shipment_label_is_stuck); it becomes generated and preparing and a reconciled event keeps the actor and note. Returns false when the shipment is not stuck.';

REVOKE ALL ON FUNCTION "public"."fn_reconcile_shipment_label"(uuid, uuid, text, text, text, text, text, text, text, bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_reconcile_shipment_label"(uuid, uuid, text, text, text, text, text, text, text, bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_reconcile_shipment_label"(uuid, uuid, text, text, text, text, text, text, text, bigint, text) FROM PUBLIC, "anon", "authenticated";
