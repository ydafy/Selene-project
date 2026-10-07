-- ============================================================================
-- Migration: connect_account_actionability
-- ----------------------------------------------------------------------------
-- Phase 2B of the payout operating model, slice 2: separate, append-only
-- Stripe account evidence plus a derived per-account payout actionability
-- state, and the projection that gates pre-payout payout runs on it.
--
-- Stripe's documented non-actionable external-account statuses:
--   errored, verification_failed, tokenized_account_number_deactivated
-- plus account-level payouts_enabled = false block payout creation.
--
-- A non-actionable account moves its relevant pre-payout runs into
-- action_required with the dedicated `account_not_actionable` reason (visible
-- through the existing admin release queue as a reconciliation-needed run),
-- and clears any executor claim so no worker creates a payout for it. Runs
-- already fenced in `payout_create_in_progress` are never parked by this
-- projection: the durable fence is exited only by its claim owner, the
-- reconciliation path, or a terminal projection.
-- A later actionable update resumes ONLY runs whose action_required state is
-- specifically the account actionability reason — every other action_required
-- state stays parked for an admin decision.
--
-- The payout event ledger (Phase 2A) is never touched: account evidence is a
-- separate append-only store.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only signed account event evidence, keyed by Stripe event identity.
-- Separate from the Phase 2A payout event ledger; never rewritten or deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connect_account_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  stripe_account_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'account.updated',
      'account.external_account.updated'
    )
  ),
  stripe_created TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payouts_enabled BOOLEAN,
  external_account_id TEXT,
  external_account_status TEXT
);

COMMENT ON TABLE public.connect_account_events IS
  'Append-only, immutable Stripe account/external-account event evidence keyed by Stripe event identity; the derived per-account actionability is a projection rebuilt from this evidence, and it never mutates the Phase 2A payout event ledger.';
COMMENT ON COLUMN public.connect_account_events.stripe_event_id IS
  'Stripe event.id; duplicate webhook deliveries dedupe on this identity and must never create a second evidence row or a second projection.';
COMMENT ON COLUMN public.connect_account_events.payouts_enabled IS
  'Account-level payouts_enabled carried by the signed event; NULL when the field is absent or undocumented.';
COMMENT ON COLUMN public.connect_account_events.external_account_id IS
  'External bank-account id carried by the signed event, when parseable; NULL when absent or not parseable. Evidence only: identity attribution, never an actionability input by itself.';
COMMENT ON COLUMN public.connect_account_events.external_account_status IS
  'Default external-account status carried by the signed event; NULL when absent or not parseable. Documented non-actionable statuses: errored, verification_failed, tokenized_account_number_deactivated.';

CREATE INDEX IF NOT EXISTS idx_connect_account_events_account_id
  ON public.connect_account_events (stripe_account_id, stripe_created);

CREATE OR REPLACE FUNCTION public.fn_prevent_connect_account_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'connect_account_events is append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_connect_account_events_append_only
  ON public.connect_account_events;

CREATE TRIGGER trg_connect_account_events_append_only
  BEFORE UPDATE OR DELETE ON public.connect_account_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_connect_account_event_mutation();

