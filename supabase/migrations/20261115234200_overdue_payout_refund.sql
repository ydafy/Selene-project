SET local check_function_bodies = off;

ALTER TABLE "public"."shipment_cancellation_operations"
  DROP CONSTRAINT "shipment_cancellation_operations_carrier_balance_consistent";

ALTER TABLE "public"."shipment_cancellation_operations"
  DROP CONSTRAINT "shipment_cancellation_operations_check";

ALTER TABLE "public"."shipment_cancellation_operations"
  DROP CONSTRAINT "shipment_cancellation_operations_source_check";

CREATE OR REPLACE FUNCTION public.fn_apply_shipment_cancellation_refund_event (
  p_shipment_id       uuid,
  p_refund_id         text,
  p_payment_intent_id text,
  p_amount_cents      bigint,
  p_status            text,
  p_failure_reason    text   DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_shipment_status TEXT;
  v_order_id UUID;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_recorded JSONB;
  v_outcome TEXT;
  v_buyer_id UUID;
  v_cancel_success BOOLEAN;
  v_cancel_error TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- An overdue payout refund (#549) completes through payout runs: lock its
  -- runs and mappings before the shipment, the order fn_complete_overdue_payout_refund
  -- and fn_begin_shipment_transfer use. The source of a started operation never changes.
  IF EXISTS (SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id AND source = 'admin_overdue_payout') THEN
    PERFORM 1 FROM public.connect_payout_runs r
      WHERE r.id IN (SELECT m.run_id FROM public.connect_payout_run_shipments m
        WHERE m.shipment_id = p_shipment_id AND m.status IN ('pending_reconciliation', 'reconciliation_needed'))
      ORDER BY r.id FOR UPDATE;
    PERFORM 1 FROM public.connect_payout_run_shipments m
      WHERE m.shipment_id = p_shipment_id AND m.status IN ('pending_reconciliation', 'reconciliation_needed')
      ORDER BY m.id FOR UPDATE;
  END IF;

  -- Same lock order as claim/start, record and fn_cancel_shipment: shipment first.
  SELECT status::text, order_id INTO v_shipment_status, v_order_id
    FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'ignored'); END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  IF NOT FOUND OR v_operation.external_started_at IS NULL OR v_operation.refund_request IS NULL THEN
    RETURN jsonb_build_object('outcome', 'ignored');
  END IF;

  -- A resolved operation is settled by hand (the buyer may already have been paid another way):
  -- never write to it. Validate against the frozen request first so a foreign event is not accepted.
  IF v_operation.refund_resolved_at IS NOT NULL THEN
    IF p_refund_id IS NULL OR btrim(p_refund_id) = '' THEN RAISE EXCEPTION 'INVALID_REFUND_ID'; END IF;
    IF p_status IS NULL OR p_status NOT IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') THEN
      RAISE EXCEPTION 'INVALID_REFUND_STATUS';
    END IF;
    IF p_payment_intent_id IS DISTINCT FROM v_operation.refund_request->>'payment_intent' THEN
      RAISE EXCEPTION 'REFUND_PAYMENT_INTENT_MISMATCH';
    END IF;
    IF p_amount_cents IS DISTINCT FROM (v_operation.refund_request->>'amount')::BIGINT THEN
      RAISE EXCEPTION 'REFUND_AMOUNT_MISMATCH';
    END IF;
    IF p_refund_id = v_operation.refund_id AND p_status = v_operation.refund_status THEN
      RETURN jsonb_build_object(
        'refund_id', v_operation.refund_id,
        'refund_status', v_operation.refund_status,
        'refund_failure_reason', v_operation.refund_failure_reason,
        'amount_owed_cents', (v_operation.refund_request->>'amount')::BIGINT,
        'outcome', 'unchanged');
    END IF;
    RETURN jsonb_build_object(
      'refund_id', p_refund_id,
      'refund_status', p_status,
      'refund_failure_reason', p_failure_reason,
      'amount_owed_cents', (v_operation.refund_request->>'amount')::BIGINT,
      'resolution_reference', v_operation.refund_resolution_reference,
      'outcome', 'after_resolution');
  END IF;

  v_recorded := public.fn_record_shipment_cancellation_refund(
    p_shipment_id, p_refund_id, p_payment_intent_id, p_amount_cents, p_status, p_failure_reason);

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  v_outcome := CASE WHEN (v_recorded->>'changed')::BOOLEAN THEN 'recorded' ELSE 'unchanged' END;

  IF v_operation.refund_status = 'succeeded' AND v_operation.source = 'admin_overdue_payout' THEN
    -- The one refund of a completed shipment; a refunded one is already done.
    IF v_shipment_status = 'completed' THEN
      PERFORM public.fn_complete_overdue_payout_refund(p_shipment_id);
      v_outcome := 'completed';
    END IF;
  ELSIF v_operation.refund_status = 'succeeded' AND v_shipment_status IN ('paid', 'preparing') THEN
    -- Complete with the stored winner, reason and frozen loss, never the event's.
    SELECT c.success, c.error_message INTO v_cancel_success, v_cancel_error
      FROM public.fn_cancel_shipment(
        p_shipment_id,
        CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source ELSE 'system' END,
        v_operation.reason,
        v_operation.cancellation_loss_cents) AS c;
    IF v_cancel_success IS NOT TRUE OR v_cancel_error IS NOT NULL THEN
      RAISE EXCEPTION 'CANCELLATION_COMPLETE_FAILED: %', COALESCE(v_cancel_error, 'UNKNOWN');
    END IF;
    v_outcome := 'completed';
  -- A redelivered failure event reports again while the operation is unresolved (resolved ones
  -- returned above): the webhook alerts after this commits, so a crash in between must not lose
  -- the alert. The buyer notice below is idempotent, so a redelivery never adds a second one.
  ELSIF v_operation.refund_status IN ('failed', 'canceled')
        AND ((v_recorded->>'changed')::BOOLEAN OR p_status IN ('failed', 'canceled')) THEN
    SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_order_id;
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload,
      type, title, message, action_path
    )
    VALUES (
      v_buyer_id,
      'shipment.refund_failed',
      'shipment.refund_failed:' || p_shipment_id::text || ':' || v_operation.refund_id,
      jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id,
                         'refund_id', v_operation.refund_id, 'recipient_role', 'buyer'),
      'error',
      'Reembolso con problemas',
      CASE WHEN v_shipment_status = 'cancelled'
        THEN 'No pudimos completar el reembolso de un envío cancelado de tu pedido. Nuestro equipo se pondrá en contacto contigo para devolverte tu dinero.'
        ELSE 'El reembolso de la cancelación de un envío de tu pedido no se completó. Nuestro equipo lo está revisando y se pondrá en contacto contigo.'
      END,
      '/profile/orders/' || v_order_id::text
        || COALESCE('?shipment_id=' || p_shipment_id::text, '')
    )
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    v_outcome := CASE WHEN v_shipment_status = 'cancelled'
      THEN 'failed_after_cancellation' ELSE 'failed_before_cancellation' END;
  END IF;

  RETURN jsonb_build_object(
    'refund_id', v_operation.refund_id,
    'refund_status', v_operation.refund_status,
    'refund_failure_reason', v_operation.refund_failure_reason,
    'amount_owed_cents', (v_operation.refund_request->>'amount')::BIGINT,
    'outcome', v_outcome);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_claim_overdue_payout_refund (
  p_admin_id    uuid,
  p_shipment_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_reason CONSTANT TEXT := 'overdue_payout_seller_rejected';
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_held RECORD;
  v_onboarding_status TEXT;
  v_payment_intent_id TEXT;
  v_context JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- Shipment first: the lock order of the cancellation, transfer and hold note paths.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  -- Defense in depth: the admin id is written to the operation and the audit
  -- log, so it must be an active admin by the same rule as is_admin().
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  SELECT COALESCE(s.stripe_payment_intent_id, o.stripe_payment_intent_id)
    INTO v_payment_intent_id
    FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = p_shipment_id;
  v_context := jsonb_build_object('shipment_id', p_shipment_id, 'order_id', v_shipment.order_id,
    'payment_intent_id', v_payment_intent_id);

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF FOUND AND v_operation.source = 'admin_overdue_payout' THEN
    IF v_shipment.status = 'refunded' THEN RAISE EXCEPTION 'SHIPMENT_ALREADY_REFUNDED'; END IF;
    -- A started refund may already exist at Stripe: recovery never depends on
    -- the eligibility checks below, which only guard a new external call.
    IF v_operation.external_started_at IS NOT NULL THEN
      RETURN v_context || jsonb_build_object('status', 'recovery_required',
        'operation_key', v_operation.operation_key, 'source', v_operation.source,
        'actor_id', v_operation.actor_id, 'reason', v_operation.reason);
    END IF;
  END IF;
  IF v_shipment.status IS DISTINCT FROM 'completed' OR v_shipment.completed_at IS NULL THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_COMPLETED';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  -- transfer_started_at is never cleared: a transfer that was ever started,
  -- whatever its run became, rules the refund out.
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  SELECT v.is_payout_overdue, v.seller_payout_block_reason, v.days_since_completed
    INTO v_held
    FROM public.admin_connect_payout_release_view v
    WHERE v.shipment_id = p_shipment_id;
  IF v_held.is_payout_overdue IS NOT TRUE THEN RAISE EXCEPTION 'PAYOUT_NOT_OVERDUE'; END IF;

  -- The stored status is broader than Stripe's rejected.* reasons; the Edge
  -- Function also confirms requirements.disabled_reason live before it claims.
  SELECT stripe_onboarding_status::text INTO v_onboarding_status
    FROM public.profiles_private WHERE id = v_shipment.seller_id;
  IF v_onboarding_status IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'SELLER_ACCOUNT_NOT_REJECTED';
  END IF;

  -- A run the executor has not parked may still be working on the shipment.
  -- A parked run moves no money; the operation below fences any later transfer.
  IF EXISTS (
    SELECT 1 FROM public.connect_payout_run_shipments m
    JOIN public.connect_payout_runs r ON r.id = m.run_id
    WHERE m.shipment_id = p_shipment_id
      AND m.status IN ('pending_reconciliation', 'reconciliation_needed')
      AND (r.release_stage IS DISTINCT FROM 'action_required' OR r.stripe_payout_id IS NOT NULL
        OR r.payout_claim_token IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_PARKED';
  END IF;

  IF v_operation.shipment_id IS NOT NULL THEN
    IF v_operation.source = 'admin_overdue_payout' THEN
      IF v_operation.claim_expires_at > clock_timestamp() THEN
        RETURN v_context || jsonb_build_object('status', 'busy',
          'operation_key', v_operation.operation_key, 'source', v_operation.source,
          'actor_id', v_operation.actor_id, 'reason', v_operation.reason);
      END IF;
    -- Another source's operation is active while it holds a lease or ever
    -- started (the fence fn_begin_shipment_transfer reads). One that carries a
    -- carrier outcome or a review belongs to that flow and is never re-owned.
    ELSIF v_operation.external_started_at IS NOT NULL OR v_operation.claim_expires_at > clock_timestamp()
       OR v_operation.carrier_cancellation_outcome IS NOT NULL OR v_operation.review_required_at IS NOT NULL THEN
      RAISE EXCEPTION 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE';
    END IF;
    -- An expired claim that never started authorized no external call: the
    -- admin re-owns it with a new token, so a stale worker cannot start.
    UPDATE public.shipment_cancellation_operations
      SET source = 'admin_overdue_payout', actor_id = p_admin_id, reason = v_reason,
          claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '15 minutes'
      WHERE shipment_id = p_shipment_id
      RETURNING * INTO v_operation;
  ELSE
    INSERT INTO public.shipment_cancellation_operations
      (shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at)
      VALUES (p_shipment_id, v_shipment.order_id, 'admin_overdue_payout', p_admin_id, v_reason,
        gen_random_uuid(), clock_timestamp() + interval '15 minutes')
      RETURNING * INTO v_operation;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (p_admin_id, 'OVERDUE_PAYOUT_REFUND_CLAIMED', p_shipment_id,
    jsonb_build_object(
      'operation_key', v_operation.operation_key,
      'order_id', v_shipment.order_id,
      'payment_intent_id', v_payment_intent_id,
      'seller_payout_block_reason', v_held.seller_payout_block_reason,
      'days_since_completed', v_held.days_since_completed));

  RETURN v_context || jsonb_build_object('status', 'claimed', 'operation_key', v_operation.operation_key,
    'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason,
    'claim_token', v_operation.claim_token, 'claim_expires_at', v_operation.claim_expires_at);
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_complete_overdue_payout_refund (
  p_shipment_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_buyer_id UUID;
  v_actual_stripe_fee_cents BIGINT;
  v_order_loss_cents BIGINT;
  v_mapping RECORD;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- The lock order of fn_begin_shipment_transfer and the run resume paths:
  -- runs, then mappings, then the shipment and its operation.
  PERFORM 1 FROM public.connect_payout_runs r
    WHERE r.id IN (SELECT m.run_id FROM public.connect_payout_run_shipments m
      WHERE m.shipment_id = p_shipment_id AND m.status IN ('pending_reconciliation', 'reconciliation_needed'))
    ORDER BY r.id FOR UPDATE;
  PERFORM 1 FROM public.connect_payout_run_shipments m
    WHERE m.shipment_id = p_shipment_id AND m.status IN ('pending_reconciliation', 'reconciliation_needed')
    ORDER BY m.id FOR UPDATE;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.source IS DISTINCT FROM 'admin_overdue_payout'
     OR v_operation.external_started_at IS NULL OR v_operation.refund_request IS NULL THEN
    RAISE EXCEPTION 'OVERDUE_REFUND_NOT_STARTED';
  END IF;

  IF v_shipment.status IS DISTINCT FROM 'refunded' THEN
    -- The Stripe refund must be recorded as succeeded before the database
    -- records the shipment as refunded (S3).
    IF v_operation.refund_status IS DISTINCT FROM 'succeeded' THEN
      RAISE EXCEPTION 'REFUND_NOT_SUCCEEDED';
    END IF;
    IF v_shipment.status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'SHIPMENT_STATUS_UNEXPECTED: %', v_shipment.status;
    END IF;

    -- The status trigger derives the order status from its shipments.
    UPDATE public.shipments SET status = 'refunded', updated_at = now() WHERE id = p_shipment_id;

    -- The Stripe fee loss is the share of the order's actual fee (Stripe
    -- balance transaction) the Edge Function froze at the start, added as
    -- fn_cancel_shipment adds a cancellation's. The label was used, so Selene
    -- also loses what the carrier charged for it.
    SELECT buyer_id, actual_stripe_fee_cents, cancellation_loss_cents
      INTO v_buyer_id, v_actual_stripe_fee_cents, v_order_loss_cents
      FROM public.orders WHERE id = v_shipment.order_id FOR UPDATE;
    IF v_operation.cancellation_loss_cents IS NOT NULL AND v_actual_stripe_fee_cents IS NOT NULL THEN
      UPDATE public.orders
        SET cancellation_loss_cents = LEAST(v_actual_stripe_fee_cents,
              COALESCE(v_order_loss_cents, 0) + v_operation.cancellation_loss_cents),
            updated_at = now()
        WHERE id = v_shipment.order_id;
    END IF;
    UPDATE public.shipment_cancellation_operations
      SET label_cost_loss_cents = v_shipment.label_provider_cost_cents
      WHERE shipment_id = p_shipment_id
      RETURNING * INTO v_operation;

    -- A mapping that never started a transfer is closed. A run left with no
    -- open mapping is closed too; one that still holds other shipments waits
    -- for an admin, and its reason is no longer the one an account update resumes.
    FOR v_mapping IN
      UPDATE public.connect_payout_run_shipments m
        SET status = 'canceled', updated_at = now()
        WHERE m.shipment_id = p_shipment_id
          AND m.status IN ('pending_reconciliation', 'reconciliation_needed')
          AND m.transfer_started_at IS NULL
        RETURNING m.run_id
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.connect_payout_run_shipments m
        WHERE m.run_id = v_mapping.run_id
          AND m.status IN ('pending_reconciliation', 'paid', 'reconciliation_needed')) THEN
        UPDATE public.connect_payout_runs
          SET status = 'canceled', failure_reason = 'overdue_payout_refunded', failed_at = clock_timestamp(),
              action_required_reason = NULL, last_error = NULL, next_attempt_at = NULL,
              release_stage_version = release_stage_version + 1, updated_at = now()
          WHERE id = v_mapping.run_id AND stripe_payout_id IS NULL
            AND status IN ('pending_reconciliation', 'reconciliation_needed');
      ELSE
        UPDATE public.connect_payout_runs
          SET status = 'reconciliation_needed', release_stage = 'action_required',
              action_required_reason = 'overdue_payout_refunded',
              last_error = 'overdue_payout_refunded: ' || p_shipment_id::text,
              release_stage_version = release_stage_version + 1, updated_at = now()
          WHERE id = v_mapping.run_id AND stripe_payout_id IS NULL
            AND status IN ('pending_reconciliation', 'reconciliation_needed');
      END IF;
    END LOOP;

    -- The buyer notice of a refund, as the dispute refund sends it.
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload, type, title, message, action_path
    )
    VALUES (
      v_buyer_id,
      'shipment.refunded',
      'shipment.refunded:' || p_shipment_id::text,
      jsonb_build_object('shipment_id', p_shipment_id, 'order_id', v_shipment.order_id,
        'recipient_role', 'buyer'),
      'success',
      'Te devolvimos tu dinero',
      'Reembolsamos tu compra a tu método de pago. Puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.',
      '/profile/orders/' || v_shipment.order_id::text || '?shipment_id=' || p_shipment_id::text
    )
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'shipment_id', p_shipment_id,
    'order_id', v_shipment.order_id,
    'shipment_status', 'refunded',
    'refund_id', v_operation.refund_id,
    'refund_amount_cents', (v_operation.refund_request->>'amount')::BIGINT,
    'cancellation_loss_cents', v_operation.cancellation_loss_cents,
    'label_cost_loss_cents', v_operation.label_cost_loss_cents);
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_get_admin_payout_queue (
  p_search text    DEFAULT ''::text,
  p_bucket text    DEFAULT 'ready'::text,
  p_page   integer DEFAULT 0,
  p_scope  text    DEFAULT 'page'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
DECLARE
  v_search TEXT := btrim(COALESCE(p_search, ''));
  v_result JSONB;
BEGIN
  IF p_bucket IS NULL OR p_bucket NOT IN ('ready', 'overdue', 'processing', 'action-required', 'history') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_BUCKET';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('page', 'selection') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_SCOPE';
  END IF;
  IF p_page IS NULL OR p_page < 0 THEN
    RAISE EXCEPTION 'INVALID_QUEUE_PAGE';
  END IF;
  IF p_scope = 'selection' AND p_bucket NOT IN ('ready', 'action-required') THEN
    RAISE EXCEPTION 'QUEUE_SELECTION_NOT_ALLOWED';
  END IF;

  WITH queue_rows AS MATERIALIZED (
    SELECT q.*,
      to_jsonb(q) AS row_data,
      -- An overdue held payout (#549) leaves its seller's ready group for an
      -- overdue group of its own, and returns once the account is payable.
      -- A shipment in a run stays with its run.
      CASE WHEN q.payout_run_id IS NULL AND q.is_payout_overdue
        THEN 'overdue:' || q.seller_id::TEXT
        WHEN q.payout_run_id IS NULL
        THEN 'seller:' || q.seller_id::TEXT
        ELSE 'run:' || q.payout_run_id::TEXT END AS queue_group_id,
      CASE WHEN q.payout_run_id IS NULL AND q.is_payout_overdue THEN 4
        WHEN q.payout_run_id IS NULL THEN 0
        WHEN q.payout_run_status = 'paid' THEN 1
        -- A run closed because the overdue payout refund refunded every
        -- shipment it held needs no attention (#549).
        WHEN q.payout_run_status = 'canceled' AND q.payout_run_failure_reason = 'overdue_payout_refunded' THEN 1
        WHEN q.payout_run_status = 'pending_reconciliation' THEN 2
        ELSE 3 END AS bucket_rank
    FROM public.admin_connect_payout_release_view q
    WHERE (q.payout_run_id IS NOT NULL OR
      (q.seller_id IS NOT NULL AND q.shipment_id IS NOT NULL AND q.order_id IS NOT NULL))
      AND (v_search = '' OR strpos(lower(COALESCE(q.seller_name, '')), lower(v_search)) > 0)
  ), groups AS (
    SELECT queue_group_id,
      CASE MAX(bucket_rank) WHEN 0 THEN 'ready' WHEN 1 THEN 'history'
        WHEN 2 THEN 'processing' WHEN 4 THEN 'overdue' ELSE 'action-required' END AS bucket,
      MIN(seller_name) AS seller_name,
      MAX(payout_run_paid_at) AS paid_at,
      CASE WHEN MAX(bucket_rank) = 0 THEN
        BOOL_OR(is_eligible IS TRUE AND release_amount_cents > 0)
      WHEN MAX(bucket_rank) = 4 THEN FALSE
      ELSE BOOL_AND(COALESCE(payout_run_status = 'failed', FALSE) AND COALESCE(is_retryable, FALSE))
      END AS selectable
    FROM queue_rows
    GROUP BY queue_group_id
  ), counts AS (
    SELECT jsonb_build_object(
      'ready', COUNT(*) FILTER (WHERE bucket = 'ready'),
      'overdue', COUNT(*) FILTER (WHERE bucket = 'overdue'),
      'processing', COUNT(*) FILTER (WHERE bucket = 'processing'),
      'action-required', COUNT(*) FILTER (WHERE bucket = 'action-required'),
      'history', COUNT(*) FILTER (WHERE bucket = 'history')
    ) AS value FROM groups
  ), matching_groups AS (
    SELECT * FROM groups WHERE bucket = p_bucket
  ), bounds AS (
    SELECT COUNT(*) AS total_groups,
      GREATEST((COUNT(*) + 19) / 20, 1) AS total_pages,
      LEAST(p_page::BIGINT, GREATEST((COUNT(*) + 19) / 20 - 1, 0)) AS page
    FROM matching_groups
  ), ranked_groups AS (
    SELECT g.*, ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN p_bucket = 'history' THEN paid_at END DESC NULLS LAST,
        CASE WHEN p_bucket = 'history' THEN queue_group_id END DESC,
        CASE WHEN p_bucket <> 'history' THEN lower(seller_name) END COLLATE "C" ASC NULLS LAST,
        queue_group_id ASC
    ) AS position
    FROM matching_groups g
  ), chosen_groups AS (
    SELECT g.* FROM ranked_groups g CROSS JOIN bounds b
    WHERE (p_scope = 'selection' AND g.selectable)
      OR (p_scope = 'page' AND g.position > b.page * 20
        AND g.position <= (b.page + 1) * 20)
  ), chosen_rows AS (
    SELECT COALESCE(
      jsonb_agg(r.row_data ORDER BY g.position, r.completed_at, r.shipment_id),
      '[]'::JSONB
    ) AS value
    FROM queue_rows r
    JOIN chosen_groups g ON g.queue_group_id = r.queue_group_id
  )
  SELECT jsonb_build_object(
    'rows', r.value,
    'counts', c.value,
    'bucket', p_bucket,
    'scope', p_scope,
    'page', CASE WHEN p_scope = 'page' THEN b.page ELSE 0 END,
    'pageSize', 20,
    'totalGroups', b.total_groups,
    'totalPages', b.total_pages,
    'selectedGroupCount', CASE WHEN p_scope = 'selection'
      THEN (SELECT COUNT(*) FROM chosen_groups) ELSE 0 END,
    'selectionComplete', p_scope = 'selection'
  ) INTO v_result
  FROM bounds b CROSS JOIN counts c CROSS JOIN chosen_rows r;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation (
  p_shipment_id uuid,
  p_claim_token uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_operation.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'STALE_CANCELLATION_CLAIM';
  END IF;
  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_operation.claim_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_CLAIM_EXPIRED'; END IF;
  IF v_operation.order_id IS DISTINCT FROM v_shipment.order_id THEN RAISE EXCEPTION 'SHIPMENT_ORDER_MISMATCH'; END IF;
  -- The overdue payout refund (#549) is the one source for a completed shipment.
  IF (v_operation.source IN ('buyer', 'seller', 'paid_timeout') AND v_shipment.status IS DISTINCT FROM 'paid')
     OR (v_operation.source = 'preparing_timeout' AND v_shipment.status IS DISTINCT FROM 'preparing')
     OR (v_operation.source = 'admin_overdue_payout' AND v_shipment.status IS DISTINCT FROM 'completed') THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  IF v_shipment.label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')
     OR (v_shipment.status = 'paid' AND v_shipment.label_generation_state = 'generated') THEN
    RAISE EXCEPTION 'SHIPMENT_LABEL_OPERATION_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  UPDATE public.shipment_cancellation_operations SET external_started_at = clock_timestamp()
    WHERE shipment_id = p_shipment_id AND claim_token = p_claim_token;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation_refund (
  p_shipment_id             uuid,
  p_claim_token             uuid,
  p_refund_request          jsonb,
  p_cancellation_loss_cents bigint DEFAULT NULL::bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_payment_intent_id TEXT;
  v_metadata JSONB;
  v_amount NUMERIC;
  v_share NUMERIC;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- The definer can call the private original entry point. Any later rejection
  -- rolls this mark back, including malformed payloads or failed persistence.
  PERFORM public.fn_start_shipment_cancellation(p_shipment_id, p_claim_token);
  SELECT * INTO STRICT v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  IF v_operation.source = 'preparing_timeout'
     AND (
       (v_operation.carrier_cancellation_outcome IS DISTINCT FROM 'accepted'
        AND v_operation.review_resolution IS DISTINCT FROM 'refund_approved')
       -- Resolutions are final: an operation marked for review needs the approval even when
       -- the outcome is accepted, so a live token cannot refund while pending or after closing.
       OR (v_operation.review_required_at IS NOT NULL
           AND v_operation.review_resolution IS DISTINCT FROM 'refund_approved')
     ) THEN
    RAISE EXCEPTION 'CARRIER_CANCELLATION_NOT_CONFIRMED';
  END IF;
  -- The overdue payout refund (#549) exists only for a seller Stripe rejected;
  -- the account may have changed since the claim.
  IF v_operation.source = 'admin_overdue_payout' AND NOT EXISTS (
    SELECT 1 FROM public.shipments s JOIN public.profiles_private pp ON pp.id = s.seller_id
    WHERE s.id = p_shipment_id AND pp.stripe_onboarding_status = 'rejected'
  ) THEN
    RAISE EXCEPTION 'SELLER_ACCOUNT_NOT_REJECTED';
  END IF;
  SELECT COALESCE(s.stripe_payment_intent_id, o.stripe_payment_intent_id)
    INTO v_payment_intent_id
    FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = p_shipment_id;

  IF jsonb_typeof(p_refund_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_refund_request)) <> 4
     OR jsonb_typeof(p_refund_request->'payment_intent') IS DISTINCT FROM 'string'
     OR v_payment_intent_id IS NULL OR btrim(v_payment_intent_id) = ''
     OR p_refund_request->>'payment_intent' IS DISTINCT FROM v_payment_intent_id
     OR p_refund_request->>'reason' IS DISTINCT FROM 'requested_by_customer'
     OR jsonb_typeof(p_refund_request->'amount') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_refund_request->'metadata') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  v_amount := (p_refund_request->>'amount')::numeric;
  IF v_amount <= 0 OR v_amount > 9007199254740991 OR trunc(v_amount) <> v_amount THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;

  v_metadata := p_refund_request->'metadata';
  IF (SELECT count(*) FROM jsonb_object_keys(v_metadata)) <> 5
     OR v_metadata->>'shipment_id' IS DISTINCT FROM p_shipment_id::text
     OR v_metadata->>'order_id' IS DISTINCT FROM v_operation.order_id::text
     OR v_metadata->>'caller_role' IS DISTINCT FROM
       (CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source
             WHEN v_operation.source = 'admin_overdue_payout' THEN 'admin' ELSE 'system' END)
     OR jsonb_typeof(v_metadata->'reason') IS DISTINCT FROM 'string'
     OR v_metadata->>'reason' IS DISTINCT FROM v_operation.reason
     OR jsonb_typeof(v_metadata->'seguro_share_cents') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  v_share := (v_metadata->>'seguro_share_cents')::numeric;
  IF v_share < 0 OR v_share > v_amount OR trunc(v_share) <> v_share THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  IF p_cancellation_loss_cents < 0 OR p_cancellation_loss_cents > 9007199254740991 THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_LOSS';
  END IF;

  UPDATE public.shipment_cancellation_operations
    SET refund_request = p_refund_request, cancellation_loss_cents = p_cancellation_loss_cents
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;
  RETURN jsonb_build_object('operation_key', v_operation.operation_key,
    'refund_request', v_operation.refund_request,
    'cancellation_loss_cents', v_operation.cancellation_loss_cents);
END;
$function$;

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD CONSTRAINT "shipment_cancellation_operations_carrier_balance_consistent"
    CHECK
    ((((carrier_cancellation_outcome IS DISTINCT FROM 'accepted'::text) AND (carrier_balance_returned IS NULL) AND (carrier_balance_returned_at IS NULL) AND ((label_cost_loss_cents
    IS NULL) OR (NOT (review_resolution IS DISTINCT FROM 'refund_approved'::text)) OR (source = 'admin_overdue_payout'::text))) OR
    ((NOT (carrier_cancellation_outcome IS DISTINCT FROM 'accepted'::text)) AND (carrier_balance_returned IS NOT NULL))));

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD CONSTRAINT "shipment_cancellation_operations_check" CHECK ((((source = ANY (ARRAY['buyer'::text, 'seller'::text, 'admin_overdue_payout'::text])) AND (actor_id IS
    NOT NULL)) OR ((source = ANY (ARRAY['paid_timeout'::text, 'preparing_timeout'::text])) AND (actor_id IS NULL))));

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD CONSTRAINT "shipment_cancellation_operations_source_check"
    CHECK ((source = ANY (ARRAY['buyer'::text, 'seller'::text, 'paid_timeout'::text, 'preparing_timeout'::text, 'admin_overdue_payout'::text])));

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."label_cost_loss_cents" IS 'Label cost Selene lost on this cancellation, in cents, computed by SQL: 0 when the balance was returned, shipments.label_provider_cost_cents when it was not. An admin_overdue_payout refund of a delivered shipment records shipments.label_provider_cost_cents when it completes (#549). NULL means unknown or label not cancelled, not zero. Separate from cancellation_loss_cents (Stripe fee loss) and from the buyer refund.';

COMMENT ON FUNCTION "public"."fn_apply_shipment_cancellation_refund_event"(uuid, text, text, bigint, text, text) IS 'Service-only (SECURITY DEFINER): applies a Stripe refund event to a started shipment cancellation, completes the cancellation on succeeded (an overdue payout refund through fn_complete_overdue_payout_refund) and notifies the buyer on failure. The amount owed is the frozen request amount, never the event.';

COMMENT ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) IS 'Service-only (SECURITY DEFINER; EXECUTE revoked from PUBLIC, anon and authenticated because the admin id is trusted only from an Edge Function that verified the admin session, and the function writes the cancellation operation clients cannot touch): an active admin claims the refund of an overdue held payout (#549). Locks the shipment, requires it completed, never released or transferred, overdue, its seller rejected and any run holding it parked, then claims the shipment''s cancellation operation with source admin_overdue_payout (the fence fn_begin_shipment_transfer checks) and audits the claim. Returns claimed, busy or recovery_required like fn_claim_shipment_cancellation, plus the shipment, order and payment intent ids.';

COMMENT ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) IS 'Service-only (SECURITY DEFINER; EXECUTE revoked from PUBLIC, anon and authenticated because it moves a shipment to refunded and writes payout runs clients cannot touch): completes an overdue payout refund (#549) whose Stripe refund is recorded as succeeded, otherwise raises REFUND_NOT_SUCCEEDED and changes nothing. Moves the shipment from completed to refunded, adds the frozen Stripe fee loss to the order, records the label cost as lost, closes the payout run mappings that never transferred (and their run when nothing else is open), and notifies the buyer. Idempotent: a later call returns the same result.';

REVOKE ALL ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) TO "service_role";
