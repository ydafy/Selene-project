SET local check_function_bodies = off;

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
    -- records the shipment as refunded (S3), unless it failed and an admin
    -- recorded repaying the buyer by hand (fn_resolve_shipment_cancellation_refund, L11).
    IF v_operation.refund_status IS DISTINCT FROM 'succeeded'
       AND NOT COALESCE(v_operation.refund_resolved_at IS NOT NULL
         AND v_operation.refund_status IN ('failed', 'canceled'), FALSE) THEN
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
    -- open mapping is closed too. A parked run that still holds other shipments
    -- waits for an admin, and its reason is no longer the one an account update
    -- resumes; one that already resumed may be transferring them and is left
    -- as it is (L12).
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
          WHERE id = v_mapping.run_id AND stripe_payout_id IS NULL AND release_stage = 'action_required'
            AND status IN ('pending_reconciliation', 'reconciliation_needed');
      END IF;
    END LOOP;

    -- The buyer notice of a refund, as the dispute refund sends it, or of the
    -- manual repayment that replaced a failed one.
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
      CASE WHEN v_operation.refund_status = 'succeeded'
        THEN 'Reembolsamos tu compra a tu método de pago. Puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.'
        ELSE 'El reembolso a tu método de pago no se completó, así que te devolvimos el dinero de tu compra por otro medio.'
      END,
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

