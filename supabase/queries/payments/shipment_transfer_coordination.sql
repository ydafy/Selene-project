-- B1.3-T0 preparation only. Apply this CLI migration OR its identical canonical
-- copy, never both. Requires B1.1/B1.2 cancellation and current payout SQL.
-- No existing Edge caller uses the transfer RPCs until the SQL/type gate.
BEGIN;

-- Extend the existing shipment/run identity; no new workflow or lease table.
-- A possible Transfer survives mapping status changes and run lease expiry.
ALTER TABLE public.connect_payout_run_shipments
  ADD COLUMN transfer_started_at TIMESTAMPTZ,
  ADD COLUMN transfer_token UUID,
  ADD CONSTRAINT connect_payout_run_shipments_transfer_start_pair
    CHECK ((transfer_started_at IS NULL) = (transfer_token IS NULL));
CREATE INDEX idx_connect_payout_run_shipments_transfer_started
  ON public.connect_payout_run_shipments (shipment_id)
  WHERE transfer_started_at IS NOT NULL;
COMMENT ON COLUMN public.connect_payout_run_shipments.transfer_started_at IS
  'Write-ahead possible Stripe Transfer effect. Never cleared by TTL, resume, payout failure or cancellation. An uncertain response requires investigation, never another create.';
COMMENT ON COLUMN public.connect_payout_run_shipments.transfer_token IS
  'Opaque immutable ownership of the shipment Transfer attempt within this existing run mapping; conditional identity completion only, not a reclaimable lease.';

