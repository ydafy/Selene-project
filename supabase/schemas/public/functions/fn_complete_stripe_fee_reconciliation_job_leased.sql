CREATE OR REPLACE FUNCTION public.fn_complete_stripe_fee_reconciliation_job_leased (
  p_job_id                  uuid,
  p_claim_token             uuid,
  p_actual_stripe_fee_cents bigint,
  p_reconciled_at           timestamp with time zone
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_job public.stripe_fee_reconciliation_jobs;
  v_payment_intent_id TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL OR p_job_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF p_actual_stripe_fee_cents IS NULL OR p_actual_stripe_fee_cents < 0
     OR p_reconciled_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_COMPLETION' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.stripe_fee_reconciliation_jobs
  WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF v_job.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN FALSE;
  END IF;
  -- Successful ownership evidence is retained; a duplicate performs no writes.
  IF v_job.status = 'succeeded' THEN
    RETURN TRUE;
  END IF;
  IF v_job.status <> 'processing' THEN
    RETURN FALSE;
  END IF;

  SELECT stripe_payment_intent_id INTO v_payment_intent_id
  FROM public.orders WHERE id = v_job.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_payment_intent_id IS DISTINCT FROM v_job.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'ORDER_PAYMENT_INTENT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  -- Recheck after BOTH locks: waiting for the order must not extend an expired lease.
  IF v_job.claim_expires_at IS NULL
     OR v_job.claim_expires_at <= clock_timestamp() THEN
    RETURN FALSE;
  END IF;

  UPDATE public.orders
  SET actual_stripe_fee_cents = p_actual_stripe_fee_cents,
      stripe_fee_reconciled_at = p_reconciled_at, updated_at = clock_timestamp()
  WHERE id = v_job.order_id AND actual_stripe_fee_cents IS NULL;

  UPDATE public.stripe_fee_reconciliation_jobs
  SET status = 'succeeded', next_retry_at = NULL, last_error = NULL,
      claim_expires_at = NULL, updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job_leased"(uuid, uuid, bigint, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job_leased"(uuid, uuid, bigint, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job_leased"(uuid, uuid, bigint, timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job_leased"(uuid, uuid, bigint, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";
