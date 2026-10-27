DECLARE
  v_status public.order_status_enum;
  v_delivered_at timestamptz;
  v_is_connect boolean;
BEGIN
  SELECT s.status, s.delivered_at, s.stripe_payment_intent_id IS NOT NULL
  INTO v_status, v_delivered_at, v_is_connect
  FROM public.shipments AS s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::text; RETURN;
  END IF;

  -- Shipments without a Stripe payment intent have no payout path since the
  -- internal balance was removed: refuse instead of completing without a payout.
  IF NOT v_is_connect THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::text; RETURN;
  END IF;

  -- A completed shipment becomes payable from the admin payout queue, so it
  -- completes only after delivery, with no open dispute, past the grace period.
  IF v_status IS DISTINCT FROM 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_DELIVERED'::text; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.disputes AS dispute
    WHERE dispute.shipment_id = p_shipment_id
      AND dispute.status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_IN_ACTIVE_DISPUTE'::text; RETURN;
  END IF;

  IF v_delivered_at IS NULL
    OR NOT (v_delivered_at <= now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'GRACE_PERIOD_ACTIVE'::text; RETURN;
  END IF;

  UPDATE public.shipments
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET'::text;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_release_shipment_funds',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