CREATE OR REPLACE FUNCTION public.fn_begin_shipment_transfer(
  p_run_id UUID, p_shipment_id UUID, p_expected_stage_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_mapping public.connect_payout_run_shipments%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_row public.admin_connect_payout_release_view%ROWTYPE;
  v_token UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Match existing resume/terminal lock order: run, mapping, shipment. A
  -- cancellation owns only shipment/operation and reads transfer fences without
  -- locking mappings, so it cannot form a reverse-order lock cycle.
  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT'; END IF;
  IF p_expected_stage_version IS NULL
    OR v_run.release_stage_version IS DISTINCT FROM p_expected_stage_version
    OR v_run.status IS DISTINCT FROM 'pending_reconciliation'
    OR (v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted','awaiting_connected_balance'))
    OR v_run.stripe_payout_id IS NOT NULL
    OR v_run.payout_claim_token IS NOT NULL OR v_run.payout_claim_expires_at IS NOT NULL
    OR v_run.payout_create_attempted_at IS NOT NULL OR v_run.paid_at IS NOT NULL
    OR v_run.failed_at IS NOT NULL OR v_run.failure_reason IS NOT NULL
    OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT';
  END IF;
  SELECT * INTO v_mapping FROM public.connect_payout_run_shipments
    WHERE run_id = p_run_id AND shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT'; END IF;
  IF v_mapping.status IS DISTINCT FROM 'pending_reconciliation' THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT';
  END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  -- Read after the shared shipment lock, with the live clock after lock waits.
  IF EXISTS (SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id
      AND (external_started_at IS NOT NULL OR claim_expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED';
  END IF;
  IF v_shipment.status IS DISTINCT FROM 'completed' OR v_shipment.completed_at IS NULL THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_COMPLETED';
  END IF;

  -- Reuse the canonical allocation/read model, not caller amounts or a second
  -- financial formula. Only this run's own active marker may be tolerated.
  SELECT * INTO v_row FROM public.admin_connect_payout_release_view WHERE shipment_id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_INELIGIBLE'; END IF;
  IF v_shipment.seller_id IS DISTINCT FROM v_run.seller_id
    OR v_row.stripe_account_id IS NULL OR v_row.stripe_onboarding_status IS DISTINCT FROM 'complete'
    OR v_row.stripe_payment_intent_id IS NULL
    OR v_row.release_amount_cents IS NULL OR v_row.release_amount_cents <= 0
    OR v_mapping.net_payout IS DISTINCT FROM v_row.release_amount_cents
    OR v_run.amount::bigint IS DISTINCT FROM
      (SELECT sum(net_payout) FROM public.connect_payout_run_shipments WHERE run_id = p_run_id)
    OR (v_row.is_eligible IS DISTINCT FROM true AND v_row.ineligible_reason IS DISTINCT FROM 'already_released')
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
      WHERE shipment_id = p_shipment_id AND run_id <> p_run_id
        AND status IN ('pending_reconciliation','paid','reconciliation_needed')) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_INELIGIBLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fn_get_connect_account_actionability(v_row.stripe_account_id)
    WHERE is_actionable = true) THEN
    RAISE EXCEPTION 'CONNECT_ACCOUNT_NOT_ACTIONABLE';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_shipment.order_id;
  IF NOT FOUND OR v_order.stripe_charge_id IS NULL OR btrim(v_order.stripe_charge_id) = ''
    OR v_order.stripe_transfer_group IS NULL OR btrim(v_order.stripe_transfer_group) = '' THEN
    RAISE EXCEPTION 'MISSING_SETTLEMENT_CONTEXT';
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.connect_payout_run_shipments
    SET transfer_started_at = clock_timestamp(), transfer_token = v_token
    WHERE id = v_mapping.id;
  -- No run stage/version mutation: preserve the existing resume intent epoch.
  RETURN jsonb_build_object('transfer_token', v_token,
    'amount', v_row.release_amount_cents, 'currency', 'mxn',
    'destination', v_row.stripe_account_id, 'source_transaction', v_order.stripe_charge_id,
    'transfer_group', v_order.stripe_transfer_group,
    'idempotency_key', v_run.idempotency_key || ':' || v_run.id::text || ':' || p_shipment_id::text,
    'metadata', jsonb_build_object('app_name','selene','run_id',v_run.id,
      'shipment_id',p_shipment_id,'seller_id',v_run.seller_id,'order_id',v_order.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_complete_shipment_transfer(
  p_run_id UUID, p_shipment_id UUID, p_expected_stage_version INTEGER,
  p_transfer_token UUID, p_stripe_transfer_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_mapping public.connect_payout_run_shipments%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_stripe_transfer_id IS NULL OR btrim(p_stripe_transfer_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_TRANSFER_ID';
  END IF;
  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_expected_stage_version IS NULL OR v_run.release_stage_version IS DISTINCT FROM p_expected_stage_version
    OR v_run.status IS DISTINCT FROM 'pending_reconciliation'
    OR (v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted','awaiting_connected_balance'))
    OR v_run.stripe_payout_id IS NOT NULL OR v_run.payout_claim_token IS NOT NULL
    OR v_run.payout_claim_expires_at IS NOT NULL OR v_run.payout_create_attempted_at IS NOT NULL
    OR v_run.paid_at IS NOT NULL OR v_run.failed_at IS NOT NULL
    OR v_run.failure_reason IS NOT NULL OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id) THEN
    RETURN false;
  END IF;
  SELECT * INTO v_mapping FROM public.connect_payout_run_shipments
    WHERE run_id = p_run_id AND shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_transfer_token IS NULL OR v_mapping.transfer_token IS DISTINCT FROM p_transfer_token
    OR v_mapping.transfer_started_at IS NULL OR v_mapping.status IS DISTINCT FROM 'pending_reconciliation' THEN
    RETURN false;
  END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_shipment.seller_id IS DISTINCT FROM v_run.seller_id THEN RETURN false; END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL THEN
    RETURN v_shipment.stripe_transfer_id = p_stripe_transfer_id;
  END IF;
  UPDATE public.shipments SET stripe_transfer_id = p_stripe_transfer_id WHERE id = p_shipment_id;
  -- Never clear the possible-effect fence, including on idempotent completion.
  RETURN true;
END;
$$;

-- Forward replacements preserve existing error ordering and all original
-- cancellation ownership/state rules; only the transfer-start guard is added.
CREATE OR REPLACE FUNCTION public.fn_claim_shipment_cancellation(
  p_shipment_id UUID,
  p_order_id UUID,
  p_actor_id UUID,
  p_source TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_buyer_id UUID;
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('buyer', 'seller', 'paid_timeout', 'preparing_timeout')
     OR p_reason IS NULL OR btrim(p_reason) = ''
     OR (p_source IN ('buyer', 'seller') AND p_actor_id IS NULL)
     OR (p_source IN ('paid_timeout', 'preparing_timeout') AND p_actor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_CONTEXT';
  END IF;

  -- Every future participating writer must lock this same shipment first.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  IF v_shipment.order_id IS DISTINCT FROM p_order_id THEN RAISE EXCEPTION 'SHIPMENT_ORDER_MISMATCH'; END IF;
  SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_shipment.order_id;
  IF p_source = 'buyer' AND p_actor_id IS DISTINCT FROM v_buyer_id THEN RAISE EXCEPTION 'ORDER_BUYER_MISMATCH'; END IF;
  IF p_source = 'seller' AND p_actor_id IS DISTINCT FROM v_shipment.seller_id THEN RAISE EXCEPTION 'SHIPMENT_SELLER_MISMATCH'; END IF;

  IF (p_source IN ('buyer', 'seller', 'paid_timeout') AND v_shipment.status IS DISTINCT FROM 'paid')
     OR (p_source = 'preparing_timeout' AND v_shipment.status IS DISTINCT FROM 'preparing') THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  -- Do not weaken the label system's orphan fence. A generated preparing label
  -- is not an in-flight generation; carrier cancellation policy remains B4.
  IF v_shipment.label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')
     OR (v_shipment.status = 'paid' AND v_shipment.label_generation_state = 'generated') THEN
    RAISE EXCEPTION 'SHIPMENT_LABEL_OPERATION_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF FOUND THEN
    -- Later callers cannot change the winning source, actor, reason or key.
    v_result := jsonb_build_object('operation_key', v_operation.operation_key,
      'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason);
    IF v_operation.external_started_at IS NOT NULL THEN
      RETURN v_result || jsonb_build_object('status', 'recovery_required');
    END IF;
    IF v_operation.claim_expires_at > clock_timestamp() THEN
      RETURN v_result || jsonb_build_object('status', 'busy');
    END IF;
    -- A stale pre-call worker can no longer pass start after token rotation.
    UPDATE public.shipment_cancellation_operations
      SET claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '15 minutes'
      WHERE shipment_id = p_shipment_id
      RETURNING * INTO v_operation;
  ELSE
    INSERT INTO public.shipment_cancellation_operations
      (shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at)
      VALUES (p_shipment_id, p_order_id, p_source, p_actor_id, p_reason,
        gen_random_uuid(), clock_timestamp() + interval '15 minutes')
      RETURNING * INTO v_operation;
  END IF;

  RETURN jsonb_build_object('status', 'claimed', 'operation_key', v_operation.operation_key,
    'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason,
    'claim_token', v_operation.claim_token, 'claim_expires_at', v_operation.claim_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation(
  p_shipment_id UUID,
  p_claim_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_operation.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'STALE_CANCELLATION_CLAIM';
  END IF;
  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_operation.claim_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_CLAIM_EXPIRED'; END IF;
  IF v_operation.order_id IS DISTINCT FROM v_shipment.order_id THEN RAISE EXCEPTION 'SHIPMENT_ORDER_MISMATCH'; END IF;
  IF (v_operation.source IN ('buyer', 'seller', 'paid_timeout') AND v_shipment.status IS DISTINCT FROM 'paid')
     OR (v_operation.source = 'preparing_timeout' AND v_shipment.status IS DISTINCT FROM 'preparing') THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  IF v_shipment.label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')
     OR (v_shipment.status = 'paid' AND v_shipment.label_generation_state = 'generated') THEN
    RAISE EXCEPTION 'SHIPMENT_LABEL_OPERATION_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  UPDATE public.shipment_cancellation_operations SET external_started_at = clock_timestamp()
    WHERE shipment_id = p_shipment_id AND claim_token = p_claim_token;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_begin_shipment_transfer(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_complete_shipment_transfer(UUID, UUID, INTEGER, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_begin_shipment_transfer(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_complete_shipment_transfer(UUID, UUID, INTEGER, UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_claim_shipment_cancellation(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_shipment_cancellation(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
-- Preserve B1.2: only the frozen-request wrapper may invoke bare start.
REVOKE EXECUTE ON FUNCTION public.fn_start_shipment_cancellation(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
