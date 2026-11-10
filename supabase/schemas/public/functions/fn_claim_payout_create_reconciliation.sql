CREATE OR REPLACE FUNCTION public.fn_claim_payout_create_reconciliation (
  p_grace_seconds integer DEFAULT 600
)
  RETURNS TABLE (
    run_id                     uuid,
    actor_id                   uuid,
    seller_id                  uuid,
    amount_cents               integer,
    idempotency_key            text,
    stripe_account_id          text,
    payout_create_attempted_at timestamp with time zone,
    claim_token                text,
    stage_version              integer,
    claim_expires_at           timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_payout_create_reconciliation"(integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_claim_payout_create_reconciliation"(integer) IS 'Claims one stale payout_create_in_progress run (Stripe create attempt older than the bounded grace window, unclaimed or expired lease) so the worker reconciles the Stripe outcome by server-side listing in the connected-account context; it must never create a second payout. The claim mints a fresh token and bumps the stage version, so a lapsed holder can no longer complete or abort the fence. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_claim_payout_create_reconciliation"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_payout_create_reconciliation"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_payout_create_reconciliation"(integer) FROM PUBLIC, "anon", "authenticated";
