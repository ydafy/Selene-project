CREATE OR REPLACE FUNCTION public.fn_enqueue_stripe_fee_reconciliation_job (
  p_order_id                 uuid,
  p_stripe_payment_intent_id text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO internal.stripe_fee_reconciliation_jobs AS j (
    order_id, stripe_payment_intent_id, status, attempt_count, next_retry_at, last_error, updated_at
  )
  VALUES (p_order_id, p_stripe_payment_intent_id, 'pending', 0, now(), NULL, now())
  ON CONFLICT (order_id, stripe_payment_intent_id) DO NOTHING
  RETURNING j.id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) IS 'Service-only (SECURITY DEFINER): queues a pending Stripe fee reconciliation job for an order and payment intent, due now. Returns true when it inserted the job and false when one already exists for the pair, which it leaves unchanged.';

REVOKE ALL ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) FROM PUBLIC, "anon", "authenticated";
