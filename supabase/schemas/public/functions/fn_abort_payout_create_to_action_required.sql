CREATE OR REPLACE FUNCTION public.fn_abort_payout_create_to_action_required (
  p_run_id                 uuid,
  p_expected_stage_version integer,
  p_reason                 text,
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
  SET release_stage = 'action_required',
      release_stage_version = release_stage_version + 1,
      status = CASE WHEN status IN ('pending_reconciliation', 'reconciliation_needed') THEN 'reconciliation_needed' ELSE status END,
      action_required_reason = 'payout_create_outcome_unresolved',
      failure_reason = p_reason,
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
  RETURNING TRUE INTO v_updated;

  IF v_updated THEN
    -- An unresolved create outcome also moves the run's pending mappings into
    -- reconciliation so the active-release gate keeps the shipments parked.
    UPDATE public.connect_payout_run_shipments
    SET status = 'reconciliation_needed',
        updated_at = now()
      WHERE run_id = p_run_id
        AND status IN ('pending_reconciliation');
  END IF;

  RETURN COALESCE(v_updated, FALSE);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_abort_payout_create_to_action_required"(uuid, integer, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_abort_payout_create_to_action_required"(uuid, integer, text, text) IS 'Aborts the payout create fence into action_required when the Stripe outcome cannot be reconciled to exactly one payout: no new payout is ever created from this state. Token- and version-conditional. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_abort_payout_create_to_action_required"(uuid, integer, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_abort_payout_create_to_action_required"(uuid, integer, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_abort_payout_create_to_action_required"(uuid, integer, text, text) FROM PUBLIC, "anon", "authenticated";
