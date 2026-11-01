-- ============================================================================
-- shipment.refunded: buyer notice when the Stripe refund of a dispute is
-- recorded (expo-push-notifications T6b, S4).
--
-- Why: the buyer learned that the money came back only by opening the order.
-- fn_record_dispute_refund now writes a typed notice to orders.buyer_id of the
-- shipment, in the same transaction that marks the shipment refunded.
--
-- Branch rule: only the branch that runs the UPDATE of the shipment to refunded
-- writes the notice. The ALREADY_RECORDED replay and every refusal write
-- nothing. Guards, lock order, return values and the system_logs row are
-- unchanged.
--
-- Idempotency: source_event_key is 'shipment.refunded:<shipment_id>', so the
-- unique (source_event_key, user_id) index keeps one notice per shipment.
--
-- Subtransaction: the notice is secondary to the refund record, which runs
-- after the Stripe refund was created (a rollback here means a refund made
-- without its database record). The insert runs inside BEGIN ... EXCEPTION, so
-- a failure rolls back only the notice and writes a WARNING to system_logs.
-- That log insert is guarded too: if it also fails, a RAISE WARNING goes to the
-- Postgres log and the refund record still commits.
--
-- Catalogue: keeps the 15 kinds of 20261030233800_shipment_funds_released_notification.sql
-- and adds shipment.refunded. Never drop a kind when adding one. The kind is
-- pushed to the buyer on the orders channel.
--
-- Grant review (AGENTS.md): fn_record_dispute_refund stays SECURITY DEFINER with
-- search_path '' because it writes a notice for another user. It restates
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE ... TO
-- service_role exactly as 20261028232406_record_dispute_refund.sql does;
-- nothing is granted to a client.
--
-- Canonical definition: supabase/queries/disputes/fn_record_dispute_refund.sql
-- ============================================================================
BEGIN;

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_event_kind_catalogue_chk,
  ADD CONSTRAINT notifications_event_kind_catalogue_chk
    CHECK (event_kind IS NULL OR event_kind IN (
      'order.payment_confirmed',
      'shipment.cancelled',
      'shipment.refund_failed',
      'dispute.opened',
      'dispute.verdict',
      'product.approved',
      'product.approved_with_note',
      'product.rejected',
      'return.seller_evidence_submitted',
      'return.delivered',
      'product.available',
      'product.interest',
      'shipment.in_transit',
      'shipment.delivered',
      'shipment.funds_released',
      'shipment.refunded'
    ));

CREATE OR REPLACE FUNCTION public.fn_record_dispute_refund(
  p_dispute_id uuid,
  p_stripe_refund_id text
)
 RETURNS TABLE(success boolean, error_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_shipment_id UUID;
  v_dispute_status TEXT;
  v_shipment_status TEXT;
  v_payment_intent TEXT;
  v_resolution TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fn_record_dispute_refund is service-role only' USING ERRCODE = '42501';
  END IF;

  SELECT d.shipment_id INTO v_shipment_id
  FROM public.disputes AS d
  WHERE d.id = p_dispute_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  -- The shipment lock serializes this with the completion and release paths.
  SELECT s.status::TEXT, s.stripe_payment_intent_id
  INTO v_shipment_status, v_payment_intent
  FROM public.shipments AS s
  WHERE s.id = v_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_payment_intent IS NULL THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::TEXT;
    RETURN;
  END IF;

  SELECT d.status::TEXT, d.resolution_type
  INTO v_dispute_status, v_resolution
  FROM public.disputes AS d
  WHERE d.id = p_dispute_id
  FOR UPDATE;

  -- A repeated call after the refund was recorded changes nothing.
  IF v_shipment_status = 'refunded'
     AND v_dispute_status = 'resolved'
     AND v_resolution = 'buyer' THEN
    RETURN QUERY SELECT true, 'ALREADY_RECORDED'::TEXT;
    RETURN;
  END IF;

  IF v_dispute_status NOT IN ('waiting_return', 'return_delivered') THEN
    RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT;
    RETURN;
  END IF;

  IF v_shipment_status NOT IN ('shipped', 'delivered') THEN
    RETURN QUERY SELECT false, ('SHIPMENT_NOT_REFUNDABLE:' || v_shipment_status)::TEXT;
    RETURN;
  END IF;

  UPDATE public.shipments
  SET status = 'refunded',
      updated_at = now()
  WHERE id = v_shipment_id;

  UPDATE public.disputes
  SET status = 'resolved',
      resolution_type = 'buyer',
      admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Reembolso Stripe ' || COALESCE(p_stripe_refund_id, 'unknown') || ' registrado.',
      updated_at = now()
  WHERE id = p_dispute_id;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Dispute refund recorded',
          jsonb_build_object(
            'dispute_id', p_dispute_id,
            'shipment_id', v_shipment_id,
            'stripe_refund_id', p_stripe_refund_id));

  -- The buyer notice is best effort: a failing insert must never undo the
  -- recorded refund, so it runs in its own subtransaction.
  BEGIN
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload, type, title, message, action_path
    )
    SELECT o.buyer_id,
           'shipment.refunded',
           'shipment.refunded:' || v_shipment_id::text,
           jsonb_build_object('shipment_id', v_shipment_id, 'order_id', s.order_id,
             'dispute_id', p_dispute_id, 'recipient_role', 'buyer'),
           'success',
           'Te devolvimos tu dinero',
           'Reembolsamos tu compra a tu método de pago. Puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.',
           '/profile/orders/' || s.order_id::text
    FROM public.shipments AS s
    JOIN public.orders AS o ON o.id = s.order_id
    WHERE s.id = v_shipment_id
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('WARNING', 'Refund notice failed',
              jsonb_build_object('dispute_id', p_dispute_id, 'shipment_id', v_shipment_id,
                'sqlstate', SQLSTATE, 'error', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Refund notice failed and could not be logged: %', SQLERRM;
    END;
  END;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_dispute_refund(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_dispute_refund(uuid, text) TO service_role;

INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES
  ('shipment.refunded', 'buyer', 'orders');

COMMIT;
