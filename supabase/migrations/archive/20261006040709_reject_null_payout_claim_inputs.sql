-- Fail closed for NULL caller claim inputs; preserve valid-claim behavior.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_begin_payout_create_fence(
  p_run_id UUID,
  p_claim_token TEXT,
  p_expected_stage_version INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version INTEGER;
  v_token TEXT;
  v_stage TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token,
         cpr.payout_claim_expires_at
  INTO v_stage, v_version, v_token, v_expires
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  IF p_claim_token IS NULL OR v_token IS NULL OR v_token <> p_claim_token THEN
    RAISE EXCEPTION 'STALE_CLAIM';
  END IF;

  -- A lapsed lease means the worker lost durable ownership: it must abort
  -- without opening the fence, and the Stripe create must never run.
  IF v_expires IS NULL OR v_expires <= now() THEN
    RAISE EXCEPTION 'CLAIM_LEASE_EXPIRED';
  END IF;

  IF p_expected_stage_version IS NULL OR v_version <> p_expected_stage_version THEN
    RAISE EXCEPTION 'STAGE_VERSION_CONFLICT';
  END IF;

  IF v_stage <> 'awaiting_connected_balance' THEN
    RAISE EXCEPTION 'PAYOUT_CREATE_FENCE_CONFLICT';
  END IF;

  UPDATE public.connect_payout_runs
  SET release_stage = 'payout_create_in_progress',
      release_stage_version = v_version + 1,
      payout_create_attempted_at = now(),
      updated_at = now()
    WHERE id = p_run_id;

  RETURN v_version + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_verify_payout_claim(
  p_run_id UUID,
  p_claim_token TEXT,
  p_expected_stage_version INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_expires TIMESTAMPTZ;
  v_version INTEGER;
BEGIN
  SELECT cpr.payout_claim_token,
         cpr.payout_claim_expires_at,
         cpr.release_stage_version
  INTO v_token, v_expires, v_version
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  IF p_claim_token IS NULL OR v_token IS NULL OR v_token <> p_claim_token THEN
    RAISE EXCEPTION 'STALE_CLAIM';
  END IF;

  IF v_expires IS NULL OR v_expires <= now() THEN
    RAISE EXCEPTION 'CLAIM_LEASE_EXPIRED';
  END IF;

  IF p_expected_stage_version IS NULL OR v_version <> p_expected_stage_version THEN
    RAISE EXCEPTION 'STAGE_VERSION_CONFLICT';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_begin_payout_create_fence(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_begin_payout_create_fence(UUID, TEXT, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_begin_payout_create_fence(UUID, TEXT, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_verify_payout_claim(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_verify_payout_claim(UUID, TEXT, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_verify_payout_claim(UUID, TEXT, INTEGER) TO service_role;

COMMIT;
