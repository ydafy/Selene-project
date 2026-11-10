CREATE OR REPLACE FUNCTION public.fn_fail_payout_create_from_fence (
  p_run_id                 uuid,
  p_expected_stage_version integer,
  p_failure_reason         text,
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
  UPDATE public.connect_payout_runs
  SET release_stage = 'payout_failed',
      release_stage_version = release_stage_version + 1,
      status = 'failed',
      failure_reason = p_failure_reason,
      failed_at = now(),
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Token-conditional when the caller holds an executor claim; the manual
      -- release path passes NULL and is owned by the version-conditioned
      -- payout_create_in_progress fence stage.
      AND (
        p_claim_token IS NULL
        OR (
          payout_claim_token = p_claim_token
          AND payout_claim_expires_at > now()
        )
      )
      AND release_stage_version = p_expected_stage_version
      AND release_stage = 'payout_create_in_progress'
      AND stripe_payout_id IS NULL
  RETURNING TRUE INTO v_updated;

  IF v_updated THEN
    -- The aggregate and its shipment mappings move together: a definitive
    -- Stripe rejection maps the run's pending mappings to failed.
    UPDATE public.connect_payout_run_shipments
    SET status = 'failed',
        updated_at = now()
      WHERE run_id = p_run_id
        AND status IN ('pending_reconciliation');
  END IF;

  RETURN COALESCE(v_updated, FALSE);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_fail_payout_create_from_fence"(uuid, integer, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_fail_payout_create_from_fence"(uuid, integer, text, text) IS 'Records a definitive Stripe payout create rejection from inside the fence: the run takes Phase 2A failed semantics (no payout object was created), the claim clears, and the admin retry flow remains authoritative. Token- and version-conditional. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_fail_payout_create_from_fence"(uuid, integer, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_fail_payout_create_from_fence"(uuid, integer, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_fail_payout_create_from_fence"(uuid, integer, text, text) FROM PUBLIC, "anon", "authenticated";
