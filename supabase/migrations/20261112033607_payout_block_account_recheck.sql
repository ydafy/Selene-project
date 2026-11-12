-- #352 (odd/tasks/payout-fence-account-park.md S5): resume-pending-payouts reads
-- the seller's actionability without a lock before calling this park. A refresh
-- that commits "actionable" in between used to leave the run parked until the
-- next account event, because fn_commit_connect_account_refresh resumes only
-- runs already in action_required. The function now locks the account's
-- connect_account_actionability row (FOR SHARE) before the run, the same order
-- as fn_commit_connect_account_refresh and fn_park_payout_run_from_fence, and
-- parks only while the account is still refresh-pending or not actionable;
-- otherwise it requeues the run to awaiting_connected_balance and returns FALSE.
-- Signature and return type are unchanged. Grants are unchanged: EXECUTE stays
-- with service_role only (the resume-pending-payouts worker), never PUBLIC,
-- anon or authenticated.

SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fn_block_payout_run_for_account_actionability (
  p_run_id                 uuid,
  p_claim_token            text,
  p_expected_stage_version integer,
  p_blocked_reason         text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_account_id TEXT;
  v_refresh_pending BOOLEAN;
  v_is_actionable BOOLEAN;
  v_stage TEXT;
  v_version INTEGER;
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_payout_id TEXT;
BEGIN
  -- seller_id never changes on a run, so the account can be read before any
  -- lock is taken.
  SELECT pp.stripe_account_id
  INTO v_account_id
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  WHERE cpr.id = p_run_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- The worker read actionability without a lock. Lock the account row first,
  -- then the run: the same order as fn_commit_connect_account_refresh and
  -- fn_park_payout_run_from_fence, so they never deadlock. FOR SHARE blocks a
  -- refresh acquire or commit until this transaction ends, so the state read
  -- here is the state the run is parked or requeued under. A missing row (no
  -- refresh yet) counts as actionable, as in fn_get_connect_account_actionability.
  -- A seller without a Stripe account has no row to lock and is parked as before.
  IF v_account_id IS NOT NULL THEN
    SELECT caa.refresh_pending, caa.is_actionable
    INTO v_refresh_pending, v_is_actionable
    FROM public.connect_account_actionability caa
    WHERE caa.stripe_account_id = v_account_id
    FOR SHARE;
  END IF;

  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token,
    cpr.payout_claim_expires_at, cpr.stripe_payout_id
  INTO v_stage, v_version, v_token, v_expires_at, v_payout_id
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  -- Only the live claim of the expected version may move the run, so a stale
  -- worker can never park or requeue a newer claim.
  IF v_token IS NULL OR v_token IS DISTINCT FROM p_claim_token
    OR v_version IS DISTINCT FROM p_expected_stage_version
    OR v_expires_at IS NULL OR v_expires_at <= now()
    OR v_payout_id IS NOT NULL
    OR v_stage IS NULL
    OR v_stage NOT IN ('awaiting_connected_balance', 'payout_create_in_progress') THEN
    RETURN FALSE;
  END IF;

  IF v_account_id IS NULL
    OR COALESCE(v_refresh_pending, FALSE)
    OR NOT COALESCE(v_is_actionable, TRUE) THEN
    UPDATE public.connect_payout_runs
    SET release_stage = 'action_required',
        release_stage_version = v_version + 1,
        status = CASE
          WHEN status = 'pending_reconciliation' THEN 'reconciliation_needed'
          ELSE status
        END,
        action_required_reason = 'account_not_actionable',
        last_error = 'account_not_actionable: ' || COALESCE(p_blocked_reason, 'unknown'),
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
      WHERE id = p_run_id;

    RETURN TRUE;
  END IF;

  -- The account became actionable after the worker's read (a refresh committed
  -- in between): requeue as fn_park_payout_run_from_fence does, so the worker
  -- claims the run again instead of leaving it parked until the next account
  -- event. Shipment mappings stay pending_reconciliation.
  UPDATE public.connect_payout_runs
  SET release_stage = 'awaiting_connected_balance',
      release_stage_version = v_version + 1,
      status = 'pending_reconciliation',
      action_required_reason = NULL,
      last_error = NULL,
      next_attempt_at = NULL,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id;

  RETURN FALSE;
END;
$function$;

COMMENT ON FUNCTION "public"."fn_block_payout_run_for_account_actionability"(uuid, text, integer, text) IS 'Worker exit when the seller account looked not actionable: locks the connect_account_actionability row, then the run, and requires the exact claim token, the expected stage version, an unexpired lease, no Stripe payout and awaiting_connected_balance or payout_create_in_progress, so a stale worker can never move a newer claim. A refresh-pending or non-actionable account (or no Stripe account) parks the run in action_required (account_not_actionable) and returns TRUE. An account that is actionable at lock time requeues the run to awaiting_connected_balance (pending_reconciliation, claim cleared) and returns FALSE; a refused call also returns FALSE and writes nothing. Shipment mappings never change. Server-only; execution restricted to service_role.';
