-- Current connected-account MXN destination projection. Apply after the
-- account-actionability and balance-executor migrations. The canonical copy
-- supabase/queries/payments/connect_account_current_state.sql is byte-identical.
--
-- Caller protocol: append immutable signed evidence; acquire and COMMIT this
-- short RPC; retrieve the bound Stripe account and ALL paginated bank accounts
-- outside any database transaction; commit the snapshot with the returned
-- generation and the SAME trigger event id. Never hold a transaction over HTTP.
-- Retrieval/validation failure leaves pending fail-closed for webhook retry.
-- Generation orders Selene writes, NOT Stripe mutations: Stripe can change
-- between retrieval and acceptance, so there remains a provider freshness window.
-- This migration alone fences the old webhook; deploy the A3 adapter before
-- expecting refresh recovery. It does not retry parents or create money movement.

BEGIN;

ALTER TABLE public.connect_account_actionability
  ADD COLUMN refresh_generation BIGINT NOT NULL DEFAULT 0 CHECK (refresh_generation >= 0),
  ADD COLUMN refresh_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN current_external_account_id TEXT,
  ADD COLUMN current_observed_at TIMESTAMPTZ,
  ADD COLUMN current_currency TEXT,
  ADD COLUMN current_default_for_currency BOOLEAN,
  ADD COLUMN current_mxn_default_count INTEGER;

-- Defaults do not change any existing healthy/blocked projection or park. A
-- never-refreshed account retains legacy/no-evidence compatibility until acquire.
COMMENT ON COLUMN public.connect_account_actionability.refresh_generation IS
  'Monotonic per-account Selene refresh epoch, not Stripe mutation ordering. Zero means legacy projection; only acquire increments it.';
COMMENT ON COLUMN public.connect_account_actionability.refresh_pending IS
  'Acquire sets TRUE and is_actionable FALSE before network reads. Failed retrieval remains pending; only a current-generation commit clears it.';
COMMENT ON COLUMN public.connect_account_actionability.source_event_id IS
  'Signed Stripe trigger event identity bound to this account and refresh generation, NOT current destination identity. A duplicate trigger may acquire another generation.';
COMMENT ON COLUMN public.connect_account_actionability.stripe_created IS
  'Occurrence timestamp of the signed trigger event, copied from immutable evidence. Provenance only after generation adoption; never current-state ordering or observation time.';
COMMENT ON COLUMN public.connect_account_actionability.current_external_account_id IS
  'Current server-retrieved MXN default bank identity; distinct from the historical bank in connect_account_events. Usable only when refresh_pending is FALSE.';
COMMENT ON COLUMN public.connect_account_actionability.current_observed_at IS
  'Database receipt time of the last accepted server snapshot, not Stripe event creation or a claimed Stripe mutation time. Prior snapshot remains historical while pending.';
COMMENT ON TABLE public.connect_account_actionability IS
  'Payout gate: legacy compatibility until refreshed, then generation-fenced current Stripe MXN destination snapshots with fail-closed pending refreshes. Signed evidence stays separate and immutable.';

ALTER TABLE public.connect_account_events
  DROP CONSTRAINT connect_account_events_event_type_check,
  ADD CONSTRAINT connect_account_events_event_type_check CHECK (event_type IN (
    'account.updated', 'account.external_account.created',
    'account.external_account.updated', 'account.external_account.deleted'
  ));
COMMENT ON COLUMN public.connect_account_events.stripe_event_id IS
  'Immutable signed event identity. Duplicate evidence stays unchanged, but webhook retry must re-read current state under a new refresh generation.';
COMMENT ON COLUMN public.connect_account_events.external_account_status IS
  'Historical bank status extracted from the signed event. An external-account event may concern an old or non-default bank; this field is never the current destination authority.';

-- Signature/return type retained for existing append callers and deployed types.
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
  v_account_id TEXT;
