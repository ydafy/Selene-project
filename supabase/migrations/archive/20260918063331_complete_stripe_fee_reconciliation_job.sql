BEGIN;

CREATE OR REPLACE FUNCTION public.fn_complete_stripe_fee_reconciliation_job(
  p_job_id UUID,
  p_actual_stripe_fee_cents BIGINT,
  p_reconciled_at TIMESTAMPTZ
)
RETURNS public.stripe_fee_reconciliation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_job public.stripe_fee_reconciliation_jobs;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF p_actual_stripe_fee_cents IS NULL OR p_actual_stripe_fee_cents < 0 THEN
    RAISE EXCEPTION 'INVALID_STRIPE_FEE' USING ERRCODE = '22023';
  END IF;

  IF p_reconciled_at IS NULL THEN
    RAISE EXCEPTION 'RECONCILED_AT_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT job.order_id
    INTO v_order_id
  FROM public.stripe_fee_reconciliation_jobs AS job
  WHERE job.id = p_job_id
    AND job.status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
  SET actual_stripe_fee_cents = p_actual_stripe_fee_cents,
      stripe_fee_reconciled_at = p_reconciled_at,
      updated_at = now()
  WHERE id = v_order_id
    AND actual_stripe_fee_cents IS NULL;

  UPDATE public.stripe_fee_reconciliation_jobs AS job
  SET status = 'succeeded',
      next_retry_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE job.id = p_job_id
    AND job.status = 'processing'
  RETURNING job.* INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_job;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_complete_stripe_fee_reconciliation_job(UUID, BIGINT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_complete_stripe_fee_reconciliation_job(UUID, BIGINT, TIMESTAMPTZ)
  TO service_role;

COMMIT;
