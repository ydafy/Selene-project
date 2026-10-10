-- ============================================================================
-- Migration: connect_payout_stage_fencing
-- ----------------------------------------------------------------------------
-- Phase 2B of the payout operating model, slice 1: the durable Selene
-- aggregate release stages plus the fencing fields that make the payout
-- create step safe under concurrency.
--
-- Additive only: the deployed Phase 2A `connect_payout_runs.status` contract
-- (pending_reconciliation | paid | failed | canceled | reconciliation_needed)
-- is preserved untouched. The new `release_stage` column carries the
-- authorized stage model from the payout operating model spec:
--
--   ready, release_accepted, transfer_created, awaiting_connected_balance,
--   payout_create_in_progress, payout_pending, payout_in_transit,
--   paid_observed, payout_failed, payout_canceled, action_required
--
-- `payout_create_in_progress` is the durable write-ahead fence: it is written
-- BEFORE the Stripe payout create call and can only be exited by completing
-- the payout identity, reconciling the Stripe outcome, or an explicit
-- action_required abort. A crash between the Stripe call and the DB write
-- leaves the fence behind, and reconciliation — never a second create —
-- resolves it.
--
-- Every stage mutation is conditional on a claim token and a monotonic stage
-- version, so a stale worker can never overwrite a newer decision and the
-- webhook terminal projection can never regress to pending.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Durable stage and fencing columns (all additive).
-- ---------------------------------------------------------------------------
ALTER TABLE public.connect_payout_runs
  ADD COLUMN IF NOT EXISTS release_stage TEXT
    CHECK (release_stage IN (
      'ready',
      'release_accepted',
      'transfer_created',
      'awaiting_connected_balance',
      'payout_create_in_progress',
      'payout_pending',
      'payout_in_transit',
      'paid_observed',
      'payout_failed',
      'payout_canceled',
      'action_required'
    ));

ALTER TABLE public.connect_payout_runs
  ADD COLUMN IF NOT EXISTS release_stage_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.connect_payout_runs
  ADD COLUMN IF NOT EXISTS payout_claim_token TEXT;

ALTER TABLE public.connect_payout_runs
  ADD COLUMN IF NOT EXISTS payout_claim_expires_at TIMESTAMPTZ;

ALTER TABLE public.connect_payout_runs
  ADD COLUMN IF NOT EXISTS payout_create_attempted_at TIMESTAMPTZ;

ALTER TABLE public.connect_payout_runs
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

ALTER TABLE public.connect_payout_runs
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.connect_payout_runs
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE public.connect_payout_runs
  ADD COLUMN IF NOT EXISTS action_required_reason TEXT;

COMMENT ON COLUMN public.connect_payout_runs.release_stage IS
  'Selene aggregate release stage (payout operating model). Distinct from Stripe payout state: no Stripe payout exists before payout_pending. payout_create_in_progress is the durable write-ahead fence held while a Stripe payout create is in flight; it is only exited by completing the payout identity, reconciling the Stripe outcome, or an action_required abort — never by a second create.';
COMMENT ON COLUMN public.connect_payout_runs.release_stage_version IS
  'Monotonic stage version; every conditional stage write must carry the version it observed so stale workers conflict instead of overwriting.';
COMMENT ON COLUMN public.connect_payout_runs.payout_claim_token IS
  'Opaque claim token held by the current executor worker; every worker write is token-conditional. NULL = unclaimed.';
COMMENT ON COLUMN public.connect_payout_runs.payout_claim_expires_at IS
  'Expiry of the executor lease. The lease guards worker concurrency and crash recovery only; Stripe idempotency on the persisted idempotency_key remains the duplicate-payout guarantee.';
COMMENT ON COLUMN public.connect_payout_runs.payout_create_attempted_at IS
  'Write-ahead timestamp recorded when the payout_create_in_progress fence is opened, before the Stripe payout create call; it bounds the reconciliation listing window.';
