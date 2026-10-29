-- ============================================================================
-- A dispute refund is recorded from the shipment state, after the Stripe refund.
--
-- resolve-dispute-refund used to update the shipment directly after the Stripe
-- refund and leave the dispute open. fn_record_dispute_refund replaces that
-- write. It locks the shipment row FOR UPDATE (then the dispute row) and, in
-- one transaction:
--   * refuses a missing dispute or shipment, and a shipment without a Stripe
--     payment intent (legacy shipments use fn_complete_shipment_refund);
--   * returns ALREADY_RECORDED, with no write, when the shipment is already
--     refunded and the dispute resolved for the buyer;
--   * refuses a dispute that is not waiting_return or return_delivered;
--   * refuses a shipment that is not shipped or delivered;
--   * marks the shipment refunded, resolves the dispute for the buyer, notes
--     the Stripe refund id in admin_notes and writes one system_logs row.
-- It returns (success, error_code); error_code is NULL on a first success.
--
-- Grant review: new SECURITY DEFINER function for the resolve-dispute-refund
-- Edge Function only. It checks auth.role() = 'service_role', and this
-- migration also runs REVOKE ALL ... FROM PUBLIC, anon, authenticated and
-- GRANT EXECUTE TO service_role, so no client can call it through the RPC.
--
-- Canonical copy: supabase/queries/disputes/fn_record_dispute_refund.sql.
-- Apply this OR that, not both.
-- ============================================================================
BEGIN;

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

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_dispute_refund(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_dispute_refund(uuid, text) TO service_role;

COMMIT;
