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

  IF v_operation.refund_status = 'succeeded' AND v_shipment_status IN ('paid', 'preparing') THEN
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

GRANT EXECUTE ON FUNCTION "public"."fn_apply_shipment_cancellation_refund_event"(uuid, text, text, bigint, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_apply_shipment_cancellation_refund_event"(uuid, text, text, bigint, text, text) IS 'Service-only (SECURITY DEFINER): applies a Stripe refund event to a started shipment cancellation, completes the cancellation on succeeded and notifies the buyer on failure. The amount owed is the frozen request amount, never the event.';

REVOKE ALL ON FUNCTION "public"."fn_apply_shipment_cancellation_refund_event"(uuid, text, text, bigint, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_apply_shipment_cancellation_refund_event"(uuid, text, text, bigint, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_apply_shipment_cancellation_refund_event"(uuid, text, text, bigint, text, text) FROM PUBLIC, "anon", "authenticated";
