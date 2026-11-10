CREATE OR REPLACE FUNCTION public.fn_defer_awaiting_balance_run (
  p_run_id                 uuid,
  p_claim_token            text,
  p_expected_stage_version integer,
  p_backoff_seconds        integer
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_defer_awaiting_balance_run"(uuid, text, integer, integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_defer_awaiting_balance_run"(uuid, text, integer, integer) IS 'Defers an awaiting-balance run whose connected available balance is insufficient: bounded backoff sets next_attempt_at, increments the attempt count, and clears the claim so the current batch cannot re-claim it and newer eligible runs keep progressing. Conditional on the exact claim token, the expected stage version, and an unexpired lease so a stale worker cannot defer a newer claim. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_defer_awaiting_balance_run"(uuid, text, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_defer_awaiting_balance_run"(uuid, text, integer, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_defer_awaiting_balance_run"(uuid, text, integer, integer) FROM PUBLIC, "anon", "authenticated";
