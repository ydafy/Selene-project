-- Decide a refused progress projection under the same run lock as terminal writes.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_decide_rejected_payout_stage_park(
  p_run_id UUID,
  p_payout_id TEXT,
  p_target_stage TEXT,
  p_failure_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_stage TEXT;
  v_payout_id TEXT;
  v_paid_at TIMESTAMPTZ;
  v_claim_token TEXT;
  v_claim_expires_at TIMESTAMPTZ;
  v_version INTEGER;
  v_reason TEXT;
BEGIN
  IF p_target_stage NOT IN ('payout_pending', 'payout_in_transit') THEN
    RAISE EXCEPTION 'UNSUPPORTED_PROGRESS_STAGE';
  END IF;
  IF p_payout_id IS NULL OR btrim(p_payout_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_PAYOUT_ID';
  END IF;

  SELECT cpr.status, cpr.release_stage, cpr.stripe_payout_id,
         cpr.paid_at, cpr.payout_claim_token, cpr.payout_claim_expires_at,
         cpr.release_stage_version, cpr.failure_reason
    INTO v_status, v_stage, v_payout_id, v_paid_at, v_claim_token,
         v_claim_expires_at, v_version, v_reason
    FROM public.connect_payout_runs cpr
    WHERE cpr.id = p_run_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'identity_conflict';
  END IF;

  IF v_status = 'paid' AND v_stage = 'paid_observed'
    AND v_payout_id = p_payout_id AND v_paid_at IS NOT NULL
    AND v_claim_token IS NULL AND v_claim_expires_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      LEFT JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = p_run_id
        AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'paid'
          OR s.id IS NULL OR s.stripe_payout_id IS DISTINCT FROM p_payout_id)
    ) THEN
    RETURN 'superseded_paid';
  END IF;

  -- Preserve the payout identity while durably flagging a genuine mismatch.
  IF v_payout_id IS DISTINCT FROM p_payout_id THEN
    IF v_status IS DISTINCT FROM 'reconciliation_needed'
      OR v_stage IS DISTINCT FROM 'action_required'
      OR v_reason IS DISTINCT FROM 'PAYOUT_STAGE_PAYOUT_ID_MISMATCH'
      OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL THEN
      UPDATE public.connect_payout_runs
      SET status = 'reconciliation_needed',
          release_stage = 'action_required',
          release_stage_version = v_version + 1,
          failure_reason = 'PAYOUT_STAGE_PAYOUT_ID_MISMATCH',
          payout_claim_token = NULL,
          payout_claim_expires_at = NULL,
          updated_at = now()
      WHERE id = p_run_id AND release_stage_version = v_version;
    END IF;
    RETURN 'identity_conflict';
  END IF;

  -- Keep the first park's reason on exact repeat; a changed reason is a new
  -- decision and consumes the monotonic stage version.
  IF v_status IS DISTINCT FROM 'reconciliation_needed'
    OR v_stage IS DISTINCT FROM 'action_required'
    OR v_reason IS DISTINCT FROM COALESCE(p_failure_reason, v_reason)
    OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL THEN
    UPDATE public.connect_payout_runs
    SET status = 'reconciliation_needed',
        release_stage = 'action_required',
        release_stage_version = v_version + 1,
        failure_reason = COALESCE(p_failure_reason, failure_reason),
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
    WHERE id = p_run_id AND release_stage_version = v_version;
  END IF;
  RETURN 'parked';
END;
$$;

COMMENT ON FUNCTION public.fn_decide_rejected_payout_stage_park IS
  'Locked stage-conflict decision: complete same-payout paid is evidence-only; mismatched identity parks without changing payout id, every other refusal parks atomically without erasing terminal timestamps. Server-only.';
REVOKE EXECUTE ON FUNCTION public.fn_decide_rejected_payout_stage_park FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_decide_rejected_payout_stage_park FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_decide_rejected_payout_stage_park TO service_role;

COMMIT;
