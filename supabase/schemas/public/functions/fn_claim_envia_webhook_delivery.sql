CREATE OR REPLACE FUNCTION public.fn_claim_envia_webhook_delivery (
  p_delivery_id    text,
  p_event_name     text,
  p_payload_sha256 text
)
  RETURNS TABLE (
    kind text,
    id   uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_id uuid;
  v_existing_sha256 text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_delivery_id IS NULL OR p_delivery_id = ''
     OR p_event_name IS NULL OR p_event_name = ''
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  INSERT INTO internal.webhook_deliveries AS d (provider, delivery_id, event_name, payload_sha256)
  VALUES ('envia', p_delivery_id, p_event_name, p_payload_sha256)
  ON CONFLICT (provider, delivery_id) DO NOTHING
  RETURNING d.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'new'::text, v_id;
    RETURN;
  END IF;

  -- A second statement sees the delivery that won the insert, even a concurrent one.
  SELECT d.payload_sha256 INTO v_existing_sha256
  FROM internal.webhook_deliveries AS d
  WHERE d.provider = 'envia' AND d.delivery_id = p_delivery_id;

  RETURN QUERY SELECT
    CASE WHEN v_existing_sha256 = p_payload_sha256 THEN 'duplicate' ELSE 'collision' END,
    NULL::uuid;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) IS 'Service-only (SECURITY DEFINER): records an Envia webhook delivery once. Returns kind new with the delivery id, or duplicate (same id and payload hash) or collision (same id, other payload hash) with no id and no change.';

REVOKE ALL ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) FROM PUBLIC, "anon", "authenticated";
