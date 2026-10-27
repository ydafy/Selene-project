BEGIN
  -- 1. Bloquear shipment
  PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- Connect guard: if shipment was paid via Stripe Connect, mark it completed.
  -- Stripe Connect handles fund routing; the payout is released from the admin queue.
  IF EXISTS (
    SELECT 1 FROM public.shipments
    WHERE id = p_shipment_id AND stripe_payment_intent_id IS NOT NULL
  ) THEN
    -- Mark shipment as completed
    UPDATE public.shipments SET status = 'completed' WHERE id = p_shipment_id;
    RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET'::TEXT; RETURN;
  END IF;

  -- Shipments without a Stripe payment intent have no payout path since the
  -- internal balance was removed: refuse instead of completing without a payout.
  RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::TEXT; RETURN;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_release_shipment_funds',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
