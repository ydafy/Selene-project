CREATE OR REPLACE FUNCTION public.fn_park_payout_run_from_fence (
  p_run_id                 uuid,
  p_expected_stage_version integer
)
  RETURNS TABLE (
    outcome       text,
    stage_version integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_account_id TEXT;
  v_refresh_pending BOOLEAN;
  v_is_actionable BOOLEAN;
  v_blocked_reason TEXT;
  v_stage TEXT;
  v_version INTEGER;
  v_token TEXT;
  v_payout_id TEXT;
  v_status TEXT;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  -- seller_id never changes on a run, so the account can be read before any
  -- lock is taken.
  SELECT pp.stripe_account_id
  INTO v_account_id
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  WHERE cpr.id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_STRIPE_ACCOUNT_ID';
  END IF;

  -- Account row first, then the run: the same order as
  -- fn_commit_connect_account_refresh, so the two never deadlock. FOR SHARE
  -- blocks a refresh acquire or commit (both write the row) until this
  -- transaction ends, so the state read here is the state the run is parked
  -- or requeued under, while parks of other runs of the same account do not
  -- wait on each other. A missing row (no refresh yet) counts as actionable,
  -- as in fn_get_connect_account_actionability.
  SELECT caa.refresh_pending, caa.is_actionable, caa.blocked_reason
  INTO v_refresh_pending, v_is_actionable, v_blocked_reason
  FROM internal.connect_account_actionability caa
  WHERE caa.stripe_account_id = v_account_id
  FOR SHARE;

  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token,
    cpr.stripe_payout_id, cpr.status
  INTO v_stage, v_version, v_token, v_payout_id, v_status
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  -- Only the manual fence owner may exit this way: a held claim belongs to
  -- the worker, which exits through its own claim-conditioned RPCs.
  IF v_token IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUTOR_CLAIM_HELD';
  END IF;
  IF p_expected_stage_version IS NULL OR v_version <> p_expected_stage_version THEN
    RAISE EXCEPTION 'STAGE_VERSION_CONFLICT';
  END IF;
  IF v_stage IS DISTINCT FROM 'payout_create_in_progress'
    OR v_payout_id IS NOT NULL
    OR v_status <> 'pending_reconciliation' THEN
    RAISE EXCEPTION 'PAYOUT_CREATE_FENCE_CONFLICT';
  END IF;

  IF COALESCE(v_refresh_pending, FALSE) OR NOT COALESCE(v_is_actionable, TRUE) THEN
    -- Parked exactly as fn_block_payout_run_for_account_actionability parks,
    -- so an actionable fn_commit_connect_account_refresh resumes it. The
    -- mappings stay pending_reconciliation for the worker claim gate.
    UPDATE public.connect_payout_runs
    SET release_stage = 'action_required',
        release_stage_version = v_version + 1,
        status = 'reconciliation_needed',
        action_required_reason = 'account_not_actionable',
        last_error = 'account_not_actionable: ' || CASE
          WHEN COALESCE(v_refresh_pending, FALSE) THEN 'account_refresh_pending'
          ELSE COALESCE(v_blocked_reason, 'unknown')
        END,
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
      WHERE id = p_run_id;

    RETURN QUERY SELECT 'parked'::TEXT, v_version + 1;
    RETURN;
  END IF;

  -- The account became actionable before this lock (a refresh committed after
  -- the caller's check): requeue as the commit's resume does, so
  -- resume-pending-payouts creates the payout.
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

  RETURN QUERY SELECT 'requeued'::TEXT, v_version + 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_park_payout_run_from_fence"(uuid, integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_park_payout_run_from_fence"(uuid, integer) IS 'Manual fence exit when the seller account is not actionable at payout-create time: locks the connect_account_actionability row, then the run, and requires payout_create_in_progress, the exact stage version, no claim, no Stripe payout and pending_reconciliation. A refresh-pending or non-actionable account parks the run in action_required (account_not_actionable) for fn_commit_connect_account_refresh to resume; an actionable account requeues it to awaiting_connected_balance. Shipment mappings stay pending_reconciliation. Returns the outcome (parked or requeued) and the new stage version. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_park_payout_run_from_fence"(uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_park_payout_run_from_fence"(uuid, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_park_payout_run_from_fence"(uuid, integer) FROM PUBLIC, "anon", "authenticated";