-- ---------------------------------------------------------------------------
-- Derived actionability by Stripe account: the projection the executor claim
-- and the account projection RPC consult.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connect_account_actionability (
  stripe_account_id TEXT PRIMARY KEY,
  is_actionable BOOLEAN NOT NULL,
  blocked_reason TEXT,
  payouts_enabled BOOLEAN,
  external_account_status TEXT,
  source_event_id TEXT,
  stripe_created TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.connect_account_actionability IS
  'Derived payout actionability per Stripe account from append-only account evidence; blocked accounts make their relevant pre-payout runs action_required, and a later actionable update resumes only the runs blocked specifically by this reason.';
COMMENT ON COLUMN public.connect_account_actionability.blocked_reason IS
  'Documented non-actionable external-account status (errored, verification_failed, tokenized_account_number_deactivated) or payouts_disabled when the account-level payouts_enabled flag is false.';
COMMENT ON COLUMN public.connect_account_actionability.stripe_created IS
  'stripe_created of the signed event that produced this projection; monotonic ordering anchor: an older (or order-ambiguous same-second restore) account event never overwrites a newer projection, and older evidence stays retained in the append-only store.';

-- ---------------------------------------------------------------------------
-- Idempotent append of signed account event evidence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_record_connect_account_event(
  p_stripe_event_id TEXT,
  p_stripe_account_id TEXT,
  p_event_type TEXT,
  p_stripe_created TIMESTAMPTZ,
  p_payouts_enabled BOOLEAN DEFAULT NULL,
  p_external_account_status TEXT DEFAULT NULL,
  p_external_account_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted BOOLEAN;
BEGIN
  IF p_event_type NOT IN (
    'account.updated',
    'account.external_account.updated'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_ACCOUNT_EVENT_TYPE';
  END IF;

  IF p_stripe_account_id IS NULL OR btrim(p_stripe_account_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_ACCOUNT_ID';
  END IF;

  INSERT INTO public.connect_account_events (
    stripe_event_id,
    stripe_account_id,
    event_type,
    stripe_created,
    received_at,
    payouts_enabled,
    external_account_status,
    external_account_id
  ) VALUES (
    p_stripe_event_id,
    p_stripe_account_id,
    p_event_type,
    p_stripe_created,
    now(),
    p_payouts_enabled,
    p_external_account_status,
    p_external_account_id
  )
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING TRUE INTO v_inserted;

  RETURN COALESCE(v_inserted, FALSE);
END;
$$;

-- ---------------------------------------------------------------------------
-- Record the derived actionability and project it onto the affected runs.
--   not actionable -> relevant pre-payout runs become action_required with the
--     account_not_actionable reason and their executor claim is cleared;
--   actionable again -> ONLY runs whose action_required state is specifically
--     account_not_actionable resume into awaiting_connected_balance with no
--     second admin decision; every other action_required state stays parked.
-- The branch on p_is_actionable is decided BEFORE any run projection, so a
-- healthy event can never demote healthy pre-payout stages, and runs fenced
-- in payout_create_in_progress are never parked by this projection.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_apply_connect_account_actionability(
  p_stripe_account_id TEXT,
  p_is_actionable BOOLEAN,
  p_blocked_reason TEXT,
  p_stripe_created TIMESTAMPTZ,
  p_payouts_enabled BOOLEAN DEFAULT NULL,
  p_external_account_status TEXT DEFAULT NULL,
  p_source_event_id TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected INTEGER;
  v_stored_created TIMESTAMPTZ;
  v_projected TEXT;
BEGIN
  IF p_stripe_account_id IS NULL OR btrim(p_stripe_account_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_ACCOUNT_ID';
  END IF;

  IF p_is_actionable IS NULL THEN
    RAISE EXCEPTION 'MISSING_ACTIONABILITY';
  END IF;

  IF p_stripe_created IS NULL THEN
    RAISE EXCEPTION 'MISSING_STRIPE_CREATED';
  END IF;

  IF NOT p_is_actionable
    AND p_blocked_reason NOT IN (
      'errored',
      'verification_failed',
      'tokenized_account_number_deactivated',
      'payouts_disabled'
    ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_BLOCKED_REASON';
  END IF;

  -- Monotonic by stripe_created: an older account event can never overwrite
  -- a newer projection, and a same-second restore is order-ambiguous (it can
  -- never beat a stored blocked state). Stale evidence stays in the
  -- append-only store; the projection ignores the stale observation.
  -- Concurrency: this pre-check is only a fast path. The authoritative
  -- serialization is the atomic conditional upsert below — Postgres takes
  -- the primary-key row lock on conflict and re-evaluates its WHERE clause
  -- against the winning row version, so two concurrent projections (or a
  -- no-state-yet insert race) can never let an older event overwrite a
  -- newer stripe_created state.
  SELECT stripe_created INTO v_stored_created
  FROM public.connect_account_actionability
  WHERE stripe_account_id = p_stripe_account_id;

  IF v_stored_created IS NOT NULL AND (
    p_stripe_created < v_stored_created
    OR (p_stripe_created = v_stored_created AND p_is_actionable)
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.connect_account_actionability (
    stripe_account_id,
    is_actionable,
    blocked_reason,
    payouts_enabled,
    external_account_status,
    source_event_id,
    stripe_created,
    updated_at
  ) VALUES (
    p_stripe_account_id,
    p_is_actionable,
    CASE WHEN p_is_actionable THEN NULL ELSE p_blocked_reason END,
    p_payouts_enabled,
    p_external_account_status,
    p_source_event_id,
    p_stripe_created,
    now()
  )
  ON CONFLICT (stripe_account_id) DO UPDATE
  SET is_actionable = EXCLUDED.is_actionable,
      blocked_reason = EXCLUDED.blocked_reason,
      payouts_enabled = EXCLUDED.payouts_enabled,
      external_account_status = EXCLUDED.external_account_status,
      source_event_id = EXCLUDED.source_event_id,
      stripe_created = EXCLUDED.stripe_created,
      updated_at = now()
  -- Atomic monotonic gate, re-evaluated under the row lock against the
  -- winning concurrent version: strictly older events are refused, and at
  -- an equal stripe_created only a stricter (blocked) state may write —
  -- a same-second restore can never restore the projection.
  WHERE public.connect_account_actionability.stripe_created < EXCLUDED.stripe_created
     OR (
          public.connect_account_actionability.stripe_created = EXCLUDED.stripe_created
          AND EXCLUDED.is_actionable = FALSE
        )
  RETURNING stripe_account_id INTO v_projected;

  -- The conditional upsert lost the race against a concurrent projection
  -- that already stored an equal-or-newer, equal-or-stricter state: keep
  -- that newer decision and skip the run projection entirely.
  IF v_projected IS NULL THEN
    RETURN 0;
  END IF;

  -- The run projection branches on the derived state FIRST: a healthy event
  -- performs only the guarded resume below (it can never demote healthy
  -- pre-payout stages or destroy the durable create fence), and a blocked
  -- event performs only the guarded park.
  IF p_is_actionable THEN
    -- Restore: only the runs parked specifically by account actionability
    -- resume automatically; other action_required states require an admin.
    -- The WHERE matches rows already parked at action_required with the
    -- exact reason and no Stripe payout, so an actionable event can never
    -- touch release_accepted, transfer_created, awaiting_connected_balance,
    -- the durable payout_create_in_progress fence, payout_pending, a
    -- terminal stage, or any other action_required reason.
    WITH affected_sellers AS (
      SELECT id
      FROM public.profiles_private
      WHERE stripe_account_id = p_stripe_account_id
    ),
    resumed AS (
      UPDATE public.connect_payout_runs cpr
      SET release_stage = 'awaiting_connected_balance',
          release_stage_version = cpr.release_stage_version + 1,
          status = CASE
            WHEN cpr.status = 'reconciliation_needed' THEN 'pending_reconciliation'
            ELSE cpr.status
          END,
          action_required_reason = NULL,
          last_error = NULL,
          next_attempt_at = NULL,
          payout_claim_token = NULL,
          payout_claim_expires_at = NULL,
          updated_at = now()
        WHERE cpr.seller_id IN (SELECT id FROM affected_sellers)
          AND cpr.action_required_reason = 'account_not_actionable'
          AND cpr.release_stage = 'action_required'
          AND cpr.stripe_payout_id IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_affected FROM resumed;
  ELSE
    -- Block: park the relevant pre-payout runs of the affected account.
    -- Safe fence handling: runs fenced in payout_create_in_progress are
    -- never parked by this webhook-driven projection — parking here would
    -- clear a live claim and destroy the durable create fence. The fence is
    -- exited only by its claim owner
    -- (fn_block_payout_run_for_account_actionability), the executor
    -- reconciliation path, or a terminal projection.
    WITH affected_sellers AS (
      SELECT id
      FROM public.profiles_private
      WHERE stripe_account_id = p_stripe_account_id
    ),
    blocked AS (
      UPDATE public.connect_payout_runs cpr
      SET release_stage = 'action_required',
          release_stage_version = cpr.release_stage_version + 1,
          status = CASE
            WHEN cpr.status = 'pending_reconciliation' THEN 'reconciliation_needed'
            ELSE cpr.status
          END,
          action_required_reason = 'account_not_actionable',
          last_error = 'account_not_actionable: ' || COALESCE(p_blocked_reason, 'unknown'),
          payout_claim_token = NULL,
          payout_claim_expires_at = NULL,
          updated_at = now()
        WHERE cpr.seller_id IN (SELECT id FROM affected_sellers)
          AND cpr.stripe_payout_id IS NULL
          AND cpr.status IN ('pending_reconciliation', 'reconciliation_needed')
          AND cpr.action_required_reason IS DISTINCT FROM 'account_not_actionable'
          AND (
            cpr.release_stage IN (
              'release_accepted',
              'transfer_created',
              'awaiting_connected_balance'
            )
            OR cpr.release_stage IS NULL
          )
      RETURNING 1
    )
    SELECT count(*) INTO v_affected FROM blocked;
  END IF;

  RETURN v_affected;
END;
$$;

COMMENT ON FUNCTION public.fn_apply_connect_account_actionability IS
  'Upserts the derived payout actionability for a Stripe account, monotonic by the signed event stripe_created through an atomic conditional upsert re-evaluated under the primary-key row lock (an older or order-ambiguous equal-stripe_created restore event never overwrites a newer projection, and a refused upsert skips the run projection), and branches on p_is_actionable BEFORE any run projection: blocked accounts park their relevant pre-payout release_accepted/transfer_created/awaiting_connected_balance runs into action_required with the account_not_actionable reason, while runs durably fenced in payout_create_in_progress are never parked by this projection — the fence is exited only by its claim owner, the reconciliation path, or a terminal projection; actionable events perform only the guarded resume of rows already parked with the exact account_not_actionable reason and can never demote healthy pre-payout stages. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- RPC-only actionability lookup for the executor worker: the worker must not
-- direct-select connect_account_actionability, whose table grants are revoked
-- from every role. Unevidenced accounts default to actionable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_get_connect_account_actionability(
  p_stripe_account_id TEXT
)
RETURNS TABLE (
  is_actionable BOOLEAN,
  blocked_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_stripe_account_id IS NULL OR btrim(p_stripe_account_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_ACCOUNT_ID';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(caa.is_actionable, TRUE),
    caa.blocked_reason
  FROM (SELECT 1) AS seed
  LEFT JOIN public.connect_account_actionability caa
    ON caa.stripe_account_id = p_stripe_account_id;
END;
$$;

COMMENT ON FUNCTION public.fn_get_connect_account_actionability IS
  'RPC-only payout actionability lookup for a Stripe account; an account with no recorded evidence defaults to actionable (is_actionable = TRUE, blocked_reason = NULL). Server-only; execution restricted to service_role — the worker must never direct-select the revoked tables.';

-- ---------------------------------------------------------------------------
-- Executor-side parking of one claimed pre-payout run behind a documented
-- non-actionable account state. Conditional on the live claim token, the
-- expected stage version, and an unexpired lease, so a stale worker can
-- neither park a newer claim nor regress a newer decision. The gate covers
-- runs awaiting balance AND runs already fenced in payout_create_in_progress:
-- parking a fenced run clears its claim so no further Stripe continuation is
-- possible from a non-actionable account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_block_payout_run_for_account_actionability(
  p_run_id UUID,
  p_claim_token TEXT,
  p_expected_stage_version INTEGER,
  p_blocked_reason TEXT
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
      status = CASE
        WHEN status = 'pending_reconciliation' THEN 'reconciliation_needed'
        ELSE status
      END,
      action_required_reason = 'account_not_actionable',
      last_error = 'account_not_actionable: ' || COALESCE(p_blocked_reason, 'unknown'),
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      AND payout_claim_token = p_claim_token
      AND release_stage_version = p_expected_stage_version
      AND payout_claim_expires_at IS NOT NULL
      AND payout_claim_expires_at > now()
      AND stripe_payout_id IS NULL
      AND release_stage IN (
        'awaiting_connected_balance',
        'payout_create_in_progress'
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;

COMMENT ON FUNCTION public.fn_block_payout_run_for_account_actionability IS
  'Parks one claimed pre-payout run (awaiting_connected_balance or payout_create_in_progress) into action_required with the account_not_actionable reason, conditional on the exact claim token, expected stage version, and an unexpired lease, so a stale worker can never park a newer claim. Server-only; execution restricted to service_role.';

-- ---------------------------------------------------------------------------
-- Access control: RLS as defense in depth, no direct table privileges for any
-- role (the SECURITY DEFINER RPCs run with their owner's privileges), and
-- EXECUTE-only RPC grants for service_role.
-- ---------------------------------------------------------------------------
ALTER TABLE public.connect_account_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_account_actionability ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.connect_account_events FROM PUBLIC;
REVOKE ALL ON public.connect_account_events FROM anon, authenticated;
REVOKE ALL ON public.connect_account_events FROM service_role;

REVOKE ALL ON public.connect_account_actionability FROM PUBLIC;
REVOKE ALL ON public.connect_account_actionability FROM anon, authenticated;
REVOKE ALL ON public.connect_account_actionability FROM service_role;

REVOKE ALL ON FUNCTION public.fn_prevent_connect_account_event_mutation FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prevent_connect_account_event_mutation FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_record_connect_account_event FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_record_connect_account_event FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_apply_connect_account_actionability FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_apply_connect_account_actionability FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_get_connect_account_actionability FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_connect_account_actionability FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_block_payout_run_for_account_actionability FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_block_payout_run_for_account_actionability FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_record_connect_account_event TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_apply_connect_account_actionability TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_connect_account_actionability TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_block_payout_run_for_account_actionability TO service_role;

COMMIT;
