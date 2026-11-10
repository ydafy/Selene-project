CREATE OR REPLACE FUNCTION public.fn_reconcile_connect_payments()
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

GRANT EXECUTE ON FUNCTION "public"."fn_reconcile_connect_payments"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_reconcile_connect_payments"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_reconcile_connect_payments"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_reconcile_connect_payments"() FROM PUBLIC, "anon", "authenticated";