BEGIN
  IF p_stripe_account_id IS NULL OR p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_STRIPE_ACCOUNT_ID';
  END IF;
  IF p_stripe_event_id IS NULL OR p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_EVENT_ID';
  END IF;
  IF p_event_type IS NULL OR p_event_type NOT IN (
    'account.updated', 'account.external_account.created',
    'account.external_account.updated', 'account.external_account.deleted'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_ACCOUNT_EVENT_TYPE';
  END IF;
  IF p_stripe_created IS NULL OR NOT isfinite(p_stripe_created) THEN
    RAISE EXCEPTION 'MISSING_STRIPE_CREATED';
  END IF;

  INSERT INTO public.connect_account_events (
    stripe_event_id, stripe_account_id, event_type, stripe_created,
    payouts_enabled, external_account_status, external_account_id
  ) VALUES (
    p_stripe_event_id, p_stripe_account_id, p_event_type, p_stripe_created,
    p_payouts_enabled, p_external_account_status, p_external_account_id
  )
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING TRUE INTO v_inserted;

  IF v_inserted IS TRUE THEN
    RETURN TRUE;
  END IF;
  -- A second statement sees the winning concurrent insert at READ COMMITTED.
  -- If unavailable under another isolation level, reject rather than misbind.
  SELECT cae.stripe_account_id INTO v_account_id
  FROM public.connect_account_events cae
  WHERE cae.stripe_event_id = p_stripe_event_id;
  IF v_account_id IS DISTINCT FROM p_stripe_account_id THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_acquire_connect_account_refresh(
  p_stripe_account_id TEXT,
  p_source_event_id TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trigger_created TIMESTAMPTZ;
  v_generation BIGINT;
BEGIN
  IF p_stripe_account_id IS NULL OR p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_STRIPE_ACCOUNT_ID';
  END IF;
  IF p_source_event_id IS NULL OR p_source_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_EVENT_ID';
  END IF;
  SELECT cae.stripe_created INTO v_trigger_created
  FROM public.connect_account_events cae
  WHERE cae.stripe_event_id = p_source_event_id
    AND cae.stripe_account_id = p_stripe_account_id;
  IF v_trigger_created IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;

  -- The PK upsert serializes even two first-ever acquisitions. Overflow raises
  -- rather than wrapping. No run lock and no network operation in acquisition.
  INSERT INTO public.connect_account_actionability (
    stripe_account_id, is_actionable, blocked_reason, stripe_created,
    source_event_id, refresh_generation, refresh_pending
  ) VALUES (
    p_stripe_account_id, FALSE, 'account_refresh_pending', v_trigger_created,
    p_source_event_id, 1, TRUE
  )
  ON CONFLICT (stripe_account_id) DO UPDATE
  SET refresh_generation = public.connect_account_actionability.refresh_generation + 1,
      refresh_pending = TRUE,
      is_actionable = FALSE,
      blocked_reason = 'account_refresh_pending',
      source_event_id = EXCLUDED.source_event_id,
      stripe_created = EXCLUDED.stripe_created,
      updated_at = clock_timestamp()
  RETURNING refresh_generation INTO v_generation;

  -- Setting the bit FALSE also fences the existing SQL claim eligibility join,
  -- which reads is_actionable directly. Existing runs are not changed here.
  RETURN v_generation;
END;
$$;

-- No defaults: caller must explicitly provide every current snapshot field.
-- p_mxn_default_count counts defaults across the COMPLETE paginated bank list.
-- If missing/ambiguous, pass NULL destination fields and count 0/>1. The SQL
-- boundary verifies internal consistency, not the authenticity of Stripe IO;
-- retrieval, pagination and bank/account identity binding remain server duties.
CREATE OR REPLACE FUNCTION public.fn_commit_connect_account_refresh(
  p_stripe_account_id TEXT,
  p_expected_generation BIGINT,
  p_source_event_id TEXT,
  p_is_actionable BOOLEAN,
  p_blocked_reason TEXT,
  p_payouts_enabled BOOLEAN,
  p_current_external_account_id TEXT,
  p_current_external_account_status TEXT,
  p_current_currency TEXT,
  p_current_default_for_currency BOOLEAN,
  p_mxn_default_count INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_destination BOOLEAN;
  v_actionable BOOLEAN := FALSE;
  v_blocked_reason TEXT := 'destination_undetermined';
  v_projected TEXT;
BEGIN
  IF p_stripe_account_id IS NULL OR p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_STRIPE_ACCOUNT_ID';
  END IF;
  IF p_source_event_id IS NULL OR p_source_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_EVENT_ID';
  END IF;
  IF p_expected_generation IS NULL OR p_expected_generation <= 0 THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.connect_account_events cae
    WHERE cae.stripe_event_id = p_source_event_id
      AND cae.stripe_account_id = p_stripe_account_id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;

  v_has_destination := COALESCE(
    p_mxn_default_count = 1
    AND p_current_external_account_id ~ '^ba_[A-Za-z0-9]+$'
    AND p_current_currency = 'mxn'
    AND p_current_default_for_currency IS TRUE,
    FALSE
  );
  IF p_mxn_default_count IS NOT NULL AND p_mxn_default_count < 0 THEN
    RAISE EXCEPTION 'INVALID_CURRENT_ACCOUNT_SNAPSHOT';
  END IF;
  IF NOT v_has_destination AND (
    p_current_external_account_id IS NOT NULL
    OR p_current_external_account_status IS NOT NULL
    OR p_current_currency IS NOT NULL
    OR p_current_default_for_currency IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_CURRENT_ACCOUNT_SNAPSHOT';
  END IF;

  -- Reconstruct the gate rather than trusting a service-role healthy bit.
  -- Only explicit true plus one known healthy MXN default can enable payouts.
  IF p_payouts_enabled IS FALSE THEN
    v_blocked_reason := 'payouts_disabled';
  ELSIF v_has_destination AND p_current_external_account_status IN (
    'errored', 'verification_failed', 'tokenized_account_number_deactivated'
  ) THEN
    v_blocked_reason := p_current_external_account_status;
  ELSIF p_payouts_enabled IS TRUE AND v_has_destination
    AND p_current_external_account_status IN ('new', 'validated', 'verified') THEN
    v_actionable := TRUE;
    v_blocked_reason := NULL;
  END IF;
  IF p_is_actionable IS DISTINCT FROM v_actionable
    OR p_blocked_reason IS DISTINCT FROM v_blocked_reason THEN
    RAISE EXCEPTION 'INVALID_CURRENT_ACCOUNT_SNAPSHOT';
  END IF;

  -- Atomic CAS acquires the account lock BEFORE any run projection. A replay
  -- of an already accepted generation, superseded read, or wrong trigger loses
  -- without clearing another refresh's pending flag. No Stripe timestamp gate.
  UPDATE public.connect_account_actionability caa
  SET is_actionable = v_actionable,
      blocked_reason = v_blocked_reason,
      payouts_enabled = p_payouts_enabled,
      external_account_status = p_current_external_account_status,
      current_external_account_id = p_current_external_account_id,
      current_currency = p_current_currency,
      current_default_for_currency = p_current_default_for_currency,
      current_mxn_default_count = p_mxn_default_count,
      current_observed_at = clock_timestamp(),
      refresh_pending = FALSE,
      updated_at = clock_timestamp()
  WHERE caa.stripe_account_id = p_stripe_account_id
    AND caa.refresh_generation = p_expected_generation
    AND caa.refresh_pending IS TRUE
    AND caa.source_event_id = p_source_event_id
  RETURNING caa.stripe_account_id INTO v_projected;
  IF v_projected IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Lock relevant runs in ID order after the account row. Claim RPCs lock only
  -- runs and read the account via MVCC (no reverse account lock), so there is
  -- no account/run lock cycle. No lock survives this short RPC transaction.
  PERFORM cpr.id
  FROM public.connect_payout_runs cpr
  WHERE cpr.seller_id IN (
    SELECT pp.id FROM public.profiles_private pp
    WHERE pp.stripe_account_id = p_stripe_account_id
  )
    AND cpr.status IN ('pending_reconciliation', 'reconciliation_needed')
    AND cpr.stripe_payout_id IS NULL
    AND (
      (v_actionable AND cpr.release_stage = 'action_required'
        AND cpr.action_required_reason = 'account_not_actionable')
      OR (NOT v_actionable
        AND cpr.action_required_reason IS DISTINCT FROM 'account_not_actionable'
        AND (cpr.release_stage IN (
          'release_accepted', 'transfer_created', 'awaiting_connected_balance'
        ) OR cpr.release_stage IS NULL))
    )
  ORDER BY cpr.id
  FOR UPDATE OF cpr;

  IF v_actionable THEN
    -- Exact reason-gated pre-payout resume only. The explicit status gate also
    -- excludes a failed parent even if its park reason/stage survived a failure.
    UPDATE public.connect_payout_runs cpr
    SET release_stage = 'awaiting_connected_balance',
        release_stage_version = cpr.release_stage_version + 1,
        status = CASE WHEN cpr.status = 'reconciliation_needed'
          THEN 'pending_reconciliation' ELSE cpr.status END,
        action_required_reason = NULL,
        last_error = NULL,
        next_attempt_at = NULL,
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
    WHERE cpr.seller_id IN (
      SELECT pp.id FROM public.profiles_private pp
      WHERE pp.stripe_account_id = p_stripe_account_id
    )
      AND cpr.status IN ('pending_reconciliation', 'reconciliation_needed')
      AND cpr.action_required_reason = 'account_not_actionable'
      AND cpr.release_stage = 'action_required'
      AND cpr.stripe_payout_id IS NULL;
  ELSE
    -- Runs fenced in payout_create_in_progress are never parked by webhook
    -- projection. Only their live claim owner/terminal reconciliation can exit
    -- that fence via the existing narrowly guarded RPCs, unchanged here.
    UPDATE public.connect_payout_runs cpr
    SET release_stage = 'action_required',
        release_stage_version = cpr.release_stage_version + 1,
        status = CASE WHEN cpr.status = 'pending_reconciliation'
          THEN 'reconciliation_needed' ELSE cpr.status END,
        action_required_reason = 'account_not_actionable',
        last_error = 'account_not_actionable: ' || v_blocked_reason,
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
    WHERE cpr.seller_id IN (
      SELECT pp.id FROM public.profiles_private pp
      WHERE pp.stripe_account_id = p_stripe_account_id
    )
      AND cpr.stripe_payout_id IS NULL
      AND cpr.status IN ('pending_reconciliation', 'reconciliation_needed')
      AND cpr.action_required_reason IS DISTINCT FROM 'account_not_actionable'
      AND (cpr.release_stage IN (
        'release_accepted', 'transfer_created', 'awaiting_connected_balance'
      ) OR cpr.release_stage IS NULL);
  END IF;
  -- Acceptance is observable even if no eligible runs needed a change.
  RETURN TRUE;
END;
$$;

-- Only production legacy caller audited: stripe-webhooks/index.ts. Keep its
-- exact signature and INTEGER return contract, but never allow event-time
-- projection to overwrite a current snapshot or bypass pending. A3 replaces it.
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
BEGIN
  RAISE EXCEPTION 'ACCOUNT_REFRESH_REQUIRED';
END;
$$;
COMMENT ON FUNCTION public.fn_apply_connect_account_actionability IS
  'Legacy event-time projection fenced with ACCOUNT_REFRESH_REQUIRED. Use separately committed acquire, authoritative paginated retrieval, and current-generation commit; never enable from signed historic bank state.';

-- Keep return shape for deployed release/worker clients. Pending supplies a
-- non-null reason as well as FALSE because the worker gates on blocked_reason.
CREATE OR REPLACE FUNCTION public.fn_get_connect_account_actionability(
  p_stripe_account_id TEXT
)
RETURNS TABLE (is_actionable BOOLEAN, blocked_reason TEXT)
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
    CASE WHEN caa.refresh_pending THEN FALSE
      ELSE COALESCE(caa.is_actionable, TRUE) END,
    CASE WHEN caa.refresh_pending THEN 'account_refresh_pending'::TEXT
      ELSE caa.blocked_reason END
  FROM (SELECT 1) AS seed
  LEFT JOIN public.connect_account_actionability caa
    ON caa.stripe_account_id = p_stripe_account_id;
END;
$$;
COMMENT ON FUNCTION public.fn_get_connect_account_actionability IS
  'RPC-only payout gate, pending refresh returns FALSE/account_refresh_pending, including after retrieval error. Existing no-row TRUE compatibility is preserved; existing blocked rows are never bulk-enabled.';

-- Existing executor-owned fn_block_payout_run_for_account_actionability stays
-- unchanged: live token + version + lease gates its own fenced-run parking.
ALTER TABLE public.connect_account_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_account_actionability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.connect_account_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.connect_account_actionability FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_acquire_connect_account_refresh(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_acquire_connect_account_refresh(TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acquire_connect_account_refresh(TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_commit_connect_account_refresh(TEXT, BIGINT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_commit_connect_account_refresh(TEXT, BIGINT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_commit_connect_account_refresh(TEXT, BIGINT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, INTEGER) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_record_connect_account_event(TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_record_connect_account_event(TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_connect_account_event(TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_apply_connect_account_actionability(TEXT, BOOLEAN, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_apply_connect_account_actionability(TEXT, BOOLEAN, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_connect_account_actionability(TEXT, BOOLEAN, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_get_connect_account_actionability(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_connect_account_actionability(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_connect_account_actionability(TEXT) TO service_role;

COMMIT;
