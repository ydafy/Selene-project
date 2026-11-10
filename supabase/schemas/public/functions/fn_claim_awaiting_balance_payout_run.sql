CREATE OR REPLACE FUNCTION public.fn_claim_awaiting_balance_payout_run (
  p_lease_seconds integer DEFAULT 300
)
  RETURNS TABLE (
    run_id           uuid,
    actor_id         uuid,
    seller_id        uuid,
    amount_cents     integer,
    idempotency_key  text,
    shipment_ids     uuid[],
    claim_token      text,
    stage_version    integer,
    claim_expires_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_lease TIMESTAMPTZ;
  v_run_id UUID;
  v_actor_id UUID;
  v_seller_id UUID;
  v_amount INTEGER;
  v_idempotency_key TEXT;
  v_shipment_ids UUID[];
  v_claim_token TEXT;
  v_stage_version INTEGER;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'INVALID_LEASE_SECONDS';
  END IF;

  v_lease := now() + make_interval(secs => p_lease_seconds);

  SELECT
    cpr.id,
    cpr.actor_id,
    cpr.seller_id,
    cpr.amount,
    cpr.idempotency_key,
    cpr.release_stage_version
  INTO
    v_run_id,
    v_actor_id,
    v_seller_id,
    v_amount,
    v_idempotency_key,
    v_stage_version
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  LEFT JOIN public.connect_account_actionability caa
    ON caa.stripe_account_id = pp.stripe_account_id
  WHERE cpr.status = 'pending_reconciliation'
    AND cpr.stripe_payout_id IS NULL
    -- Only the executor-eligible pre-payout stage; a run fenced in
    -- payout_create_in_progress is reconciliation territory, never a second
    -- create.
    AND (
      cpr.release_stage = 'awaiting_connected_balance'
      OR cpr.release_stage IS NULL
    )
    -- Derived actionability: an account evidencing a documented non-actionable
    -- state (errored, verification_failed,
    -- tokenized_account_number_deactivated, payouts_disabled) is never
    -- claimed; unevidenced accounts default to actionable.
    AND COALESCE(caa.is_actionable, TRUE)
    -- Deferred runs stay deferred until their next attempt is due.
    AND (
      cpr.next_attempt_at IS NULL
      OR cpr.next_attempt_at <= now()
    )
    -- Absent or expired lease only; an actively leased run is never handed to
    -- a second worker.
    AND (
      cpr.payout_claim_expires_at IS NULL
      OR cpr.payout_claim_expires_at <= now()
    )
    AND EXISTS (
      SELECT 1
      FROM public.connect_payout_run_shipments m
      WHERE m.run_id = cpr.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.connect_payout_run_shipments m
      JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = cpr.id
        AND (
          m.status <> 'pending_reconciliation'
          OR s.stripe_transfer_id IS NULL
        )
    )
  -- Fair scheduling across all due candidates: order by each run's readiness
  -- instant — a never-deferred arrival became ready at created_at, a
  -- deferred run becomes ready again at next_attempt_at — so a due deferred
  -- run is claimed ahead of any newer arrival whose backoff has not been
  -- waiting as long. FIFO within the same readiness time. Prioritizing
  -- never-deferred arrivals ahead of due deferred runs (the legacy
  -- nulls-first ordering) would permanently starve due deferred runs under
  -- sustained arrivals. Not-yet-due runs are excluded by the WHERE gate
  -- above; a just-deferred run is not claimable again in the same tick
  -- because its backoff (minimum one minute) sets next_attempt_at in the
  -- future.
  ORDER BY COALESCE(cpr.next_attempt_at, cpr.created_at), cpr.created_at
  FOR UPDATE OF cpr SKIP LOCKED
  LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.connect_payout_runs
  SET payout_claim_token = gen_random_uuid()::text,
      payout_claim_expires_at = v_lease,
      -- Legacy admission: normalize a pre-fencing run into the stage model
      -- under the claim it just received.
      release_stage = COALESCE(release_stage, 'awaiting_connected_balance'),
      -- Every claim mints a new fencing epoch: the unconditional version
      -- bump invalidates any write an earlier claim holder could still be
      -- about to make, so a re-claimed lease can never reuse the previous
      -- token+version pair.
      release_stage_version = release_stage_version + 1,
      updated_at = now()
  WHERE id = v_run_id
  RETURNING payout_claim_token, release_stage_version
    INTO v_claim_token, v_stage_version;

  SELECT array_agg(m.shipment_id ORDER BY m.shipment_id)
  INTO v_shipment_ids
  FROM public.connect_payout_run_shipments m
  WHERE m.run_id = v_run_id;

  RETURN QUERY SELECT
    v_run_id,
    v_actor_id,
    v_seller_id,
    v_amount,
    v_idempotency_key,
    v_shipment_ids,
    v_claim_token,
    v_stage_version,
    v_lease;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) IS 'Claims one awaiting-balance payout run (pending_reconciliation, no Stripe payout id, awaiting_connected_balance or legacy stage, actionable account, next attempt due, unclaimed or expired lease, every shipment already transferred) under a short FOR UPDATE SKIP LOCKED lease and returns the DB-derived run fields plus the fresh claim token and the stage version the claim just bumped, which fence every worker write. Every claim mints a new fencing epoch by bumping the version. All due candidates (due deferred and immediate) are fairly ordered by readiness time so deferred runs cannot starve under sustained arrivals. Server-only; execution is restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) FROM PUBLIC, "anon", "authenticated";
