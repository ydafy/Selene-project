SET local check_function_bodies = off;

-- Hand edit: pg-delta wrote drop plus add, which loses data; rename in place (values are already cents).
ALTER TABLE "public"."connect_payout_run_shipments"
  RENAME COLUMN "net_payout" TO "net_payout_cents";

ALTER TABLE "public"."connect_payout_run_shipments"
  RENAME CONSTRAINT "connect_payout_run_shipments_net_payout_check" TO "connect_payout_run_shipments_net_payout_cents_check";

ALTER TABLE "public"."connect_payout_run_shipments"
  ALTER COLUMN "net_payout_cents" TYPE bigint;

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
    IF v_parent.seller_id <> v_run.seller_id OR v_parent.amount <> v_run.amount
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
    OR v_amount IS DISTINCT FROM v_run.amount::BIGINT
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
    OR v_run.amount::bigint IS DISTINCT FROM
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

CREATE OR REPLACE FUNCTION public.fn_complete_shipment_transfer (
  p_run_id                 uuid,
  p_shipment_id            uuid,
  p_expected_stage_version integer,
  p_transfer_token         uuid,
  p_stripe_transfer_id     text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_mapping public.connect_payout_run_shipments%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_stripe_transfer_id IS NULL OR btrim(p_stripe_transfer_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_TRANSFER_ID';
  END IF;
  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_expected_stage_version IS NULL OR v_run.release_stage_version IS DISTINCT FROM p_expected_stage_version
    OR v_run.status IS DISTINCT FROM 'pending_reconciliation'
    OR (v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted','awaiting_connected_balance'))
    OR v_run.stripe_payout_id IS NOT NULL OR v_run.payout_claim_token IS NOT NULL
    OR v_run.payout_claim_expires_at IS NOT NULL OR v_run.payout_create_attempted_at IS NOT NULL
    OR v_run.paid_at IS NOT NULL OR v_run.failed_at IS NOT NULL
    OR v_run.failure_reason IS NOT NULL OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id) THEN
    RETURN false;
  END IF;
  SELECT * INTO v_mapping FROM public.connect_payout_run_shipments
    WHERE run_id = p_run_id AND shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_transfer_token IS NULL OR v_mapping.transfer_token IS DISTINCT FROM p_transfer_token
    OR v_mapping.transfer_started_at IS NULL OR v_mapping.status IS DISTINCT FROM 'pending_reconciliation' THEN
    RETURN false;
  END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_shipment.seller_id IS DISTINCT FROM v_run.seller_id THEN RETURN false; END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL THEN
    RETURN v_shipment.stripe_transfer_id = p_stripe_transfer_id;
  END IF;
  UPDATE public.shipments SET stripe_transfer_id = p_stripe_transfer_id WHERE id = p_shipment_id;
  -- The seller notice is best effort: a failing insert must never undo the
  -- recorded transfer, so it runs in its own subtransaction.
  BEGIN
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload, type, title, message, action_path
    ) VALUES (
      v_shipment.seller_id,
      'shipment.funds_released',
      'shipment.funds_released:' || p_shipment_id::text,
      jsonb_build_object('order_id', v_shipment.order_id, 'shipment_id', p_shipment_id,
        'amount_cents', v_mapping.net_payout_cents, 'currency', 'mxn', 'recipient_role', 'seller'),
      'success',
      'Liberamos el pago de tu venta',
      'Enviamos $' || to_char(v_mapping.net_payout_cents / 100.0, 'FM999,999,990.00')
        || ' MXN a tu cuenta de vendedor. El depósito a tu banco puede tardar unos días hábiles.',
      '/profile/orders/' || v_shipment.order_id::text
        || COALESCE('?shipment_id=' || p_shipment_id::text, '')
    )
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata) VALUES ('WARNING', 'Funds released notice failed',
      jsonb_build_object('shipment_id', p_shipment_id, 'sqlstate', SQLSTATE, 'error', SQLERRM));
  END;
  -- Never clear the possible-effect fence, including on idempotent completion.
  RETURN true;
END;
$function$;

COMMENT ON COLUMN "public"."connect_payout_run_shipments"."net_payout_cents" IS 'Shipment payout amount in cents captured at release-run creation time.';
