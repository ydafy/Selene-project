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

GRANT EXECUTE ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) TO "service_role";

COMMENT ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) IS 'Service-only (SECURITY DEFINER; EXECUTE revoked from PUBLIC, anon and authenticated because it moves a shipment to refunded and writes payout runs clients cannot touch): completes an overdue payout refund (#549) whose Stripe refund is recorded as succeeded, otherwise raises REFUND_NOT_SUCCEEDED and changes nothing. Moves the shipment from completed to refunded, adds the frozen Stripe fee loss to the order, records the label cost as lost, closes the payout run mappings that never transferred (and their run when nothing else is open), and notifies the buyer. Idempotent: a later call returns the same result.';

REVOKE ALL ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_complete_overdue_payout_refund"(uuid) FROM PUBLIC, "anon", "authenticated";
