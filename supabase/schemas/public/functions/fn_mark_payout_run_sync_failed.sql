CREATE OR REPLACE FUNCTION public.fn_mark_payout_run_sync_failed (
  p_run_id           uuid,
  p_stripe_payout_id text,
  p_failure_reason   text
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
  SET stripe_payout_id = COALESCE(stripe_payout_id, p_stripe_payout_id),
      status = 'reconciliation_needed',
      failure_reason = COALESCE(p_failure_reason, failure_reason),
      release_stage_version = release_stage_version + 1,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Never regress terminal authority: a webhook already projected a
      -- terminal outcome (paid/failed/canceled), and this fallback must not
      -- overwrite it.
      AND status NOT IN ('paid', 'failed', 'canceled')
      -- Idempotent no-op: an already-parked run with the same recorded reason
      -- and payout id is not a new decision, so the version stays put.
      AND (
        status IS DISTINCT FROM 'reconciliation_needed'
        OR stripe_payout_id IS DISTINCT FROM
          COALESCE(stripe_payout_id, p_stripe_payout_id)
        OR failure_reason IS DISTINCT FROM
          COALESCE(p_failure_reason, failure_reason)
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_mark_payout_run_sync_failed"(uuid, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_mark_payout_run_sync_failed"(uuid, text, text) IS 'Post-Stripe sync fallback of the manual release path: guarded, version-bumping write that attaches the payout id when absent and parks the run at status=reconciliation_needed while preserving the durable stage (fence stays so the executor reconciliation claim recovers it), refusing a terminal status (paid/failed/canceled) so webhook terminal authority is never regressed. A repeated fallback with the same recorded reason is an idempotent no-op. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_mark_payout_run_sync_failed"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_mark_payout_run_sync_failed"(uuid, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_mark_payout_run_sync_failed"(uuid, text, text) FROM PUBLIC, "anon", "authenticated";
