BEGIN;

CREATE OR REPLACE FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs(
  p_limit INTEGER DEFAULT 25
)
RETURNS SETOF public.stripe_fee_reconciliation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL THEN
    RAISE EXCEPTION 'INVALID_LIMIT' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due_jobs AS (
    SELECT job.id
    FROM public.stripe_fee_reconciliation_jobs AS job
    WHERE job.status = 'pending'
      AND (job.next_retry_at IS NULL OR job.next_retry_at <= now())
      AND job.attempt_count < 100
    ORDER BY job.next_retry_at NULLS FIRST, job.created_at, job.id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  )
  UPDATE public.stripe_fee_reconciliation_jobs AS job
  SET status = 'processing',
      attempt_count = job.attempt_count + 1,
      next_retry_at = NULL,
      updated_at = now()
  FROM due_jobs
  WHERE job.id = due_jobs.id
  RETURNING job.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_transition_stripe_fee_reconciliation_job(
  p_job_id UUID,
  p_outcome TEXT,
  p_next_retry_at TIMESTAMPTZ DEFAULT NULL,
  p_last_error TEXT DEFAULT NULL
)
RETURNS public.stripe_fee_reconciliation_jobs
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

  IF p_outcome IS NULL
     OR p_outcome NOT IN ('succeeded', 'retry', 'failed') THEN
    RAISE EXCEPTION 'INVALID_OUTCOME' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'retry' AND p_next_retry_at IS NULL THEN
    RAISE EXCEPTION 'RETRY_AT_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_outcome IN ('succeeded', 'failed') AND p_next_retry_at IS NOT NULL THEN
    RAISE EXCEPTION 'RETRY_AT_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;

  IF p_outcome IN ('retry', 'failed')
     AND (p_last_error IS NULL OR btrim(p_last_error) = '') THEN
    RAISE EXCEPTION 'LAST_ERROR_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'succeeded' AND p_last_error IS NOT NULL THEN
    RAISE EXCEPTION 'LAST_ERROR_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.stripe_fee_reconciliation_jobs
  SET status = CASE p_outcome
        WHEN 'succeeded' THEN 'succeeded'
        WHEN 'retry' THEN 'pending'
        WHEN 'failed' THEN 'failed'
      END,
      next_retry_at = CASE
        WHEN p_outcome = 'retry' THEN p_next_retry_at
        ELSE NULL
      END,
      last_error = CASE
        WHEN p_outcome = 'succeeded' THEN NULL
        ELSE p_last_error
      END,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_job;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs(INTEGER)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_transition_stripe_fee_reconciliation_job(UUID, TEXT, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_transition_stripe_fee_reconciliation_job(UUID, TEXT, TIMESTAMPTZ, TEXT)
  TO service_role;

COMMIT;
