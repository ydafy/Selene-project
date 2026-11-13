CREATE OR REPLACE FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs_leased (
  p_limit        integer DEFAULT 25,
  p_max_attempts integer DEFAULT 3
)
  RETURNS TABLE (
    id                       uuid,
    order_id                 uuid,
    stripe_payment_intent_id text,
    status                   text,
    attempt_count            integer,
    next_retry_at            timestamp with time zone,
    last_error               text,
    created_at               timestamp with time zone,
    updated_at               timestamp with time zone,
    claim_token              uuid,
    claim_expires_at         timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_job internal.stripe_fee_reconciliation_jobs;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 100 THEN
    RAISE EXCEPTION 'INVALID_CLAIM_POLICY' USING ERRCODE = '22023';
  END IF;

  -- Every examined row, including exhausted rows, belongs to this bounded batch.
  FOR v_job IN
    SELECT job.*
    FROM internal.stripe_fee_reconciliation_jobs AS job
    WHERE (job.status = 'pending'
           AND (job.next_retry_at IS NULL OR job.next_retry_at <= clock_timestamp()))
       OR (job.status = 'processing'
           AND (job.claim_expires_at <= clock_timestamp()
                OR (job.claim_token IS NULL AND job.claim_expires_at IS NULL
                    AND job.updated_at <= clock_timestamp() - INTERVAL '5 minutes')))
    ORDER BY job.next_retry_at NULLS FIRST, job.created_at, job.id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  LOOP
    IF v_job.attempt_count >= p_max_attempts THEN
      UPDATE internal.stripe_fee_reconciliation_jobs AS job
      SET status = 'failed', claim_token = NULL, claim_expires_at = NULL,
          next_retry_at = NULL, last_error = 'STRIPE_FEE_ATTEMPTS_EXHAUSTED',
          updated_at = clock_timestamp()
      WHERE job.id = v_job.id;
    ELSE
      -- The output columns share the table's column names, so every column
      -- reference names its table alias.
      UPDATE internal.stripe_fee_reconciliation_jobs AS job
      SET status = 'processing', attempt_count = job.attempt_count + 1,
          claim_token = gen_random_uuid(),
          claim_expires_at = clock_timestamp() + INTERVAL '5 minutes',
          next_retry_at = NULL, updated_at = clock_timestamp()
      WHERE job.id = v_job.id
      RETURNING job.* INTO v_job;
      RETURN QUERY SELECT v_job.id, v_job.order_id, v_job.stripe_payment_intent_id,
        v_job.status, v_job.attempt_count, v_job.next_retry_at, v_job.last_error,
        v_job.created_at, v_job.updated_at, v_job.claim_token, v_job.claim_expires_at;
    END IF;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"(integer, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"(integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"(integer, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"(integer, integer) FROM PUBLIC, "anon", "authenticated";
