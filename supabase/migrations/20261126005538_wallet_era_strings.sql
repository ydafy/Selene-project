SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fn_release_shipment_funds (
  p_shipment_id uuid
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_status public.order_status;
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

  RETURN QUERY SELECT true, 'SHIPMENT_COMPLETED'::text;
END;
$function$;

COMMENT ON COLUMN "public"."orders"."stripe_payment_intent_id" IS 'Stripe PaymentIntent that paid the whole order. fn_create_shipments_from_single_payment writes it and uses it as the idempotency key; each shipment of the order stores the same id in shipments.stripe_payment_intent_id.';

COMMENT ON COLUMN "public"."shipments"."stripe_payment_intent_id" IS 'Stripe PaymentIntent that paid this shipment, copied from its order. Without one the shipment has no payout path: fn_release_shipment_funds and fn_confirm_shipment_delivery refuse it (SHIPMENT_NOT_CONNECT).';

COMMENT ON FUNCTION "public"."fn_release_shipment_funds"(uuid) IS 'Marks a delivered Connect shipment completed when it has no active dispute and the 48-hour grace period has passed, which makes it payable from the admin payout queue. Moves no money. Called by fn_cron_dispute_shipping_timeout.';
