CREATE OR REPLACE FUNCTION public.fn_list_push_receipts_due (
  p_limit integer
)
  RETURNS TABLE (
    delivery_id uuid,
    ticket_id   text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Expo accepts at most 1000 receipt ids per request.
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'INVALID_PUSH_RECEIPT_LIMIT';
  END IF;

  RETURN QUERY
  SELECT d.id, d.expo_ticket_id
  FROM public.push_deliveries d
  WHERE d.status = 'sent'
    AND d.receipt_status IS NULL
    AND d.expo_ticket_id IS NOT NULL
    AND d.sent_at <= now() - interval '15 minutes'
    AND (d.receipt_checked_at IS NULL OR d.receipt_checked_at <= now() - interval '15 minutes')
  ORDER BY d.receipt_checked_at NULLS FIRST, d.sent_at
  LIMIT p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_list_push_receipts_due"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_list_push_receipts_due"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_push_receipts_due"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_list_push_receipts_due"(integer) FROM PUBLIC, "anon", "authenticated";
