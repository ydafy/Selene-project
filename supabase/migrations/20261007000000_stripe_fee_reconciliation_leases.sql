BEGIN;

ALTER TABLE public.stripe_fee_reconciliation_jobs
  ADD COLUMN claim_token UUID,
  ADD COLUMN claim_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.stripe_fee_reconciliation_jobs.claim_token IS
  'Opaque active ownership; retained on success solely for same-token completion replay.';
COMMENT ON COLUMN public.stripe_fee_reconciliation_jobs.claim_expires_at IS
  'Database-clock active lease expiry; NULL after success, retry, or failure.';

CREATE INDEX stripe_fee_reconciliation_jobs_processing_lease_idx
  ON public.stripe_fee_reconciliation_jobs (claim_expires_at, updated_at, id)
  WHERE status = 'processing';

CREATE FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs_leased(
  p_limit INTEGER DEFAULT 25,
  p_max_attempts INTEGER DEFAULT 3
)
RETURNS SETOF public.stripe_fee_reconciliation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.stripe_fee_reconciliation_jobs;
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
    FROM public.stripe_fee_reconciliation_jobs AS job
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
      UPDATE public.stripe_fee_reconciliation_jobs
      SET status = 'failed', claim_token = NULL, claim_expires_at = NULL,
          next_retry_at = NULL, last_error = 'STRIPE_FEE_ATTEMPTS_EXHAUSTED',
          updated_at = clock_timestamp()
      WHERE id = v_job.id;
    ELSE
      UPDATE public.stripe_fee_reconciliation_jobs
      SET status = 'processing', attempt_count = attempt_count + 1,
          claim_token = gen_random_uuid(),
          claim_expires_at = clock_timestamp() + INTERVAL '5 minutes',
          next_retry_at = NULL, updated_at = clock_timestamp()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
      RETURN NEXT v_job;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.fn_transition_stripe_fee_reconciliation_job_leased(
  p_job_id UUID,
  p_claim_token UUID,
  p_outcome TEXT,
  p_next_retry_at TIMESTAMPTZ DEFAULT NULL,
  p_last_error TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.stripe_fee_reconciliation_jobs;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL OR p_job_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('retry', 'failed')
     OR (p_outcome = 'retry' AND p_next_retry_at IS NULL)
     OR (p_outcome = 'failed' AND p_next_retry_at IS NOT NULL)
     OR p_last_error IS NULL OR btrim(p_last_error) = ''
     OR char_length(p_last_error) > 4000 THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.stripe_fee_reconciliation_jobs
  WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  -- clock_timestamp is evaluated AFTER acquiring the lock, not at transaction start.
  IF v_job.status <> 'processing'
     OR v_job.claim_token IS DISTINCT FROM p_claim_token
     OR v_job.claim_expires_at IS NULL
     OR v_job.claim_expires_at <= clock_timestamp() THEN
    RETURN FALSE;
  END IF;

  UPDATE public.stripe_fee_reconciliation_jobs
  SET status = CASE p_outcome WHEN 'retry' THEN 'pending' ELSE 'failed' END,
      next_retry_at = p_next_retry_at, last_error = p_last_error,
      claim_token = NULL, claim_expires_at = NULL, updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.fn_complete_stripe_fee_reconciliation_job_leased(
  p_job_id UUID,
  p_claim_token UUID,
  p_actual_stripe_fee_cents BIGINT,
  p_reconciled_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- Preserve deployed signatures while refusing workers without ownership evidence.
CREATE OR REPLACE FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs(p_limit INTEGER DEFAULT 25)
RETURNS SETOF public.stripe_fee_reconciliation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'STRIPE_FEE_LEASE_REQUIRED' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_transition_stripe_fee_reconciliation_job(
  p_job_id UUID, p_outcome TEXT, p_next_retry_at TIMESTAMPTZ DEFAULT NULL, p_last_error TEXT DEFAULT NULL
)
RETURNS public.stripe_fee_reconciliation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'STRIPE_FEE_LEASE_REQUIRED' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_complete_stripe_fee_reconciliation_job(
  p_job_id UUID, p_actual_stripe_fee_cents BIGINT, p_reconciled_at TIMESTAMPTZ
)
RETURNS public.stripe_fee_reconciliation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'STRIPE_FEE_LEASE_REQUIRED' USING ERRCODE = 'P0001';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs_leased(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs_leased(INTEGER, INTEGER) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_transition_stripe_fee_reconciliation_job_leased(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_transition_stripe_fee_reconciliation_job_leased(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_complete_stripe_fee_reconciliation_job_leased(UUID, UUID, BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_complete_stripe_fee_reconciliation_job_leased(UUID, UUID, BIGINT, TIMESTAMPTZ) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs(INTEGER) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_transition_stripe_fee_reconciliation_job(UUID, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_transition_stripe_fee_reconciliation_job(UUID, TEXT, TIMESTAMPTZ, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_complete_stripe_fee_reconciliation_job(UUID, BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_complete_stripe_fee_reconciliation_job(UUID, BIGINT, TIMESTAMPTZ) TO service_role;

COMMIT;
