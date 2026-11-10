CREATE OR REPLACE FUNCTION public.fn_begin_payout_create_fence (
  p_run_id                 uuid,
  p_claim_token            text,
  p_expected_stage_version integer
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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

  IF p_claim_token IS NULL OR v_token IS NULL OR v_token <> p_claim_token THEN
    RAISE EXCEPTION 'STALE_CLAIM';
  END IF;

  -- A lapsed lease means the worker lost durable ownership: it must abort
  -- without opening the fence, and the Stripe create must never run.
  IF v_expires IS NULL OR v_expires <= now() THEN
    RAISE EXCEPTION 'CLAIM_LEASE_EXPIRED';
  END IF;

  IF p_expected_stage_version IS NULL OR v_version <> p_expected_stage_version THEN
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_begin_payout_create_fence"(uuid, text, integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_begin_payout_create_fence"(uuid, text, integer) IS 'Durable write-ahead fence before a Stripe payout create: claims the run into payout_create_in_progress with payout_create_attempted_at, token-, version-, and lease-conditional, so a crash after the Stripe call leaves a recoverable fence instead of a duplicate-create window. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_begin_payout_create_fence"(uuid, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_begin_payout_create_fence"(uuid, text, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_begin_payout_create_fence"(uuid, text, integer) FROM PUBLIC, "anon", "authenticated";
