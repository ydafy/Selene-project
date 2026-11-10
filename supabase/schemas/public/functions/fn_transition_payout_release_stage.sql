CREATE OR REPLACE FUNCTION public.fn_transition_payout_release_stage (
  p_run_id                 uuid,
  p_target_stage           text,
  p_expected_stage_version integer,
  p_claim_token            text    DEFAULT NULL::text,
  p_last_error             text    DEFAULT NULL::text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_transition_payout_release_stage"(uuid, text, integer, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_transition_payout_release_stage"(uuid, text, integer, text, text) IS 'Guarded stage transition: rejects unknown stages, stale claim tokens, lapsed leases, stale stage versions, and terminal/action_required regressions; bumps the version monotonically and clears the executor claim. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_transition_payout_release_stage"(uuid, text, integer, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_transition_payout_release_stage"(uuid, text, integer, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_transition_payout_release_stage"(uuid, text, integer, text, text) FROM PUBLIC, "anon", "authenticated";
