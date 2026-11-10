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
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET release_stage = 'action_required',
      release_stage_version = release_stage_version + 1,
      status = CASE
        WHEN status = 'pending_reconciliation' THEN 'reconciliation_needed'
        ELSE status
      END,
      action_required_reason = 'account_not_actionable',
      last_error = 'account_not_actionable: ' || COALESCE(p_blocked_reason, 'unknown'),
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      AND payout_claim_token = p_claim_token
      AND release_stage_version = p_expected_stage_version
      AND payout_claim_expires_at IS NOT NULL
      AND payout_claim_expires_at > now()
      AND stripe_payout_id IS NULL
      AND release_stage IN (
        'awaiting_connected_balance',
        'payout_create_in_progress'
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_block_payout_run_for_account_actionability"(uuid, text, integer, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_block_payout_run_for_account_actionability"(uuid, text, integer, text) IS 'Parks one claimed pre-payout run (awaiting_connected_balance or payout_create_in_progress) into action_required with the account_not_actionable reason, conditional on the exact claim token, expected stage version, and an unexpired lease, so a stale worker can never park a newer claim. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_block_payout_run_for_account_actionability"(uuid, text, integer, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_block_payout_run_for_account_actionability"(uuid, text, integer, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_block_payout_run_for_account_actionability"(uuid, text, integer, text) FROM PUBLIC, "anon", "authenticated";
