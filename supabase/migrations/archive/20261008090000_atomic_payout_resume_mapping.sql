-- Atomic manual pre-payout resume/park. No provider calls or money changes.
-- Apply this forward migration before deploying the matching release endpoint.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_atomic_payout_resume_mapping(
  p_run_id UUID,
  p_mode TEXT,
  p_expected_status TEXT,
  p_expected_stage TEXT,
  p_expected_version INTEGER,
  p_shipment_ids UUID[],
  p_parent_run_id UUID,
  p_expected_parent_version INTEGER,
  p_expected_parent_payout_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_parent public.connect_payout_runs%ROWTYPE;
  v_count INTEGER;
  v_unique INTEGER;
  v_amount BIGINT;
  v_version INTEGER;
BEGIN
  -- NULL must refuse explicitly, never fall through SQL UNKNOWN comparisons.
  IF p_run_id IS NULL OR p_mode IS NULL OR p_mode NOT IN ('retry', 'pending')
    OR p_expected_status IS NULL OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_shipment_ids IS NULL OR cardinality(p_shipment_ids) < 1
    OR array_position(p_shipment_ids, NULL) IS NOT NULL
    OR cardinality(p_shipment_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_shipment_ids) x)
  THEN RETURN NULL; END IF;

  -- Lock the audit parent first, then its child, consistently with retry authority.
  IF p_parent_run_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.connect_payout_runs
      WHERE id = p_parent_run_id FOR UPDATE;
    IF NOT FOUND OR p_expected_parent_version IS NULL OR p_expected_parent_payout_id IS NULL
      OR v_parent.release_stage_version IS DISTINCT FROM p_expected_parent_version
      OR v_parent.stripe_payout_id IS DISTINCT FROM p_expected_parent_payout_id
      OR v_parent.status <> 'failed' OR v_parent.stripe_payout_id IS NULL
      OR v_parent.release_stage IS DISTINCT FROM 'payout_failed'
      OR v_parent.payout_claim_token IS NOT NULL OR v_parent.payout_claim_expires_at IS NOT NULL
    THEN RETURN NULL; END IF;
  ELSIF p_expected_parent_version IS NOT NULL OR p_expected_parent_payout_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_run.status IS DISTINCT FROM p_expected_status
    OR v_run.release_stage IS DISTINCT FROM p_expected_stage
    OR v_run.release_stage_version IS DISTINCT FROM p_expected_version
    OR v_run.retry_of_run_id IS DISTINCT FROM p_parent_run_id
    OR v_run.stripe_payout_id IS NOT NULL
    OR v_run.payout_claim_token IS NOT NULL OR v_run.payout_claim_expires_at IS NOT NULL
    OR v_run.payout_create_attempted_at IS NOT NULL OR v_run.paid_at IS NOT NULL
    OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id)
  THEN RETURN NULL; END IF;

  -- Only supported pre-payout states. A failed legacy run without a provider
  -- attempt may resume with the same key; provider-terminal failures cannot.
  IF v_run.status = 'pending_reconciliation' THEN
    IF v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted', 'awaiting_connected_balance')
      OR v_run.failed_at IS NOT NULL OR v_run.failure_reason IS NOT NULL
    THEN RETURN NULL; END IF;
  ELSIF p_mode = 'retry' AND v_run.status = 'failed' AND p_parent_run_id IS NULL THEN
    IF v_run.release_stage IS NOT NULL AND v_run.release_stage <> 'payout_failed'
    THEN RETURN NULL; END IF;
  ELSE RETURN NULL;
  END IF;

  -- Child identity and complete mapping set must agree with immutable failed
  -- parent history. No parent row or parent mapping is ever updated here.
  IF p_parent_run_id IS NOT NULL THEN
    IF v_parent.seller_id <> v_run.seller_id OR v_parent.amount <> v_run.amount
      OR v_run.id = v_parent.id
      OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_parent.id AND id <> v_run.id)
    THEN RETURN NULL; END IF;
    PERFORM 1 FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id ORDER BY shipment_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id AND status <> 'failed')
      OR EXISTS (
        (SELECT shipment_id, net_payout FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id
         EXCEPT SELECT shipment_id, net_payout FROM public.connect_payout_run_shipments WHERE run_id = v_run.id)
        UNION ALL
        (SELECT shipment_id, net_payout FROM public.connect_payout_run_shipments WHERE run_id = v_run.id
         EXCEPT SELECT shipment_id, net_payout FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id)
      )
    THEN RETURN NULL; END IF;
  END IF;

  -- Lock every target mapping and its shipments. The existing active-once
  -- unique index also rejects concurrent foreign activation atomically.
  PERFORM 1 FROM public.connect_payout_run_shipments WHERE run_id = v_run.id ORDER BY shipment_id FOR UPDATE;
  PERFORM 1 FROM public.shipments WHERE id = ANY(p_shipment_ids) ORDER BY id FOR UPDATE;
  SELECT count(*), count(DISTINCT shipment_id), sum(net_payout)
    INTO v_count, v_unique, v_amount
    FROM public.connect_payout_run_shipments WHERE run_id = v_run.id;
  IF v_count <> cardinality(p_shipment_ids) OR v_unique <> v_count
    OR v_amount IS DISTINCT FROM v_run.amount::BIGINT
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments m
      JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = v_run.id AND (
        NOT (m.shipment_id = ANY(p_shipment_ids)) OR m.status <> v_run.status
        OR m.net_payout <= 0 OR s.seller_id <> v_run.seller_id
        OR s.status <> 'completed' OR s.completed_at IS NULL
        OR (p_mode = 'pending' AND s.stripe_transfer_id IS NULL)))
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
      WHERE shipment_id = ANY(p_shipment_ids) AND run_id <> v_run.id
        AND status IN ('pending_reconciliation', 'paid', 'reconciliation_needed'))
  THEN RETURN NULL; END IF;

  UPDATE public.connect_payout_runs
    SET status = 'pending_reconciliation', release_stage = 'awaiting_connected_balance',
        release_stage_version = release_stage_version + 1,
        failure_reason = NULL, failed_at = NULL, updated_at = now()
    WHERE id = v_run.id
    RETURNING release_stage_version INTO v_version;
  UPDATE public.connect_payout_run_shipments
    SET status = 'pending_reconciliation', updated_at = now()
    WHERE run_id = v_run.id;
  -- Exceptions (including active-once conflicts) roll back BOTH writes.
  RETURN v_version;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_atomic_payout_resume_mapping(UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_atomic_payout_resume_mapping(UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], UUID, INTEGER, TEXT) TO service_role;
COMMIT;
