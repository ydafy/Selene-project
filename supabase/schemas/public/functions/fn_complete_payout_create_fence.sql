CREATE OR REPLACE FUNCTION public.fn_complete_payout_create_fence (
  p_run_id                 uuid,
  p_expected_stage_version integer,
  p_stripe_payout_id       text,
  p_claim_token            text    DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_updated BOOLEAN;
BEGIN
  IF p_stripe_payout_id IS NULL OR btrim(p_stripe_payout_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_PAYOUT_ID';
  END IF;

  UPDATE public.connect_payout_runs
  SET stripe_payout_id = COALESCE(stripe_payout_id, p_stripe_payout_id),
      release_stage = CASE
        WHEN release_stage IN (
          'payout_pending',
          'payout_in_transit',
          'paid_observed',
          'payout_failed',
          'payout_canceled'
        ) THEN release_stage
        ELSE 'payout_pending'
      END,
      release_stage_version = release_stage_version + 1,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Version-conditional: a webhook that already projected a later stage
      -- or a terminal outcome has bumped the version, so a stale completion
      -- is rejected instead of regressing the aggregate.
      AND release_stage_version = p_expected_stage_version
      -- Token-conditional when the caller holds an executor claim; the
      -- manual release path passes NULL and owns the run through the
      -- version-conditioned payout_create_in_progress fence stage alone.
      -- The executor-owned exit also requires an unexpired lease: a worker
      -- whose lease lapsed mid-flight must not mutate the fenced run.
      AND (
        p_claim_token IS NULL
        OR (
          payout_claim_token = p_claim_token
          AND payout_claim_expires_at > now()
        )
      )
      AND release_stage IN (
        'payout_create_in_progress',
        'payout_pending',
        'payout_in_transit',
        'paid_observed',
        'payout_failed',
        'payout_canceled'
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_complete_payout_create_fence"(uuid, integer, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_complete_payout_create_fence"(uuid, integer, text, text) IS 'Exits the payout create fence with the authoritative Stripe payout id: attaches it when absent, advances payout_create_in_progress to payout_pending, and never regresses a later webhook stage or terminal projection. Returns FALSE when a webhook already consumed the claim or version, so the worker must not write pending state. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_complete_payout_create_fence"(uuid, integer, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_complete_payout_create_fence"(uuid, integer, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_complete_payout_create_fence"(uuid, integer, text, text) FROM PUBLIC, "anon", "authenticated";