CREATE OR REPLACE FUNCTION public.fn_resolve_shipment_cancellation_refund (
  p_shipment_id uuid,
  p_admin_id    uuid,
  p_reference   text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_reference TEXT := btrim(p_reference);
  v_shipment_status TEXT;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_amount_owed BIGINT;
  v_unrecorded_escalated BOOLEAN;
  v_cancelled BOOLEAN := FALSE;
  v_cancel_success BOOLEAN;
  v_cancel_error TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Defense in depth: the admin id is written to the audit log, so it must be an
  -- active admin by the same rule as is_admin(), not only what the caller checked.
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF v_reference IS NULL OR v_reference = '' OR char_length(v_reference) > 200 THEN
    RAISE EXCEPTION 'INVALID_RESOLUTION_REFERENCE';
  END IF;

  -- The lock order of fn_begin_shipment_transfer and fn_complete_overdue_payout_refund:
  -- the payout runs and mappings of a completed shipment, then the shipment. A
  -- cancelled shipment was never released, so it has none and only the shipment
  -- is locked first, as in claim/start, record and fn_cancel_shipment.
  PERFORM 1 FROM public.connect_payout_runs r
    WHERE r.id IN (SELECT m.run_id FROM public.connect_payout_run_shipments m
      WHERE m.shipment_id = p_shipment_id AND m.status IN ('pending_reconciliation', 'reconciliation_needed'))
    ORDER BY r.id FOR UPDATE;
  PERFORM 1 FROM public.connect_payout_run_shipments m
    WHERE m.shipment_id = p_shipment_id AND m.status IN ('pending_reconciliation', 'reconciliation_needed')
    ORDER BY m.id FOR UPDATE;
  SELECT status::text INTO v_shipment_status
    FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE'; END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.external_started_at IS NULL OR v_operation.refund_request IS NULL THEN
    RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE';
  END IF;
  -- Escalation markers stay as history: this function never clears them.
  v_unrecorded_escalated := v_operation.refund_id IS NULL AND v_operation.refund_status IS NULL
    AND v_operation.recovery_escalated_at IS NOT NULL;
  IF NOT v_unrecorded_escalated AND (v_operation.refund_id IS NULL OR v_operation.refund_status IS NULL) THEN
    RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE';
  END IF;
  v_amount_owed := (v_operation.refund_request->>'amount')::BIGINT;

  -- Idempotent: a second resolve never overwrites the first admin or reference.
  IF v_operation.refund_resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('resolved', FALSE, 'shipment_cancelled', FALSE,
      'amount_owed_cents', v_amount_owed, 'reference', v_operation.refund_resolution_reference);
  END IF;

  IF NOT v_unrecorded_escalated AND v_operation.refund_status NOT IN ('failed', 'canceled') THEN
    RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE';
  END IF;
  IF v_operation.source = 'admin_overdue_payout' THEN
    -- An overdue payout refund (#549) is repaid by hand only after Stripe
    -- reported its refund failed or canceled, so the money is back in Selene's
    -- balance; an escalated operation without a refund may still pay out (L11).
    IF v_unrecorded_escalated THEN RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE'; END IF;
    IF v_shipment_status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'SHIPMENT_STATUS_UNEXPECTED: %', v_shipment_status;
    END IF;
  ELSIF v_shipment_status NOT IN ('paid', 'preparing', 'cancelled') THEN
    RAISE EXCEPTION 'SHIPMENT_STATUS_UNEXPECTED: %', v_shipment_status;
  END IF;

  UPDATE public.shipment_cancellation_operations
    SET refund_resolved_at = clock_timestamp(),
        refund_resolved_by = p_admin_id,
        refund_resolution_reference = v_reference
    WHERE shipment_id = p_shipment_id;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (p_admin_id, 'SHIPMENT_REFUND_RESOLVED', p_shipment_id,
    jsonb_build_object(
      'refund_id', v_operation.refund_id,
      'refund_status', v_operation.refund_status,
      'amount_owed_cents', v_amount_owed,
      'reference', v_reference,
      'shipment_status_before', v_shipment_status)
    || CASE WHEN v_operation.recovery_escalation_reason IS NULL THEN '{}'::JSONB
            ELSE jsonb_build_object('escalation_reason', v_operation.recovery_escalation_reason) END);

  IF v_operation.source = 'admin_overdue_payout' THEN
    -- The completion of a succeeded overdue refund: refunded, loss, run
    -- mappings and buyer notice, once.
    PERFORM public.fn_complete_overdue_payout_refund(p_shipment_id);
  ELSIF v_shipment_status IN ('paid', 'preparing') THEN
    -- Complete with the stored winner, reason and frozen loss, never the admin's.
    SELECT c.success, c.error_message INTO v_cancel_success, v_cancel_error
      FROM public.fn_cancel_shipment(
        p_shipment_id,
        CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source ELSE 'system' END,
        v_operation.reason,
        v_operation.cancellation_loss_cents) AS c;
    IF v_cancel_success IS NOT TRUE OR v_cancel_error IS NOT NULL THEN
      RAISE EXCEPTION 'CANCELLATION_COMPLETE_FAILED: %', COALESCE(v_cancel_error, 'UNKNOWN');
    END IF;
    v_cancelled := TRUE;
  END IF;

  RETURN jsonb_build_object('resolved', TRUE, 'shipment_cancelled', v_cancelled,
    'amount_owed_cents', v_amount_owed, 'reference', v_reference);
END;
$function$;

COMMENT ON COLUMN "public"."connect_payout_runs"."action_required_reason" IS 'Why a run sits in the action_required stage. Only the account_not_actionable reason may be auto-resumed by a later actionable account update; every other action_required state requires an admin decision, including overdue_payout_refunded (an overdue payout refund (#549) refunded one of the shipments of the parked run).';

COMMENT ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) IS 'Service-only (SECURITY DEFINER; EXECUTE revoked from PUBLIC, anon and authenticated because it moves a shipment to refunded and writes payout runs clients cannot touch): completes an overdue payout refund (#549) whose Stripe refund is recorded as succeeded, or failed and resolved by an admin who repaid the buyer by hand, otherwise raises REFUND_NOT_SUCCEEDED and changes nothing. Moves the shipment from completed to refunded, adds the frozen Stripe fee loss to the order, records the label cost as lost, closes the payout run mappings that never transferred (and their run when nothing else is open; a parked run that holds other shipments waits for an admin, a resumed one is left as it is), and notifies the buyer. Idempotent: a later call returns the same result.';

COMMENT ON FUNCTION "public"."fn_resolve_shipment_cancellation_refund"(uuid, uuid, text) IS 'Service-only (SECURITY DEFINER): an admin marks a failed or canceled shipment refund, or an escalated operation without a refund, as resolved with a reference (audited) and, when the shipment is still open, completes the cancellation. A failed or canceled overdue payout refund (#549) of a completed shipment is resolved the same way and refunds the shipment through fn_complete_overdue_payout_refund. The caller must have verified the admin; the amount owed is the frozen request amount.';
