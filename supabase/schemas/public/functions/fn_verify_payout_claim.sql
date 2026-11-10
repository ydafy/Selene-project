CREATE OR REPLACE FUNCTION public.fn_verify_payout_claim (
  p_run_id                 uuid,
  p_claim_token            text,
  p_expected_stage_version integer
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_verify_payout_claim"(uuid, text, integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_verify_payout_claim"(uuid, text, integer) IS 'Proves a still-live executor claim before a Stripe call or DB transition: the exact claim token must match, the lease must be unexpired, and the monotonic stage version must equal the expected one; raises STALE_CLAIM, CLAIM_LEASE_EXPIRED, or STAGE_VERSION_CONFLICT otherwise. Read-only. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_verify_payout_claim"(uuid, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_verify_payout_claim"(uuid, text, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_verify_payout_claim"(uuid, text, integer) FROM PUBLIC, "anon", "authenticated";
