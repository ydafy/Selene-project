CREATE OR REPLACE FUNCTION public.fn_commit_connect_account_refresh (
  p_stripe_account_id               text,
  p_expected_generation             bigint,
  p_source_event_id                 text,
  p_is_actionable                   boolean,
  p_blocked_reason                  text,
  p_payouts_enabled                 boolean,
  p_current_external_account_id     text,
  p_current_external_account_status text,
  p_current_currency                text,
  p_current_default_for_currency    boolean,
  p_mxn_default_count               integer,
  p_payout_schedule_interval        text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
    SELECT 1 FROM internal.connect_account_events cae
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
  -- Only explicit true, a manual payout schedule and one known healthy MXN
  -- default can enable payouts. Any other schedule, or none in the snapshot,
  -- would let Stripe pay the seller before Selene releases funds (#330 S4).
  IF p_payouts_enabled IS FALSE THEN
    v_blocked_reason := 'payouts_disabled';
  ELSIF p_payout_schedule_interval IS DISTINCT FROM 'manual' THEN
    v_blocked_reason := 'payouts_schedule_not_manual';
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
  UPDATE internal.connect_account_actionability caa
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_commit_connect_account_refresh"(text, bigint, text, boolean, text, boolean, text, text, text, boolean, integer, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_commit_connect_account_refresh"(text, bigint, text, boolean, text, boolean, text, text, text, boolean, integer, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_commit_connect_account_refresh"(text, bigint, text, boolean, text, boolean, text, text, text, boolean, integer, text) TO "postgres";

REVOKE ALL
  ON FUNCTION "public"."fn_commit_connect_account_refresh"(text, bigint, text, boolean, text, boolean, text, text, text, boolean, integer, text)
  FROM PUBLIC, "anon", "authenticated";
