
DECLARE
  v_order_id uuid;
  v_buyer_id uuid;
  v_status public.order_status_enum;
  v_delivered_at timestamptz;
  v_buyer_confirmed_at timestamptz;
  v_is_connect BOOLEAN;
  v_completion_source text;
  v_completed_at timestamptz := now();
BEGIN
  IF coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  ) <> 'service_role' THEN
    RETURN QUERY SELECT false, 'SERVICE_ROLE_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('buyer', 'auto') THEN
    RETURN QUERY SELECT false, 'INVALID_COMPLETION_SOURCE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN QUERY SELECT false, 'IDEMPOTENCY_KEY_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer'
    AND p_idempotency_key <> 'confirm_shipment_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'auto'
    AND p_idempotency_key <> 'auto_completion_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  SELECT
    s.order_id,
    s.status,
    s.delivered_at,
    s.buyer_confirmed_at,
    s.stripe_payment_intent_id IS NOT NULL
  INTO
    v_order_id,
    v_status,
    v_delivered_at,
    v_buyer_confirmed_at,
    v_is_connect
  FROM public.shipments AS s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::text, NULL::text, false;
    RETURN;
  END IF;

  IF v_status = 'completed' THEN
    SELECT event.source
    INTO v_completion_source
    FROM public.shipment_completion_events AS event
    WHERE event.shipment_id = p_shipment_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'COMPLETION_AUDIT_MISSING'::text, NULL::text, false;
      RETURN;
    END IF;

    RETURN QUERY SELECT true, NULL::text, v_completion_source, true;
    RETURN;
  END IF;

  -- Read after the shipment lock, like fn_begin_shipment_transfer: a started cancellation
  -- operation means a refund was requested, so the shipment must end cancelled, never completed.
  IF EXISTS (
    SELECT 1
    FROM public.shipment_cancellation_operations AS operation
    WHERE operation.shipment_id = p_shipment_id
      AND operation.external_started_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF NOT v_status = 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.disputes AS dispute
    WHERE dispute.shipment_id = p_shipment_id
      AND dispute.status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_HAS_ACTIVE_DISPUTE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer' THEN
    SELECT buyer_id INTO v_buyer_id
    FROM public.orders
    WHERE id = v_order_id;

    IF p_actor_id IS NULL OR v_buyer_id IS DISTINCT FROM p_actor_id THEN
      RETURN QUERY SELECT false, 'BUYER_REQUIRED'::text, NULL::text, false;
      RETURN;
    END IF;
  ELSIF p_actor_id IS NOT NULL OR v_buyer_confirmed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  ELSIF v_delivered_at IS NULL
    OR NOT (v_delivered_at <= now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  END IF;

  -- Shipments without a Stripe payment intent have no payout path since the
  -- internal balance was removed: refuse them before any state changes.
  IF NOT v_is_connect THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::text, NULL::text, false;
    RETURN;
  END IF;

  INSERT INTO public.shipment_completion_events (
    shipment_id,
    order_id,
    source,
    actor_id,
    idempotency_key,
    completed_at,
    is_connect
  ) VALUES (
    p_shipment_id,
    v_order_id,
    p_source,
    p_actor_id,
    p_idempotency_key,
    v_completed_at,
    v_is_connect
  );

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'INFO',
    'Connect shipment completion skipped deprecated wallet release',
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'source', p_source,
      'is_connect', true
    )
  );

  UPDATE public.shipments
  SET status = 'completed',
      completed_at = v_completed_at,
      buyer_confirmed_at = CASE
        WHEN p_source = 'buyer' THEN v_completed_at
        ELSE buyer_confirmed_at
      END,
      updated_at = v_completed_at
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::text, p_source, false;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'ERROR',
    'Shipment completion RPC failed',
    jsonb_build_object('shipment_id', p_shipment_id, 'sqlstate', SQLSTATE)
  );
  RETURN QUERY SELECT false, 'INTERNAL_ERROR'::text, NULL::text, false;
END;
