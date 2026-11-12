CREATE OR REPLACE FUNCTION public.fn_mark_webhook_delivery (
  p_delivery_id uuid,
  p_state       text,
  p_error_code  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_delivery_id IS NULL
     OR p_state IS NULL OR p_state NOT IN ('processed', 'failed')
     OR (p_state = 'processed' AND p_error_code IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  IF p_state = 'processed' THEN
    UPDATE internal.webhook_deliveries
    SET state = 'processed',
        processed_at = now()
    WHERE id = p_delivery_id;
  ELSE
    UPDATE internal.webhook_deliveries
    SET state = 'failed',
        error_code = p_error_code
    WHERE id = p_delivery_id;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) IS 'Service-only (SECURITY DEFINER): marks a webhook delivery processed (stamps processed_at) or failed (records p_error_code). An unknown id changes nothing.';

REVOKE ALL ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) FROM PUBLIC, "anon", "authenticated";
