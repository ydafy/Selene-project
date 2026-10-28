-- ============================================================================
-- A dispute opens under the shipment row lock, from the shipment's own state.
--
-- create-dispute used to read the order status and delivery time and insert
-- the dispute afterwards, without looking at the shipment. fn_open_shipment_dispute
-- locks the shipment row FOR UPDATE (the lock the completion and release paths
-- take before they refuse on an active dispute) and, in one transaction:
--   * checks the shipment belongs to the order and the order to the buyer;
--   * allows only a shipped or delivered shipment;
--   * applies the 48 hour window to the shipment's own delivered_at (a NULL
--     delivered_at does not expire, as before);
--   * refuses a shipment with a started cancellation operation;
--   * refuses a second dispute for the shipment;
--   * inserts the open dispute with the shipment's seller.
-- It returns (dispute_id, error_code); exactly one is non-null.
--
-- Grant review: new SECURITY DEFINER function for the create-dispute Edge
-- Function only. It checks auth.role() = 'service_role', and this migration
-- also runs REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE
-- TO service_role, so no client can call it through the RPC.
--
-- Canonical copy: supabase/queries/disputes/fn_open_shipment_dispute.sql.
-- Apply this OR that, not both.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_open_shipment_dispute(
  p_buyer_id uuid,
  p_order_id uuid,
  p_shipment_id uuid,
  p_reason public.dispute_reason,
  p_description text,
  p_evidence jsonb
)
 RETURNS TABLE(dispute_id uuid, error_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status TEXT;
  v_delivered_at TIMESTAMPTZ;
  v_buyer_id UUID;
  v_dispute_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fn_open_shipment_dispute is service-role only' USING ERRCODE = '42501';
  END IF;

  -- The shipment lock serializes this with the completion and release paths,
  -- which take the same lock and refuse when a dispute exists.
  SELECT s.order_id, s.seller_id, s.status::TEXT, s.delivered_at
  INTO v_order_id, v_seller_id, v_status, v_delivered_at
  FROM public.shipments AS s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, 'SHIPMENT_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_order_id IS DISTINCT FROM p_order_id THEN
    RETURN QUERY SELECT NULL::UUID, 'SHIPMENT_ORDER_MISMATCH'::TEXT;
    RETURN;
  END IF;

  SELECT o.buyer_id INTO v_buyer_id
  FROM public.orders AS o
  WHERE o.id = p_order_id;

  IF NOT FOUND OR v_buyer_id IS DISTINCT FROM p_buyer_id THEN
    RETURN QUERY SELECT NULL::UUID, 'ORDER_BUYER_MISMATCH'::TEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('shipped', 'delivered') THEN
    RETURN QUERY SELECT NULL::UUID, ('DISPUTE_STATUS_NOT_ALLOWED:' || v_status)::TEXT;
    RETURN;
  END IF;

  IF v_status = 'delivered'
     AND v_delivered_at IS NOT NULL
     AND v_delivered_at < now() - interval '48 hours' THEN
    RETURN QUERY SELECT NULL::UUID, 'DISPUTE_WINDOW_EXPIRED'::TEXT;
    RETURN;
  END IF;

  -- A started cancellation operation means a refund was requested.
  IF EXISTS (
    SELECT 1
    FROM public.shipment_cancellation_operations AS operation
    WHERE operation.shipment_id = p_shipment_id
      AND operation.external_started_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT NULL::UUID, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'::TEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.disputes AS d WHERE d.shipment_id = p_shipment_id
  ) THEN
    RETURN QUERY SELECT NULL::UUID, 'DISPUTE_ALREADY_EXISTS'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.disputes (
    order_id, shipment_id, buyer_id, seller_id,
    reason, description, buyer_evidence, status
  ) VALUES (
    p_order_id, p_shipment_id, p_buyer_id, v_seller_id,
    p_reason, p_description, p_evidence, 'open'
  )
  RETURNING id INTO v_dispute_id;

  RETURN QUERY SELECT v_dispute_id, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_open_shipment_dispute(uuid, uuid, uuid, public.dispute_reason, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_open_shipment_dispute(uuid, uuid, uuid, public.dispute_reason, text, jsonb) TO service_role;

COMMIT;
