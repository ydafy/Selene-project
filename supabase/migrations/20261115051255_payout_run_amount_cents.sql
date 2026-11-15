SET local check_function_bodies = off;

DROP VIEW "public"."admin_connect_payout_release_view";

-- Hand edit: pg-delta wrote drop plus add, which loses data; rename in place (values are already cents).
ALTER TABLE "public"."connect_payout_runs"
  RENAME COLUMN "amount" TO "amount_cents";

ALTER TABLE "public"."connect_payout_runs"
  RENAME CONSTRAINT "connect_payout_runs_amount_check" TO "connect_payout_runs_amount_cents_check";

ALTER TABLE "public"."connect_payout_runs"
  ALTER COLUMN "amount_cents" TYPE bigint;

CREATE OR REPLACE FUNCTION public.fn_atomic_payout_resume_mapping (
  p_run_id                    uuid,
  p_mode                      text,
  p_expected_status           text,
  p_expected_stage            text,
  p_expected_version          integer,
  p_shipment_ids              uuid[],
  p_parent_run_id             uuid,
  p_expected_parent_version   integer,
  p_expected_parent_payout_id text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_parent public.connect_payout_runs%ROWTYPE;
  v_count INTEGER;
  v_unique INTEGER;
  v_amount BIGINT;
  v_version INTEGER;
BEGIN
  -- NULL must refuse explicitly, never fall through SQL UNKNOWN comparisons.
  IF p_run_id IS NULL OR p_mode IS NULL OR p_mode NOT IN ('retry', 'pending')
    OR p_expected_status IS NULL OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_shipment_ids IS NULL OR cardinality(p_shipment_ids) < 1
    OR array_position(p_shipment_ids, NULL) IS NOT NULL
    OR cardinality(p_shipment_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_shipment_ids) x)
  THEN RETURN NULL; END IF;

  -- Lock the audit parent first, then its child, consistently with retry authority.
  IF p_parent_run_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.connect_payout_runs
      WHERE id = p_parent_run_id FOR UPDATE;
    IF NOT FOUND OR p_expected_parent_version IS NULL OR p_expected_parent_payout_id IS NULL
      OR v_parent.release_stage_version IS DISTINCT FROM p_expected_parent_version
      OR v_parent.stripe_payout_id IS DISTINCT FROM p_expected_parent_payout_id
      OR v_parent.status <> 'failed' OR v_parent.stripe_payout_id IS NULL
      OR v_parent.release_stage IS DISTINCT FROM 'payout_failed'
      OR v_parent.payout_claim_token IS NOT NULL OR v_parent.payout_claim_expires_at IS NOT NULL
    THEN RETURN NULL; END IF;
  ELSIF p_expected_parent_version IS NOT NULL OR p_expected_parent_payout_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_run.status IS DISTINCT FROM p_expected_status
    OR v_run.release_stage IS DISTINCT FROM p_expected_stage
    OR v_run.release_stage_version IS DISTINCT FROM p_expected_version
    OR v_run.retry_of_run_id IS DISTINCT FROM p_parent_run_id
    OR v_run.stripe_payout_id IS NOT NULL
    OR v_run.payout_claim_token IS NOT NULL OR v_run.payout_claim_expires_at IS NOT NULL
    OR v_run.payout_create_attempted_at IS NOT NULL OR v_run.paid_at IS NOT NULL
    OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id)
  THEN RETURN NULL; END IF;

  -- Only supported pre-payout states. A failed legacy run without a provider
  -- attempt may resume with the same key; provider-terminal failures cannot.
  IF v_run.status = 'pending_reconciliation' THEN
    IF v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted', 'awaiting_connected_balance')
      OR v_run.failed_at IS NOT NULL OR v_run.failure_reason IS NOT NULL
    THEN RETURN NULL; END IF;
  ELSIF p_mode = 'retry' AND v_run.status = 'failed' AND p_parent_run_id IS NULL THEN
    IF v_run.release_stage IS NOT NULL AND v_run.release_stage <> 'payout_failed'
    THEN RETURN NULL; END IF;
  ELSE RETURN NULL;
  END IF;

  -- Child identity and complete mapping set must agree with immutable failed
  -- parent history. No parent row or parent mapping is ever updated here.
  IF p_parent_run_id IS NOT NULL THEN
    IF v_parent.seller_id <> v_run.seller_id OR v_parent.amount_cents <> v_run.amount_cents
      OR v_run.id = v_parent.id
      OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_parent.id AND id <> v_run.id)
    THEN RETURN NULL; END IF;
    PERFORM 1 FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id ORDER BY shipment_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id AND status <> 'failed')
      OR EXISTS (
        (SELECT shipment_id, net_payout_cents FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id
         EXCEPT SELECT shipment_id, net_payout_cents FROM public.connect_payout_run_shipments WHERE run_id = v_run.id)
        UNION ALL
        (SELECT shipment_id, net_payout_cents FROM public.connect_payout_run_shipments WHERE run_id = v_run.id
         EXCEPT SELECT shipment_id, net_payout_cents FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id)
      )
    THEN RETURN NULL; END IF;
  END IF;

  -- Lock every target mapping and its shipments. The existing active-once
  -- unique index also rejects concurrent foreign activation atomically.
  PERFORM 1 FROM public.connect_payout_run_shipments WHERE run_id = v_run.id ORDER BY shipment_id FOR UPDATE;
  PERFORM 1 FROM public.shipments WHERE id = ANY(p_shipment_ids) ORDER BY id FOR UPDATE;
  SELECT count(*), count(DISTINCT shipment_id), sum(net_payout_cents)
    INTO v_count, v_unique, v_amount
    FROM public.connect_payout_run_shipments WHERE run_id = v_run.id;
  IF v_count <> cardinality(p_shipment_ids) OR v_unique <> v_count
    OR v_amount IS DISTINCT FROM v_run.amount_cents
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments m
      JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = v_run.id AND (
        NOT (m.shipment_id = ANY(p_shipment_ids)) OR m.status <> v_run.status
        OR m.net_payout_cents <= 0 OR s.seller_id <> v_run.seller_id
        OR s.status <> 'completed' OR s.completed_at IS NULL
        OR (p_mode = 'pending' AND s.stripe_transfer_id IS NULL)))
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
      WHERE shipment_id = ANY(p_shipment_ids) AND run_id <> v_run.id
        AND status IN ('pending_reconciliation', 'paid', 'reconciliation_needed'))
  THEN RETURN NULL; END IF;

  UPDATE public.connect_payout_runs
    SET status = 'pending_reconciliation', release_stage = 'awaiting_connected_balance',
        release_stage_version = release_stage_version + 1,
        failure_reason = NULL, failed_at = NULL, updated_at = now()
    WHERE id = v_run.id
    RETURNING release_stage_version INTO v_version;
  UPDATE public.connect_payout_run_shipments
    SET status = 'pending_reconciliation', updated_at = now()
    WHERE run_id = v_run.id;
  -- Exceptions (including active-once conflicts) roll back BOTH writes.
  RETURN v_version;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_begin_shipment_transfer (
  p_run_id                 uuid,
  p_shipment_id            uuid,
  p_expected_stage_version integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_mapping public.connect_payout_run_shipments%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_row public.admin_connect_payout_release_view%ROWTYPE;
  v_token UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Match existing resume/terminal lock order: run, mapping, shipment. A
  -- cancellation owns only shipment/operation and reads transfer fences without
  -- locking mappings, so it cannot form a reverse-order lock cycle.
  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT'; END IF;
  IF p_expected_stage_version IS NULL
    OR v_run.release_stage_version IS DISTINCT FROM p_expected_stage_version
    OR v_run.status IS DISTINCT FROM 'pending_reconciliation'
    OR (v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted','awaiting_connected_balance'))
    OR v_run.stripe_payout_id IS NOT NULL
    OR v_run.payout_claim_token IS NOT NULL OR v_run.payout_claim_expires_at IS NOT NULL
    OR v_run.payout_create_attempted_at IS NOT NULL OR v_run.paid_at IS NOT NULL
    OR v_run.failed_at IS NOT NULL OR v_run.failure_reason IS NOT NULL
    OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT';
  END IF;
  SELECT * INTO v_mapping FROM public.connect_payout_run_shipments
    WHERE run_id = p_run_id AND shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT'; END IF;
  IF v_mapping.status IS DISTINCT FROM 'pending_reconciliation' THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT';
  END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  -- Read after the shared shipment lock, with the live clock after lock waits.
  IF EXISTS (SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id
      AND (external_started_at IS NOT NULL OR claim_expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED';
  END IF;
  IF v_shipment.status IS DISTINCT FROM 'completed' OR v_shipment.completed_at IS NULL THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_COMPLETED';
  END IF;

  -- Reuse the canonical allocation/read model, not caller amounts or a second
  -- financial formula. Only this run's own active marker may be tolerated.
  SELECT * INTO v_row FROM public.admin_connect_payout_release_view WHERE shipment_id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_INELIGIBLE'; END IF;
  IF v_shipment.seller_id IS DISTINCT FROM v_run.seller_id
    OR v_row.stripe_account_id IS NULL OR v_row.stripe_onboarding_status IS DISTINCT FROM 'complete'
    OR v_row.stripe_payment_intent_id IS NULL
    OR v_row.release_amount_cents IS NULL OR v_row.release_amount_cents <= 0
    OR v_mapping.net_payout_cents IS DISTINCT FROM v_row.release_amount_cents
    OR v_run.amount_cents IS DISTINCT FROM
      (SELECT sum(net_payout_cents) FROM public.connect_payout_run_shipments WHERE run_id = p_run_id)
    OR (v_row.is_eligible IS DISTINCT FROM true AND v_row.ineligible_reason IS DISTINCT FROM 'already_released')
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
      WHERE shipment_id = p_shipment_id AND run_id <> p_run_id
        AND status IN ('pending_reconciliation','paid','reconciliation_needed')) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_INELIGIBLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fn_get_connect_account_actionability(v_row.stripe_account_id)
    WHERE is_actionable = true) THEN
    RAISE EXCEPTION 'CONNECT_ACCOUNT_NOT_ACTIONABLE';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_shipment.order_id;
  IF NOT FOUND OR v_order.stripe_charge_id IS NULL OR btrim(v_order.stripe_charge_id) = ''
    OR v_order.stripe_transfer_group IS NULL OR btrim(v_order.stripe_transfer_group) = '' THEN
    RAISE EXCEPTION 'MISSING_SETTLEMENT_CONTEXT';
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.connect_payout_run_shipments
    SET transfer_started_at = clock_timestamp(), transfer_token = v_token
    WHERE id = v_mapping.id;
  -- No run stage/version mutation: preserve the existing resume intent epoch.
  RETURN jsonb_build_object('transfer_token', v_token,
    'amount', v_row.release_amount_cents, 'currency', 'mxn',
    'destination', v_row.stripe_account_id, 'source_transaction', v_order.stripe_charge_id,
    'transfer_group', v_order.stripe_transfer_group,
    'idempotency_key', v_run.idempotency_key || ':' || v_run.id::text || ':' || p_shipment_id::text,
    'metadata', jsonb_build_object('app_name','selene','run_id',v_run.id,
      'shipment_id',p_shipment_id,'seller_id',v_run.seller_id,'order_id',v_order.id));
END;
$function$;

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
    cpr.amount_cents::integer,
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
  LEFT JOIN internal.connect_account_actionability caa
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
    cpr.amount_cents::integer,
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

CREATE VIEW "public"."admin_connect_payout_release_view" WITH (security_invoker=true) AS  WITH shipment_amounts AS (
         SELECT s.id AS shipment_id,
            s.seller_id,
            s.order_id,
            s.status,
            s.completed_at,
            s.stripe_payment_intent_id,
            s.stripe_payout_id,
            s.shipping_cost_cents,
            pp.stripe_account_id,
            pp.stripe_onboarding_status,
            p.username AS seller_name,
            (s.status = 'completed'::public.order_status_enum) AS is_completed,
            (s.completed_at IS NOT NULL) AS has_completed_at,
            (s.stripe_payment_intent_id IS NOT NULL) AS has_connect_payment_intent,
            GREATEST(
                CASE
                    WHEN (o.stripe_transfer_group IS NOT NULL) THEN (COALESCE(sum(oi.net_payout_cents), (0)::numeric))::integer
                    ELSE ((COALESCE(sum(oi.net_payout_cents), (0)::numeric))::integer - (COALESCE(s.shipping_cost_cents, (0)::bigint))::integer)
                END, 0) AS release_amount_cents,
            ((s.shipping_cost_cents IS NOT NULL) AND (s.shipping_cost_cents > 0)) AS has_shipping_cost_cents,
            (EXISTS ( SELECT 1
                   FROM public.disputes d
                  WHERE ((d.shipment_id = s.id) AND (d.status = ANY (ARRAY['open'::public.dispute_status, 'under_review'::public.dispute_status, 'waiting_return'::public.dispute_status, 'return_shipped'::public.dispute_status, 'return_delivered'::public.dispute_status]))))) AS has_active_dispute,
            (EXISTS ( SELECT 1
                   FROM public.connect_payout_run_shipments crs
                  WHERE ((crs.shipment_id = s.id) AND (crs.status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'reconciliation_needed'::text]))))) AS has_active_release,
            o.stripe_transfer_group AS transfer_group,
            s.stripe_transfer_id
           FROM ((((public.shipments s
             JOIN public.orders o ON ((o.id = s.order_id)))
             LEFT JOIN public.order_items oi ON ((oi.shipment_id = s.id)))
             LEFT JOIN public.profiles_private pp ON ((pp.id = s.seller_id)))
             LEFT JOIN public.profiles p ON ((p.id = s.seller_id)))
          GROUP BY s.id, s.seller_id, s.order_id, s.status, s.completed_at, s.stripe_payment_intent_id, s.stripe_payout_id, s.shipping_cost_cents, pp.stripe_account_id, pp.stripe_onboarding_status, p.username, o.stripe_transfer_group, s.stripe_transfer_id
        )
 SELECT sa.shipment_id,
    sa.seller_id,
    sa.seller_name,
    sa.order_id,
    sa.status,
    sa.completed_at,
    sa.stripe_payment_intent_id,
    sa.stripe_account_id,
    sa.stripe_onboarding_status,
    sa.release_amount_cents,
    (sa.is_completed AND sa.has_completed_at AND sa.has_connect_payment_intent AND (NOT sa.has_active_dispute) AND (NOT sa.has_active_release) AND (payout_run.id IS NULL) AND ((sa.transfer_group IS NOT NULL) OR sa.has_shipping_cost_cents) AND (sa.stripe_account_id IS NOT NULL) AND (sa.stripe_onboarding_status = 'complete'::public.stripe_onboarding_status) AND (sa.release_amount_cents > 0)) AS is_eligible,
        CASE
            WHEN (NOT sa.is_completed) THEN 'shipment_not_completed'::text
            WHEN (NOT sa.has_completed_at) THEN 'missing_completed_at'::text
            WHEN (NOT sa.has_connect_payment_intent) THEN 'missing_connect_payment_intent'::text
            WHEN sa.has_active_dispute THEN 'active_dispute'::text
            WHEN sa.has_active_release THEN 'already_released'::text
            WHEN (payout_run.status = 'canceled'::text) THEN 'payout_canceled_manual_review'::text
            WHEN (payout_run.status = 'failed'::text) THEN 'payout_failed_retry_required'::text
            WHEN (payout_run.id IS NOT NULL) THEN 'payout_run_history_requires_review'::text
            WHEN ((sa.transfer_group IS NULL) AND (NOT sa.has_shipping_cost_cents)) THEN 'missing_shipping_cost'::text
            WHEN (sa.stripe_account_id IS NULL) THEN 'missing_stripe_account'::text
            WHEN ((sa.stripe_onboarding_status <> 'complete'::public.stripe_onboarding_status) OR (sa.stripe_onboarding_status IS NULL)) THEN 'seller_not_payout_ready'::text
            WHEN (sa.release_amount_cents <= 0) THEN 'missing_release_amount'::text
            ELSE NULL::text
        END AS ineligible_reason,
    sa.transfer_group,
    sa.stripe_transfer_id,
    payout_run.id AS payout_run_id,
    payout_run.status AS payout_run_status,
    (payout_run.amount_cents)::integer AS payout_run_amount_cents,
    payout_run.failure_reason AS payout_run_failure_reason,
    payout_run.failed_at AS payout_run_failed_at,
    payout_run.retry_of_run_id,
    COALESCE(((payout_run.status = 'failed'::text) AND (NOT payout_run.has_protected_release) AND (NOT payout_run.has_retry_child)), false) AS is_retryable,
    COALESCE((payout_run.status = 'canceled'::text), false) AS requires_manual_review,
    payout_run.paid_at AS payout_run_paid_at,
        CASE
            WHEN ((NOT sa.is_completed) OR (sa.stripe_transfer_id IS NOT NULL) OR (sa.stripe_account_id IS NULL) OR (payout_run.status = 'paid'::text)) THEN NULL::text
            WHEN (sa.stripe_onboarding_status = 'rejected'::public.stripe_onboarding_status) THEN 'onboarding_rejected'::text
            WHEN ((sa.stripe_onboarding_status <> 'complete'::public.stripe_onboarding_status) OR (sa.stripe_onboarding_status IS NULL)) THEN 'onboarding_pending'::text
            ELSE account_gate.blocked_reason
        END AS seller_payout_block_reason,
        CASE
            WHEN (sa.completed_at IS NULL) THEN NULL::integer
            ELSE (EXTRACT(day FROM (now() - sa.completed_at)))::integer
        END AS days_since_completed
   FROM ((shipment_amounts sa
     LEFT JOIN LATERAL ( SELECT pr.id,
            pr.status,
            pr.amount_cents,
            pr.failure_reason,
            pr.failed_at,
            pr.paid_at,
            pr.retry_of_run_id,
            (EXISTS ( SELECT 1
                   FROM public.connect_payout_runs retry_child
                  WHERE (retry_child.retry_of_run_id = pr.id))) AS has_retry_child,
            (EXISTS ( SELECT 1
                   FROM (public.connect_payout_run_shipments source_mapping
                     JOIN public.connect_payout_run_shipments protected_mapping ON ((protected_mapping.shipment_id = source_mapping.shipment_id)))
                  WHERE ((source_mapping.run_id = pr.id) AND (protected_mapping.status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'reconciliation_needed'::text]))))) AS has_protected_release
           FROM (public.connect_payout_run_shipments crs
             JOIN public.connect_payout_runs pr ON ((pr.id = crs.run_id)))
          WHERE (crs.shipment_id = sa.shipment_id)
          ORDER BY pr.created_at DESC, pr.id DESC
         LIMIT 1) payout_run ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (sa.is_completed AND (sa.stripe_transfer_id IS NULL) AND (sa.stripe_onboarding_status = 'complete'::public.stripe_onboarding_status) AND (sa.stripe_account_id IS NOT NULL) AND (btrim(sa.stripe_account_id) <> ''::text)) THEN ( SELECT
                            CASE
                                WHEN gate.is_actionable THEN NULL::text
                                ELSE COALESCE(gate.blocked_reason, 'account_not_actionable'::text)
                            END AS "case"
                       FROM public.fn_get_connect_account_actionability(sa.stripe_account_id) gate(is_actionable, blocked_reason))
                    ELSE NULL::text
                END AS blocked_reason) account_gate ON (true));

REVOKE ALL ON TABLE "public"."admin_connect_payout_release_view" FROM "anon", "authenticated";

COMMENT ON COLUMN "public"."connect_payout_runs"."amount_cents" IS 'Total payout amount in cents. Single-modal orders use the checkout-fixed sum of order_items.net_payout_cents; legacy orders retain the shipment shipping_cost_cents deduction.';

REVOKE ALL ON TABLE "public"."admin_connect_payout_release_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_connect_payout_release_view" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_connect_payout_release_view" TO "service_role";
