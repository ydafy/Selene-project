-- Canonical operational SQL copy of the Phase 2B awaiting-balance payout
-- executor claim surface. The deployment source of truth is
-- supabase/migrations/20260920000000_connect_payout_balance_executor_claim.sql.
-- The maintainer applies that migration remotely; this file is the identical
-- operational surface for review and manual execution.

-- ============================================================================
-- Migration: connect_payout_balance_executor_claim
-- ----------------------------------------------------------------------------
-- Phase 2B of the payout operating model, slice 3: the lease- and fence-aware
-- claim surface for the awaiting-balance payout executor. Depends on the
-- stage/fencing migration (durable stages, claim token, stage version) and on
-- the account actionability projection.
--
-- A run is claimable for payout creation only when:
--   status = 'pending_reconciliation' (deployed Phase 2A gate, preserved),
--   stripe_payout_id IS NULL (no Stripe payout exists yet),
--   release_stage = 'awaiting_connected_balance' (or a legacy NULL stage,
--     which the claim normalizes on admission),
--   its derived account actionability is true (unknown accounts default to
--   actionable; the documented blocked statuses park their runs instead),
--   next_attempt_at is absent or due (insufficient-balance deferrals wait),
--     and due candidates are fairly ordered by readiness time
--     (COALESCE(next_attempt_at, created_at)): a due deferred run can never
--     starve behind newer never-deferred arrivals, a not-yet-due run is
--     never claimed, and a just-deferred run cannot be reclaimed in the
--     same tick because its backoff sets next_attempt_at in the future,
--   its executor claim is absent or expired, and
--   every run shipment mapping is still an active pending mapping whose
--   shipment already carries a Stripe transfer id.
--
-- Runs fenced in payout_create_in_progress are never claimed for creation:
-- they are claimed by the bounded reconciliation claim, which lists Stripe
-- server-side and never creates a second payout.
--
-- The claim token plus stage version fence every Stripe call and every
-- worker state write; a stale worker aborts on conflict.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Claim one eligible awaiting-balance run under a short lease, returning the
-- claim token and stage version the worker must fence its writes with.
-- Every claim bumps the monotonic stage version, minting a new fencing
-- epoch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_claim_awaiting_balance_payout_run(
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  run_id UUID,
  actor_id UUID,
  seller_id UUID,
  amount_cents INTEGER,
  idempotency_key TEXT,
  shipment_ids UUID[],
  claim_token TEXT,
  stage_version INTEGER,
  claim_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease TIMESTAMPTZ;
  v_run_id UUID;
  v_actor_id UUID;
  v_seller_id UUID;
  v_amount INTEGER;
  v_idempotency_key TEXT;
  v_shipment_ids UUID[];
  v_claim_token TEXT;
  v_stage_version INTEGER;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'INVALID_LEASE_SECONDS';
  END IF;

  v_lease := now() + make_interval(secs => p_lease_seconds);

  SELECT
    cpr.id,
    cpr.actor_id,
    cpr.seller_id,
    cpr.amount,
    cpr.idempotency_key,
    cpr.release_stage_version
  INTO
    v_run_id,
    v_actor_id,
    v_seller_id,
    v_amount,
    v_idempotency_key,
    v_stage_version
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  LEFT JOIN public.connect_account_actionability caa
    ON caa.stripe_account_id = pp.stripe_account_id
  WHERE cpr.status = 'pending_reconciliation'
    AND cpr.stripe_payout_id IS NULL
    -- Only the executor-eligible pre-payout stage; a run fenced in
    -- payout_create_in_progress is reconciliation territory, never a second
    -- create.
    AND (
      cpr.release_stage = 'awaiting_connected_balance'
      OR cpr.release_stage IS NULL
    )
    -- Derived actionability: an account evidencing a documented non-actionable
    -- state (errored, verification_failed,
    -- tokenized_account_number_deactivated, payouts_disabled) is never
    -- claimed; unevidenced accounts default to actionable.
    AND COALESCE(caa.is_actionable, TRUE)
    -- Deferred runs stay deferred until their next attempt is due.
    AND (
      cpr.next_attempt_at IS NULL
      OR cpr.next_attempt_at <= now()
    )
    -- Absent or expired lease only; an actively leased run is never handed to
    -- a second worker.
    AND (
      cpr.payout_claim_expires_at IS NULL
      OR cpr.payout_claim_expires_at <= now()
    )
    AND EXISTS (
      SELECT 1
      FROM public.connect_payout_run_shipments m
      WHERE m.run_id = cpr.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.connect_payout_run_shipments m
      JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = cpr.id
        AND (
          m.status <> 'pending_reconciliation'
          OR s.stripe_transfer_id IS NULL
        )
    )
  -- Fair scheduling across all due candidates: order by each run's readiness
  -- instant — a never-deferred arrival became ready at created_at, a
  -- deferred run becomes ready again at next_attempt_at — so a due deferred
  -- run is claimed ahead of any newer arrival whose backoff has not been
  -- waiting as long. FIFO within the same readiness time. Prioritizing
  -- never-deferred arrivals ahead of due deferred runs (the legacy
  -- nulls-first ordering) would permanently starve due deferred runs under
  -- sustained arrivals. Not-yet-due runs are excluded by the WHERE gate
  -- above; a just-deferred run is not claimable again in the same tick
  -- because its backoff (minimum one minute) sets next_attempt_at in the
  -- future.
  ORDER BY COALESCE(cpr.next_attempt_at, cpr.created_at), cpr.created_at
  FOR UPDATE OF cpr SKIP LOCKED
  LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.connect_payout_runs
  SET payout_claim_token = gen_random_uuid()::text,
      payout_claim_expires_at = v_lease,
      -- Legacy admission: normalize a pre-fencing run into the stage model
      -- under the claim it just received.
      release_stage = COALESCE(release_stage, 'awaiting_connected_balance'),
      -- Every claim mints a new fencing epoch: the unconditional version
      -- bump invalidates any write an earlier claim holder could still be
      -- about to make, so a re-claimed lease can never reuse the previous
      -- token+version pair.
      release_stage_version = release_stage_version + 1,
      updated_at = now()
  WHERE id = v_run_id
  RETURNING payout_claim_token, release_stage_version
    INTO v_claim_token, v_stage_version;

  SELECT array_agg(m.shipment_id ORDER BY m.shipment_id)
  INTO v_shipment_ids
  FROM public.connect_payout_run_shipments m
  WHERE m.run_id = v_run_id;

  RETURN QUERY SELECT
    v_run_id,
    v_actor_id,
    v_seller_id,
    v_amount,
    v_idempotency_key,
    v_shipment_ids,
    v_claim_token,
    v_stage_version,
    v_lease;
END;
$$;

COMMENT ON FUNCTION public.fn_claim_awaiting_balance_payout_run IS
  'Claims one awaiting-balance payout run (pending_reconciliation, no Stripe payout id, awaiting_connected_balance or legacy stage, actionable account, next attempt due, unclaimed or expired lease, every shipment already transferred) under a short FOR UPDATE SKIP LOCKED lease and returns the DB-derived run fields plus the fresh claim token and the stage version the claim just bumped, which fence every worker write. Every claim mints a new fencing epoch by bumping the version. All due candidates (due deferred and immediate) are fairly ordered by readiness time so deferred runs cannot starve under sustained arrivals. Server-only; execution is restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Deferred scheduling: an insufficient connected balance defers the run with
-- a bounded backoff instead of letting the current batch re-claim it, so
-- newer eligible runs keep progressing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_defer_awaiting_balance_run(
  p_run_id UUID,
  p_claim_token TEXT,
  p_expected_stage_version INTEGER,
  p_backoff_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deferred BOOLEAN;
BEGIN
  IF p_backoff_seconds IS NULL OR p_backoff_seconds < 60 OR p_backoff_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_BACKOFF_SECONDS';
  END IF;

  UPDATE public.connect_payout_runs
  SET next_attempt_at = now() + make_interval(secs => p_backoff_seconds),
      attempt_count = attempt_count + 1,
      last_error = 'insufficient_balance',
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
  WHERE id = p_run_id
    AND payout_claim_token = p_claim_token
    -- Version-conditional so a stale worker cannot defer a newer claim.
    AND release_stage_version = p_expected_stage_version
    -- The deferral itself is a claim-gated write: a lapsed lease means the
    -- worker lost ownership and must not defer the run.
    AND payout_claim_expires_at IS NOT NULL
    AND payout_claim_expires_at > now()
    AND release_stage = 'awaiting_connected_balance'
    AND stripe_payout_id IS NULL
  RETURNING TRUE INTO v_deferred;

  RETURN COALESCE(v_deferred, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_defer_awaiting_balance_run IS
  'Defers an awaiting-balance run whose connected available balance is insufficient: bounded backoff sets next_attempt_at, increments the attempt count, and clears the claim so the current batch cannot re-claim it and newer eligible runs keep progressing. Conditional on the exact claim token, the expected stage version, and an unexpired lease so a stale worker cannot defer a newer claim. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Live-claim verification: the worker calls this immediately before every
-- Stripe balance, listing, and payout-create call. It proves the exact claim
-- token, the expected monotonic stage version, and an unexpired lease — any
-- mismatch raises and the caller must abort without a Stripe call or a state
-- write. Read-only: it mutates nothing.
-- ---------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.fn_verify_payout_claim IS
  'Proves a still-live executor claim before a Stripe call or DB transition: the exact claim token must match, the lease must be unexpired, and the monotonic stage version must equal the expected one; raises STALE_CLAIM, CLAIM_LEASE_EXPIRED, or STAGE_VERSION_CONFLICT otherwise. Read-only. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Bounded reconciliation claim for runs fenced in payout_create_in_progress
-- whose Stripe create attempt is older than the grace window: the worker
-- reconciles by listing Stripe (never by creating again).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_claim_payout_create_reconciliation(
  p_grace_seconds INTEGER DEFAULT 600
)
RETURNS TABLE (
  run_id UUID,
  actor_id UUID,
  seller_id UUID,
  amount_cents INTEGER,
  idempotency_key TEXT,
  stripe_account_id TEXT,
  payout_create_attempted_at TIMESTAMPTZ,
  claim_token TEXT,
  stage_version INTEGER,
  claim_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace_seconds INTEGER;
  v_lease TIMESTAMPTZ;
  v_run_id UUID;
  v_claim_token TEXT;
BEGIN
  IF p_grace_seconds IS NULL OR p_grace_seconds < 30 OR p_grace_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_GRACE_SECONDS';
  END IF;

  v_grace_seconds := p_grace_seconds;
  v_lease := now() + make_interval(secs => 300);

  SELECT cpr.id
  INTO v_run_id
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  WHERE cpr.release_stage = 'payout_create_in_progress'
    AND cpr.payout_create_attempted_at <= now() - make_interval(secs => v_grace_seconds)
    AND (
      cpr.payout_claim_expires_at IS NULL
      OR cpr.payout_claim_expires_at <= now()
    )
  ORDER BY cpr.payout_create_attempted_at
  FOR UPDATE OF cpr SKIP LOCKED
  LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN;
  END IF;

  v_claim_token := gen_random_uuid()::text;

  UPDATE public.connect_payout_runs
  SET payout_claim_token = v_claim_token,
      payout_claim_expires_at = v_lease,
      -- The reconciliation claim also mints a new fencing epoch: the lapsed
      -- worker's token+version pair stops being valid the moment the fence
      -- is claimed for listing-based reconciliation.
      release_stage_version = release_stage_version + 1,
      updated_at = now()
  WHERE id = v_run_id;

  RETURN QUERY SELECT
    cpr.id,
    cpr.actor_id,
    cpr.seller_id,
    cpr.amount,
    cpr.idempotency_key,
    pp.stripe_account_id,
    cpr.payout_create_attempted_at,
    v_claim_token,
    cpr.release_stage_version,
    v_lease
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  WHERE cpr.id = v_run_id;
END;
$$;

COMMENT ON FUNCTION public.fn_claim_payout_create_reconciliation IS
  'Claims one stale payout_create_in_progress run (Stripe create attempt older than the bounded grace window, unclaimed or expired lease) so the worker reconciles the Stripe outcome by server-side listing in the connected-account context; it must never create a second payout. The claim mints a fresh token and bumps the stage version, so a lapsed holder can no longer complete or abort the fence. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Release the executor claim, guarded by the exact claim token so a stale
-- worker cannot clear a lease a newer worker already holds. The token match
-- IS the ownership proof for this cleanup write: a newer claim always mints
-- a fresh token (and a bumped version), so a lapsed holder's release can
-- only clear a lease nobody reclaimed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_release_payout_claim(
  p_run_id UUID,
  p_claim_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
  WHERE id = p_run_id
    AND payout_claim_token = p_claim_token
  RETURNING TRUE INTO v_released;

  RETURN COALESCE(v_released, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_release_payout_claim IS
  'Releases the executor claim on a claimed run only when the claim token matches, so a stale worker cannot clear a lease a newer worker already holds. Server-only; execution restricted to service_role.';

-- All RPCs are server-only: no PUBLIC, anon, or authenticated execution.
REVOKE EXECUTE ON FUNCTION public.fn_claim_awaiting_balance_payout_run FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_claim_awaiting_balance_payout_run FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_defer_awaiting_balance_run FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_defer_awaiting_balance_run FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_claim_payout_create_reconciliation FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_claim_payout_create_reconciliation FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_release_payout_claim FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_release_payout_claim FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_verify_payout_claim FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_verify_payout_claim FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_claim_awaiting_balance_payout_run TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_defer_awaiting_balance_run TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_payout_create_reconciliation TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_release_payout_claim TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_verify_payout_claim TO service_role;

COMMIT;