COMMENT ON COLUMN public.connect_payout_runs.next_attempt_at IS
  'Earliest time the awaiting-balance executor may claim this run again after an insufficient-balance deferral; NULL = immediately eligible.';
COMMENT ON COLUMN public.connect_payout_runs.attempt_count IS
  'Number of executor attempts recorded for this run (deferrals increment it).';
COMMENT ON COLUMN public.connect_payout_runs.last_error IS
  'Last non-fatal executor error or deferral reason recorded for this run; diagnostic only, never a retry authority.';
COMMENT ON COLUMN public.connect_payout_runs.action_required_reason IS
  'Why a run sits in the action_required stage. Only the account_not_actionable reason may be auto-resumed by a later actionable account update; every other action_required state requires an admin decision.';

CREATE INDEX IF NOT EXISTS idx_connect_payout_runs_release_stage_next_attempt
  ON public.connect_payout_runs (release_stage, next_attempt_at)
  WHERE status = 'pending_reconciliation' AND stripe_payout_id IS NULL;

-- ---------------------------------------------------------------------------
-- Backfill deployed Phase 2A runs into the stage model. The deployed status
-- values are preserved exactly; the stage is derived once from the data the
-- runs already carry.
-- ---------------------------------------------------------------------------
UPDATE public.connect_payout_runs
SET release_stage = CASE
  WHEN status = 'paid' THEN 'paid_observed'
  WHEN status = 'failed' THEN 'payout_failed'
  WHEN status = 'canceled' THEN 'payout_canceled'
  WHEN status = 'reconciliation_needed' THEN 'action_required'
  WHEN status = 'pending_reconciliation' AND stripe_payout_id IS NOT NULL
    THEN 'payout_pending'
  WHEN status = 'pending_reconciliation' AND stripe_payout_id IS NULL
    THEN 'awaiting_connected_balance'
  ELSE release_stage
END
WHERE release_stage IS NULL;

