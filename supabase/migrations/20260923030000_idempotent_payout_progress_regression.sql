-- Accept healthy same-payout in-transit replay of pending without regressing the stage.
-- Apply after 20260923020000_guard_payout_stage_conflict_park.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_project_payout_run_stage(
  p_run_id UUID,
  p_payout_id TEXT,
  p_target_stage TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage TEXT;
  v_status TEXT;
  v_payout_id TEXT;
  v_paid_at TIMESTAMPTZ;
  v_claim_token TEXT;
  v_claim_expires_at TIMESTAMPTZ;
  v_updated BOOLEAN;
BEGIN
  IF p_target_stage NOT IN ('payout_pending', 'payout_in_transit') THEN
    RAISE EXCEPTION 'UNSUPPORTED_PROGRESS_STAGE';
  END IF;

  -- Serialize classification with terminal projection on the run row.
  SELECT cpr.release_stage, cpr.status, cpr.stripe_payout_id,
         cpr.paid_at, cpr.payout_claim_token, cpr.payout_claim_expires_at
    INTO v_stage, v_status, v_payout_id, v_paid_at,
         v_claim_token, v_claim_expires_at
    FROM public.connect_payout_runs cpr
    WHERE cpr.id = p_run_id AND cpr.stripe_payout_id = p_payout_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_status = 'paid' THEN
    IF v_payout_id IS DISTINCT FROM p_payout_id
      OR v_stage IS DISTINCT FROM 'paid_observed'
      OR v_paid_at IS NULL
      OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        LEFT JOIN public.shipments s ON s.id = m.shipment_id
        WHERE m.run_id = p_run_id
          AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'paid'
            OR s.id IS NULL OR s.stripe_payout_id IS DISTINCT FROM v_payout_id)
      ) THEN
      RETURN FALSE;
    END IF;
    -- No writes: neither the stage version nor the paid evidence changes.
    RETURN TRUE;
  END IF;

  -- A delayed or duplicate created event cannot regress healthy in-transit progress.
  -- Leave genuine action-required and claimed states to the guarded park decision.
  IF v_status = 'pending_reconciliation'
    AND v_stage = 'payout_in_transit'
    AND p_target_stage = 'payout_pending'
    AND v_claim_token IS NULL AND v_claim_expires_at IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Preserve the existing idempotent target-stage behavior for pre-terminal
  -- runs; never classify a terminal failure or an incomplete paid run here.
  IF v_status IN ('pending_reconciliation', 'reconciliation_needed')
    AND v_stage = p_target_stage THEN
    RETURN TRUE;
  END IF;

  UPDATE public.connect_payout_runs
  SET release_stage = p_target_stage,
      release_stage_version = release_stage_version + 1,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      AND stripe_payout_id = p_payout_id
      AND release_stage IS NOT DISTINCT FROM v_stage
      AND status IN ('pending_reconciliation', 'reconciliation_needed')
      AND (
        (p_target_stage = 'payout_pending'
          AND (release_stage IS NULL OR release_stage = 'payout_create_in_progress'))
        OR (p_target_stage = 'payout_in_transit'
          AND (release_stage IS NULL OR release_stage IN (
            'payout_create_in_progress', 'payout_pending')))
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_project_payout_run_stage IS
  'Projects signed pre-terminal progress monotonically; healthy in-transit replay of pending and late progress on a complete same-payout observed paid run are side-effect-free TRUE, while incomplete or mismatched projections remain refusals. Server-only.';

REVOKE EXECUTE ON FUNCTION public.fn_project_payout_run_stage FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_project_payout_run_stage FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_project_payout_run_stage TO service_role;

COMMIT;
