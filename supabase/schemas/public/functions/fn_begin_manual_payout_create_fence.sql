CREATE OR REPLACE FUNCTION public.fn_begin_manual_payout_create_fence (
  p_run_id uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_stage TEXT;
  v_version INTEGER;
  v_token TEXT;
BEGIN
  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token
  INTO v_stage, v_version, v_token
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  IF v_token IS NOT NULL THEN
    -- Slice 3 residual race closure: the executor claim is inspected under
    -- the same row lock as the fence write, so a worker claim that lands
    -- concurrently conflicts atomically instead of racing the manual path
    -- between the inspect and the fence update. Any held token conflicts —
    -- a live lease means a worker is mid-flight, and a lapsed lease is
    -- reclaimed only by the worker claim flow, never by a manual bypass.
    RAISE EXCEPTION 'EXECUTOR_CLAIM_HELD';
  END IF;

  IF v_stage IS NOT NULL
    AND v_stage NOT IN (
      'release_accepted',
      'transfer_created',
      'awaiting_connected_balance'
    ) THEN
    -- Includes payout_create_in_progress (already fenced: reconcile, never
    -- recreate) and every terminal or action_required stage.
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

GRANT EXECUTE ON FUNCTION "public"."fn_begin_manual_payout_create_fence"(uuid) TO "service_role";

COMMENT ON FUNCTION "public"."fn_begin_manual_payout_create_fence"(uuid) IS 'Manual release path of the durable write-ahead fence: atomically transitions a pre-payout run (release_accepted, transfer_created, or awaiting_connected_balance) into payout_create_in_progress with payout_create_attempted_at and a bumped stage version, refuses an already-open fence so the admin endpoint can never create over an unreconciled Stripe attempt, and refuses any held executor claim (live or lapsed) under the same row lock — a lapsed claim is reclaimed only by the worker claim flow, never by a manual bypass. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_begin_manual_payout_create_fence"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_begin_manual_payout_create_fence"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_begin_manual_payout_create_fence"(uuid) FROM PUBLIC, "anon", "authenticated";