-- ---------------------------------------------------------------------------
-- Generic guarded stage transition. Conditional on the current stage version
-- and — when a claim token is supplied — on the caller still holding the
-- claim. Terminal stages (paid_observed, payout_failed, payout_canceled) and
-- action_required never regress to a non-terminal stage: recovery from
-- action_required belongs to the actionability projection or an admin
-- decision, not to a generic transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_transition_payout_release_stage(
  p_run_id UUID,
  p_target_stage TEXT,
  p_expected_stage_version INTEGER,
  p_claim_token TEXT DEFAULT NULL,
  p_last_error TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage TEXT;
  v_version INTEGER;
  v_token TEXT;
  v_expires TIMESTAMPTZ;
  v_new_version INTEGER;
BEGIN
  IF p_target_stage NOT IN (
    'ready',
    'release_accepted',
    'transfer_created',
    'awaiting_connected_balance',
    'payout_create_in_progress',
    'payout_pending',
    'payout_in_transit',
    'paid_observed',
    'payout_failed',
    'payout_canceled',
    'action_required'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_RELEASE_STAGE';
  END IF;

  IF p_expected_stage_version IS NULL OR p_expected_stage_version < 1 THEN
    RAISE EXCEPTION 'INVALID_STAGE_VERSION';
  END IF;

  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token,
         cpr.payout_claim_expires_at
  INTO v_stage, v_version, v_token, v_expires
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  IF p_claim_token IS NOT NULL AND (v_token IS NULL OR v_token <> p_claim_token) THEN
    RAISE EXCEPTION 'STALE_CLAIM';
  END IF;

  -- Token-conditional writes also require an unexpired lease: a worker whose
  -- lease lapsed mid-flight lost durable ownership and must not transition
  -- the run; the claim flow (or the manual path, which passes no token)
  -- owns the next decision.
  IF p_claim_token IS NOT NULL AND (v_expires IS NULL OR v_expires <= now()) THEN
    RAISE EXCEPTION 'CLAIM_LEASE_EXPIRED';
  END IF;

  IF v_version <> p_expected_stage_version THEN
    RAISE EXCEPTION 'STAGE_VERSION_CONFLICT';
  END IF;

  IF v_stage IN ('paid_observed', 'payout_failed', 'payout_canceled')
    AND p_target_stage NOT IN ('paid_observed', 'payout_failed', 'payout_canceled') THEN
    RAISE EXCEPTION 'TERMINAL_STAGE_REGRESSION';
  END IF;

  IF v_stage = 'action_required'
    AND p_target_stage NOT IN ('paid_observed', 'payout_failed', 'payout_canceled', 'action_required') THEN
    RAISE EXCEPTION 'STAGE_TRANSITION_BLOCKED';
  END IF;

  v_new_version := v_version + 1;

  UPDATE public.connect_payout_runs
  SET release_stage = p_target_stage,
      release_stage_version = v_new_version,
      last_error = p_last_error,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id;

  RETURN v_new_version;
END;
$$;

COMMENT ON FUNCTION public.fn_transition_payout_release_stage IS
  'Guarded stage transition: rejects unknown stages, stale claim tokens, lapsed leases, stale stage versions, and terminal/action_required regressions; bumps the version monotonically and clears the executor claim. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Durable write-ahead fence for the Stripe payout create: written BEFORE the
-- create call so any post-Stripe persistence failure leaves a recoverable
-- fence that reconciliation (never a second create) resolves.
-- ---------------------------------------------------------------------------
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

  IF v_token IS NULL OR v_token <> p_claim_token THEN
    RAISE EXCEPTION 'STALE_CLAIM';
  END IF;

  -- A lapsed lease means the worker lost durable ownership: it must abort
  -- without opening the fence, and the Stripe create must never run.
  IF v_expires IS NULL OR v_expires <= now() THEN
    RAISE EXCEPTION 'CLAIM_LEASE_EXPIRED';
  END IF;

  IF v_version <> p_expected_stage_version THEN
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

COMMENT ON FUNCTION public.fn_begin_payout_create_fence IS
  'Durable write-ahead fence before a Stripe payout create: claims the run into payout_create_in_progress with payout_create_attempted_at, token-, version-, and lease-conditional, so a crash after the Stripe call leaves a recoverable fence instead of a duplicate-create window. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Manual release path: the admin endpoint opens the SAME durable write-ahead
-- fence before its Stripe payout create. The manual path holds no executor
-- claim token, and the fence atomically refuses any held executor claim
-- (live or lapsed) under the same row lock: a live lease means a worker is
-- mid-flight, and a lapsed claim is reclaimed only by the worker claim flow,
-- never by a manual bypass. The atomic stage transition plus the monotonic
-- stage version are the equivalent durable ownership: only one fence can be
-- open, and a webhook terminal projection bumps the version so a late
-- completion can never overwrite it. A run already fenced in
-- payout_create_in_progress raises PAYOUT_CREATE_FENCE_CONFLICT — its Stripe
-- outcome must be reconciled by listing, never recreated by a second create.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_begin_manual_payout_create_fence(
  p_run_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage TEXT;
  v_version INTEGER;
  v_token TEXT;
BEGIN
  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token
  INTO v_stage, v_version, v_token
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  IF v_token IS NOT NULL THEN
    -- Slice 3 residual race closure: the executor claim is inspected under
    -- the same row lock as the fence write, so a worker claim that lands
    -- concurrently conflicts atomically instead of racing the manual path
    -- between the inspect and the fence update. Any held token conflicts —
    -- a live lease means a worker is mid-flight, and a lapsed lease is
    -- reclaimed only by the worker claim flow, never by a manual bypass.
    RAISE EXCEPTION 'EXECUTOR_CLAIM_HELD';
  END IF;

  IF v_stage IS NOT NULL
    AND v_stage NOT IN (
      'release_accepted',
      'transfer_created',
      'awaiting_connected_balance'
    ) THEN
    -- Includes payout_create_in_progress (already fenced: reconcile, never
    -- recreate) and every terminal or action_required stage.
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

COMMENT ON FUNCTION public.fn_begin_manual_payout_create_fence IS
  'Manual release path of the durable write-ahead fence: atomically transitions a pre-payout run (release_accepted, transfer_created, or awaiting_connected_balance) into payout_create_in_progress with payout_create_attempted_at and a bumped stage version, refuses an already-open fence so the admin endpoint can never create over an unreconciled Stripe attempt, and refuses any held executor claim (live or lapsed) under the same row lock — a lapsed claim is reclaimed only by the worker claim flow, never by a manual bypass. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Manual exits of the fence reuse fn_complete_payout_create_fence,
-- fn_fail_payout_create_from_fence, and
-- fn_abort_payout_create_to_action_required with p_claim_token = NULL: the
-- version-conditioned fence stage is the durable ownership.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Exit the fence after Stripe accepted the payout: attach the authoritative
-- payout id and advance to payout_pending. Token- and version-conditional;
-- when a webhook already projected a later stage (or terminal outcome), the
-- fence is simply cleared without regressing the stage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_complete_payout_create_fence(
  p_run_id UUID,
  p_expected_stage_version INTEGER,
  p_stripe_payout_id TEXT,
  p_claim_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  IF p_stripe_payout_id IS NULL OR btrim(p_stripe_payout_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_PAYOUT_ID';
  END IF;

  UPDATE public.connect_payout_runs
  SET stripe_payout_id = COALESCE(stripe_payout_id, p_stripe_payout_id),
      release_stage = CASE
        WHEN release_stage IN (
          'payout_pending',
          'payout_in_transit',
          'paid_observed',
          'payout_failed',
          'payout_canceled'
        ) THEN release_stage
        ELSE 'payout_pending'
      END,
      release_stage_version = release_stage_version + 1,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Version-conditional: a webhook that already projected a later stage
      -- or a terminal outcome has bumped the version, so a stale completion
      -- is rejected instead of regressing the aggregate.
      AND release_stage_version = p_expected_stage_version
      -- Token-conditional when the caller holds an executor claim; the
      -- manual release path passes NULL and owns the run through the
      -- version-conditioned payout_create_in_progress fence stage alone.
      -- The executor-owned exit also requires an unexpired lease: a worker
      -- whose lease lapsed mid-flight must not mutate the fenced run.
      AND (
        p_claim_token IS NULL
        OR (
          payout_claim_token = p_claim_token
          AND payout_claim_expires_at > now()
        )
      )
      AND release_stage IN (
        'payout_create_in_progress',
        'payout_pending',
        'payout_in_transit',
        'paid_observed',
        'payout_failed',
        'payout_canceled'
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_complete_payout_create_fence IS
  'Exits the payout create fence with the authoritative Stripe payout id: attaches it when absent, advances payout_create_in_progress to payout_pending, and never regresses a later webhook stage or terminal projection. Returns FALSE when a webhook already consumed the claim or version, so the worker must not write pending state. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Record a definitive Stripe create rejection from inside the fence: no
-- payout object exists, so the run keeps Phase 2A failed semantics and stays
-- in the admin retry flow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fail_payout_create_from_fence(
  p_run_id UUID,
  p_expected_stage_version INTEGER,
  p_failure_reason TEXT,
  p_claim_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET release_stage = 'payout_failed',
      release_stage_version = release_stage_version + 1,
      status = 'failed',
      failure_reason = p_failure_reason,
      failed_at = now(),
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Token-conditional when the caller holds an executor claim; the manual
      -- release path passes NULL and is owned by the version-conditioned
      -- payout_create_in_progress fence stage.
      AND (
        p_claim_token IS NULL
        OR (
          payout_claim_token = p_claim_token
          AND payout_claim_expires_at > now()
        )
      )
      AND release_stage_version = p_expected_stage_version
      AND release_stage = 'payout_create_in_progress'
      AND stripe_payout_id IS NULL
  RETURNING TRUE INTO v_updated;

  IF v_updated THEN
    -- The aggregate and its shipment mappings move together: a definitive
    -- Stripe rejection maps the run's pending mappings to failed.
    UPDATE public.connect_payout_run_shipments
    SET status = 'failed',
        updated_at = now()
      WHERE run_id = p_run_id
        AND status IN ('pending_reconciliation');
  END IF;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_fail_payout_create_from_fence IS
  'Records a definitive Stripe payout create rejection from inside the fence: the run takes Phase 2A failed semantics (no payout object was created), the claim clears, and the admin retry flow remains authoritative. Token- and version-conditional. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Abort the fence to action_required when the Stripe outcome cannot be
-- reconciled (zero or multiple listing matches): the run waits for an admin
-- decision instead of risking a duplicate payout.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_abort_payout_create_to_action_required(
  p_run_id UUID,
  p_expected_stage_version INTEGER,
  p_reason TEXT,
  p_claim_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET release_stage = 'action_required',
      release_stage_version = release_stage_version + 1,
      status = CASE WHEN status IN ('pending_reconciliation', 'reconciliation_needed') THEN 'reconciliation_needed' ELSE status END,
      action_required_reason = 'payout_create_outcome_unresolved',
      failure_reason = p_reason,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Token-conditional when the caller holds an executor claim; the manual
      -- release path passes NULL and is owned by the version-conditioned
      -- payout_create_in_progress fence stage.
      AND (
        p_claim_token IS NULL
        OR (
          payout_claim_token = p_claim_token
          AND payout_claim_expires_at > now()
        )
      )
      AND release_stage_version = p_expected_stage_version
      AND release_stage = 'payout_create_in_progress'
  RETURNING TRUE INTO v_updated;

  IF v_updated THEN
    -- An unresolved create outcome also moves the run's pending mappings into
    -- reconciliation so the active-release gate keeps the shipments parked.
    UPDATE public.connect_payout_run_shipments
    SET status = 'reconciliation_needed',
        updated_at = now()
      WHERE run_id = p_run_id
        AND status IN ('pending_reconciliation');
  END IF;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_abort_payout_create_to_action_required IS
  'Aborts the payout create fence into action_required when the Stripe outcome cannot be reconciled to exactly one payout: no new payout is ever created from this state. Token- and version-conditional. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Webhook terminal projection, ATOMIC final slice: the run projection, the
-- shipment-mapping projection, and the shipment payout-id set/clear are ONE
-- conditional unit in the same SECURITY DEFINER transaction. Previously the
-- webhook applied these as three separate writes; a paid handler that resumed
-- after a failed handler could restore shipment payout ids behind a failed
-- run. Now the run row's guarded terminal gate owns every dependent effect:
-- a refusal (FALSE) applies nothing, and any raised error rolls the whole
-- unit back, so no partial projection is ever committed.
-- ---------------------------------------------------------------------------
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
  v_updated BOOLEAN;
  v_conflicting_shipment_id TEXT := NULL;
BEGIN
  IF p_target_status NOT IN ('paid', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'UNSUPPORTED_TERMINAL_STATUS';
  END IF;

  IF p_payout_id IS NULL OR btrim(p_payout_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_PAYOUT_ID';
  END IF;

  -- Lock the run row first: every dependent effect below is gated by this
  -- row's guarded terminal write inside the same transaction, so a resumed
  -- paid handler that arrives after a failed handler is refused by the same
  -- gate instead of restoring shipment payout ids behind the failed run.
  PERFORM 1
    FROM public.connect_payout_runs cpr
    WHERE cpr.id = p_run_id
      AND cpr.stripe_payout_id = p_payout_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.connect_payout_runs
  SET release_stage = CASE
        WHEN p_target_status = 'paid' THEN 'paid_observed'
        WHEN p_target_status = 'failed' THEN 'payout_failed'
        ELSE 'payout_canceled'
      END,
      release_stage_version = release_stage_version + 1,
      status = p_target_status,
      paid_at = CASE
        WHEN p_target_status = 'paid' AND (paid_at IS NULL OR p_occurred_at > paid_at)
          THEN p_occurred_at
        ELSE paid_at
      END,
      failed_at = CASE
        WHEN p_target_status IN ('failed', 'canceled') THEN p_occurred_at
        ELSE failed_at
      END,
      failure_reason = CASE
        WHEN p_target_status IN ('failed', 'canceled') AND p_failure_reason IS NOT NULL
          THEN p_failure_reason
        ELSE failure_reason
      END,
      -- failure_balance_transaction evidence stays in the append-only event
      -- ledger; the run carries the failure reason string only.
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      AND stripe_payout_id = p_payout_id
      -- Never regress a recorded terminal failure back to paid; a paid
      -- outcome after a recorded failure is authority-conflict territory and
      -- stays in reconciliation instead of silently flipping the aggregate.
      AND NOT (p_target_status = 'paid' AND status IN ('failed', 'canceled'))
      -- The projection applies to every non-terminal state, including the
      -- durable payout_create_in_progress fence.
      AND (
        status NOT IN ('paid', 'failed', 'canceled')
        OR (status = 'paid' AND p_target_status = 'failed')
      )
  RETURNING TRUE INTO v_updated;

  -- Refused (run not found for this payout, payout id mismatch, or terminal
  -- regression): apply NOTHING and report the refusal.
  IF NOT COALESCE(v_updated, FALSE) THEN
    RETURN FALSE;
  END IF;

  -- The shipment mappings move with the run in the same transaction. Monotonic
  -- filter: a paid outcome only advances pending mappings (never regresses a
  -- recorded failure); failure and cancellation projections may advance both
  -- pending and paid mappings when the signed event documents the downgrade.
  IF p_target_status = 'paid' THEN
    UPDATE public.connect_payout_run_shipments
    SET status = 'paid',
        updated_at = now()
      WHERE run_id = p_run_id
        AND status IN ('pending_reconciliation');
  ELSE
    UPDATE public.connect_payout_run_shipments
    SET status = p_target_status,
        updated_at = now()
      WHERE run_id = p_run_id
        AND status IN ('pending_reconciliation', 'paid');
  END IF;

  IF p_target_status = 'paid' THEN
    -- A paid outcome with no mapped shipment has nothing to release: park it
    -- for investigation instead of silently accepting an empty release.
    IF NOT EXISTS (
      SELECT 1
        FROM public.connect_payout_run_shipments m
        WHERE m.run_id = p_run_id
          AND m.shipment_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'PAYOUT_RUN_HAS_NO_SHIPMENTS';
    END IF;

    -- Set the payout id on the run's mapped shipments. A mapped shipment
    -- already carrying a DIFFERENT payout id is refused by the post-write
    -- conflict check below (the raised error rolls the whole unit back, so
    -- no partial release is committed).
    UPDATE public.shipments
    SET stripe_payout_id = p_payout_id,
        updated_at = now()
      WHERE id IN (
              SELECT m.shipment_id
                FROM public.connect_payout_run_shipments m
                WHERE m.run_id = p_run_id
                  AND m.shipment_id IS NOT NULL
            )
      AND stripe_payout_id IS NULL;

    -- Conflict re-check under the row locks this projection holds: a
    -- concurrent writer that released a shipment for another payout between
    -- the run write and here conflicts instead of racing a partial release.
    SELECT s.id
      INTO v_conflicting_shipment_id
      FROM public.connect_payout_run_shipments m
      JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = p_run_id
        AND s.stripe_payout_id IS NOT NULL
        AND s.stripe_payout_id <> p_payout_id
      LIMIT 1;

    IF v_conflicting_shipment_id IS NOT NULL THEN
      RAISE EXCEPTION 'SHIPMENT_ALREADY_RELEASED:%', v_conflicting_shipment_id;
    END IF;
  ELSE
    -- Late paid -> failed/canceled: clear the shipment payout id ONLY where
    -- it equals the failing payout id, so an older or unrelated event can
    -- never unrelease another payout's shipment (Phase 2A contract).
    UPDATE public.shipments
    SET stripe_payout_id = NULL,
        updated_at = now()
      WHERE id IN (
              SELECT m.shipment_id
                FROM public.connect_payout_run_shipments m
                WHERE m.run_id = p_run_id
                  AND m.shipment_id IS NOT NULL
            )
      AND stripe_payout_id = p_payout_id;
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.fn_project_payout_run_terminal IS
  'Atomic webhook terminal projection: one SECURITY DEFINER transaction conditionally projects the run (compatible terminal stage and Phase 2A status, executor claim cleared), advances the shipment mappings with the monotonic filter (paid only from pending; failure and cancellation from pending and paid), and sets or clears the shipment payout-id markings — setting it only where unreleased (a conflicting release raises and rolls the unit back) and clearing it only where it equals the failing payout id. Returns FALSE (nothing applied) when the run does not match the payout id or the outcome would regress terminal authority. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Webhook progress projection: payout.created / payout.updated(in_transit)
-- advance the stage model without touching the terminal projection. Unknown
-- stages and regressions are refused; a terminal run stays terminal. A run
-- already sitting at the target stage is an idempotent no-op that returns
-- TRUE: only a genuine refusal returns FALSE, so the caller never has to
-- guess whether FALSE meant "nothing to do".
-- ---------------------------------------------------------------------------
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
  v_updated BOOLEAN;
BEGIN
  IF p_target_stage NOT IN ('payout_pending', 'payout_in_transit') THEN
    RAISE EXCEPTION 'UNSUPPORTED_PROGRESS_STAGE';
  END IF;

  -- Inspect under a row lock so the no-op classification and the guarded
  -- write observe the same stage.
  SELECT cpr.release_stage
    INTO v_stage
    FROM public.connect_payout_runs cpr
    WHERE cpr.id = p_run_id
      AND cpr.stripe_payout_id = p_payout_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Idempotent no-op: the run already sits at the target stage (for example
  -- a replayed payout.created after the worker completed the fence into
  -- payout_pending). Nothing to write, no new version, never a rejection.
  IF v_stage = p_target_stage THEN
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
      -- Re-check under the lock: a concurrent writer that moved the stage
      -- between the inspect and this write conflicts instead of overwriting.
      AND release_stage IS NOT DISTINCT FROM v_stage
      AND status IN ('pending_reconciliation', 'reconciliation_needed')
      -- Monotonic: payout_pending is only reachable from the durable
      -- payout_create_in_progress fence (or a legacy NULL stage), and
      -- payout_in_transit never regresses a run already in transit.
      AND (
        (
          p_target_stage = 'payout_pending'
          AND (release_stage IS NULL
            OR release_stage = 'payout_create_in_progress')
        )
        OR (
          p_target_stage = 'payout_in_transit'
          AND (release_stage IS NULL
            OR release_stage IN (
              'payout_create_in_progress',
              'payout_pending'
            ))
        )
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_project_payout_run_stage IS
  'Advances the pre-terminal aggregate stage from signed payout.created / payout.updated(in_transit) events, clears any executor claim, and is monotonic: payout_pending is only reachable from the payout_create_in_progress fence or a legacy NULL stage, payout_in_transit never regresses to payout_pending, and a terminal state is never re-opened. A run already at the target stage returns TRUE as an idempotent no-op; only a genuine refusal returns FALSE. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Webhook reconciliation park: marks a run reconciliation_needed through a
-- guarded, version-bumping write instead of a direct UPDATE. A park is
-- legitimate from ANY status — a failed dependent write or a Stripe
-- authority conflict parks even a terminal run — but the park itself is
-- fenced: it moves the aggregate to the action_required stage, bumps the
-- monotonic stage version, clears the executor claim and lease, and never
-- touches paid_at / failed_at terminal evidence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_mark_payout_run_reconciliation_needed(
  p_run_id UUID,
  p_failure_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET status = 'reconciliation_needed',
      release_stage = 'action_required',
      release_stage_version = release_stage_version + 1,
      failure_reason = COALESCE(p_failure_reason, failure_reason),
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Idempotent no-op: an already-parked run whose recorded reason is
      -- unchanged is not a new decision, so the monotonic version stays put
      -- for a repeated park.
      AND (
        status IS DISTINCT FROM 'reconciliation_needed'
        OR failure_reason IS DISTINCT FROM
          COALESCE(p_failure_reason, failure_reason)
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_mark_payout_run_reconciliation_needed IS
  'Webhook reconciliation park: guarded, version-bumping write that sets status=reconciliation_needed with the compatible action_required stage, clears the executor claim and lease, and preserves paid_at/failed_at terminal evidence. A repeated park with the same reason is an idempotent no-op. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Post-Stripe sync fallback (manual release path): the payout exists in
-- Stripe but could not be persisted through the fence-exit RPC. The write is
-- guarded and refuses a terminal or newer durable state instead of
-- overwriting it by run id: a webhook already projected a terminal outcome,
-- and that terminal authority stays untouched. The durable
-- payout_create_in_progress fence (or whichever stage the run holds) STAYS
-- so the executor reconciliation claim — never a second create — recovers
-- the run and projects the payout id. An already-parked run with the same
-- recorded reason is an idempotent no-op.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_mark_payout_run_sync_failed(
  p_run_id UUID,
  p_stripe_payout_id TEXT,
  p_failure_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET stripe_payout_id = COALESCE(stripe_payout_id, p_stripe_payout_id),
      status = 'reconciliation_needed',
      failure_reason = COALESCE(p_failure_reason, failure_reason),
      release_stage_version = release_stage_version + 1,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Never regress terminal authority: a webhook already projected a
      -- terminal outcome (paid/failed/canceled), and this fallback must not
      -- overwrite it.
      AND status NOT IN ('paid', 'failed', 'canceled')
      -- Idempotent no-op: an already-parked run with the same recorded reason
      -- and payout id is not a new decision, so the version stays put.
      AND (
        status IS DISTINCT FROM 'reconciliation_needed'
        OR stripe_payout_id IS DISTINCT FROM
          COALESCE(stripe_payout_id, p_stripe_payout_id)
        OR failure_reason IS DISTINCT FROM
          COALESCE(p_failure_reason, failure_reason)
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_mark_payout_run_sync_failed IS
  'Post-Stripe sync fallback of the manual release path: guarded, version-bumping write that attaches the payout id when absent and parks the run at status=reconciliation_needed while preserving the durable stage (fence stays so the executor reconciliation claim recovers it), refusing a terminal status (paid/failed/canceled) so webhook terminal authority is never regressed. A repeated fallback with the same recorded reason is an idempotent no-op. Server-only; execution restricted to service_role.';

-- Both the fencing RPCs are server-only: no PUBLIC, anon, or authenticated
-- execution.
REVOKE EXECUTE ON FUNCTION public.fn_transition_payout_release_stage FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_transition_payout_release_stage FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_begin_payout_create_fence FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_begin_payout_create_fence FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_begin_manual_payout_create_fence FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_begin_manual_payout_create_fence FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_complete_payout_create_fence FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_complete_payout_create_fence FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_fail_payout_create_from_fence FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_fail_payout_create_from_fence FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_abort_payout_create_to_action_required FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_abort_payout_create_to_action_required FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_project_payout_run_terminal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_project_payout_run_terminal FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_project_payout_run_stage FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_project_payout_run_stage FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_mark_payout_run_reconciliation_needed FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_mark_payout_run_reconciliation_needed FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_mark_payout_run_sync_failed FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_mark_payout_run_sync_failed FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_transition_payout_release_stage TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_begin_payout_create_fence TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_begin_manual_payout_create_fence TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_complete_payout_create_fence TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_fail_payout_create_from_fence TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_abort_payout_create_to_action_required TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_project_payout_run_terminal TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_project_payout_run_stage TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mark_payout_run_reconciliation_needed TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mark_payout_run_sync_failed TO service_role;

COMMIT;
