CREATE OR REPLACE FUNCTION public.fn_mark_payout_run_reconciliation_needed (
  p_run_id         uuid,
  p_failure_reason text
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
  SET status = 'reconciliation_needed',
      release_stage = 'action_required',
      release_stage_version = release_stage_version + 1,
      failure_reason = COALESCE(p_failure_reason, failure_reason),
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Idempotent no-op: an already-parked run whose recorded reason is
      -- unchanged is not a new decision, so the monotonic version stays put
      -- for a repeated park.
      AND (
        status IS DISTINCT FROM 'reconciliation_needed'
        OR failure_reason IS DISTINCT FROM
          COALESCE(p_failure_reason, failure_reason)
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"(uuid, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"(uuid, text) IS 'Webhook reconciliation park: guarded, version-bumping write that sets status=reconciliation_needed with the compatible action_required stage, clears the executor claim and lease, and preserves paid_at/failed_at terminal evidence. A repeated park with the same reason is an idempotent no-op. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"(uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"(uuid, text) FROM PUBLIC, "anon", "authenticated";
