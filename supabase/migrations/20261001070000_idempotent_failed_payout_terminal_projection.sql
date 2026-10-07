-- Additive terminal override; no historical run repair or money movement.
BEGIN;
CREATE OR REPLACE FUNCTION public.fn_project_payout_run_terminal(
  p_run_id UUID,
  p_payout_id TEXT,
  p_target_status TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_stage TEXT;
  v_paid_at TIMESTAMPTZ;
  v_failed_at TIMESTAMPTZ;
  v_claim_token TEXT;
  v_claim_expires_at TIMESTAMPTZ;
  v_updated BOOLEAN;
  v_conflicting_shipment_id TEXT;
BEGIN
  IF p_target_status NOT IN ('paid', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'UNSUPPORTED_TERMINAL_STATUS';
  END IF;
  IF p_payout_id IS NULL OR btrim(p_payout_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_PAYOUT_ID';
  END IF;

  SELECT cpr.status, cpr.release_stage, cpr.paid_at, cpr.failed_at,
         cpr.payout_claim_token, cpr.payout_claim_expires_at
    INTO v_status, v_stage, v_paid_at, v_failed_at, v_claim_token, v_claim_expires_at
    FROM public.connect_payout_runs cpr
    WHERE cpr.id = p_run_id AND cpr.stripe_payout_id = p_payout_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Only an entirely projected paid run is equivalent. The run lock serializes
  -- competing terminal writers; mapped rows are checked before any no-op.
  IF v_status = 'paid' AND p_target_status = 'paid' THEN
    IF v_stage IS DISTINCT FROM 'paid_observed' OR v_paid_at IS NULL
      OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        LEFT JOIN public.shipments s ON s.id = m.shipment_id
        WHERE m.run_id = p_run_id
          AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'paid'
            OR s.id IS NULL OR s.stripe_payout_id IS DISTINCT FROM p_payout_id)
      ) THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  -- Complete failed replays preserve the original projection without writes.
  -- A retry child's payout marking is not this parent's to clear or replace.
  IF v_status = 'failed' AND p_target_status = 'failed' THEN
    IF v_stage IS DISTINCT FROM 'payout_failed' OR v_failed_at IS NULL
      OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        LEFT JOIN public.shipments s ON s.id = m.shipment_id
        WHERE m.run_id = p_run_id
          AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'failed'
            OR s.id IS NULL OR s.stripe_payout_id IS NOT NULL)
      ) THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  -- The webhook may have read a pre-paid snapshot before this lock. Refuse
  -- older or undated failure evidence against the locked paid timestamp;
  -- FALSE follows the existing conflict/park path, not a silent no-op.
  IF v_status = 'paid' AND p_target_status = 'failed' THEN
    IF v_paid_at IS NULL OR p_occurred_at IS NULL
      OR p_occurred_at < v_paid_at THEN
      RETURN FALSE;
    END IF;
  END IF;

  UPDATE public.connect_payout_runs
  SET release_stage = CASE
        WHEN p_target_status = 'paid' THEN 'paid_observed'
        WHEN p_target_status = 'failed' THEN 'payout_failed'
        ELSE 'payout_canceled' END,
      release_stage_version = release_stage_version + 1,
      status = p_target_status,
      paid_at = CASE
        WHEN p_target_status = 'paid' AND (paid_at IS NULL OR p_occurred_at > paid_at)
          THEN p_occurred_at ELSE paid_at END,
      failed_at = CASE WHEN p_target_status IN ('failed', 'canceled')
        THEN p_occurred_at ELSE failed_at END,
      failure_reason = CASE WHEN p_target_status IN ('failed', 'canceled')
        AND p_failure_reason IS NOT NULL THEN p_failure_reason ELSE failure_reason END,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
  WHERE id = p_run_id AND stripe_payout_id = p_payout_id
    AND NOT (p_target_status = 'paid' AND status IN ('failed', 'canceled'))
    AND (status NOT IN ('paid', 'failed', 'canceled')
      OR (status = 'paid' AND p_target_status = 'failed'))
  RETURNING TRUE INTO v_updated;
  IF NOT COALESCE(v_updated, FALSE) THEN
    RETURN FALSE;
  END IF;

  IF p_target_status = 'paid' THEN
    UPDATE public.connect_payout_run_shipments
    SET status = 'paid', updated_at = now()
    WHERE run_id = p_run_id AND status IN ('pending_reconciliation');
  ELSE
    UPDATE public.connect_payout_run_shipments
    SET status = p_target_status, updated_at = now()
    WHERE run_id = p_run_id AND status IN ('pending_reconciliation', 'paid');
  END IF;

  IF p_target_status = 'paid' THEN
    IF NOT EXISTS (SELECT 1 FROM public.connect_payout_run_shipments m
      WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL) THEN
      RAISE EXCEPTION 'PAYOUT_RUN_HAS_NO_SHIPMENTS';
    END IF;
    -- Reject every incomplete mapping after the conditional mapping write.
    -- An exception rolls the run, mappings, and shipment writes back together.
    IF EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      LEFT JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = p_run_id
        AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'paid'
          OR s.id IS NULL)
    ) THEN
      RAISE EXCEPTION 'PAYOUT_MAPPING_INCOMPLETE';
    END IF;
    UPDATE public.shipments
    SET stripe_payout_id = p_payout_id, updated_at = now()
    WHERE id IN (SELECT m.shipment_id FROM public.connect_payout_run_shipments m
      WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL)
      AND stripe_payout_id IS NULL;
    SELECT s.id INTO v_conflicting_shipment_id
    FROM public.connect_payout_run_shipments m
    JOIN public.shipments s ON s.id = m.shipment_id
    WHERE m.run_id = p_run_id AND s.stripe_payout_id IS NOT NULL
      AND s.stripe_payout_id <> p_payout_id LIMIT 1;
    IF v_conflicting_shipment_id IS NOT NULL THEN
      RAISE EXCEPTION 'SHIPMENT_ALREADY_RELEASED:%', v_conflicting_shipment_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      LEFT JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = p_run_id
        AND (m.status IS DISTINCT FROM 'paid' OR s.id IS NULL
          OR s.stripe_payout_id IS DISTINCT FROM p_payout_id)
    ) THEN
      RAISE EXCEPTION 'PAYOUT_MAPPING_INCOMPLETE';
    END IF;
  ELSE
    UPDATE public.shipments
    SET stripe_payout_id = NULL, updated_at = now()
    WHERE id IN (SELECT m.shipment_id FROM public.connect_payout_run_shipments m
      WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL)
      AND stripe_payout_id = p_payout_id;
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_project_payout_run_terminal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_project_payout_run_terminal FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_project_payout_run_terminal TO service_role;
COMMIT;
