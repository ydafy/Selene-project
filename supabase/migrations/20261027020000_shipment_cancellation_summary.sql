-- B5.5: participant read of one shipment's cancellation, so the buyer and the seller can see why it
-- was cancelled and where the buyer refund stands. Requires the B4.4a carrier review SQL first
-- (shipment_cancellation_carrier_review.sql), which is the last one to add operation columns.
-- Apply the matching migration OR this identical canonical copy, not both.
BEGIN;

-- Returns at most one row, only to the order's buyer or the shipment's seller, and only when a
-- cancellation operation exists. Any other caller, an unknown shipment and a shipment without an
-- operation all get zero rows, never an error, so the call does not reveal that a shipment exists.
-- Only the source and a coarse refund state leave the table: no amounts, refund or payment ids,
-- free-text reason, actor ids, Stripe failure reasons or admin notes.
--
-- refund_state, from the operation columns (first match wins):
--   refunded    refund_status = 'succeeded', or an admin marked the refund resolved
--               (refund_resolved_at: the money went back outside Stripe)
--   delayed     the refund needs a person: refund_status failed or canceled, recovery escalated
--               (recovery_escalated_at), carrier review pending (review_required_at set and
--               review_resolution NULL), or the review closed without a refund (closed_no_refund:
--               nothing will refund it automatically; that shipment is not cancelled, so the
--               cancelled-shipment banner never shows this state for it)
--   processing  everything else: no refund recorded yet, pending, requires_action, or a review
--               approved for refund that the next cron run will execute
-- refund_updated_at is refund_status_updated_at and is NULL until a refund is recorded.
CREATE OR REPLACE FUNCTION public.fn_get_shipment_cancellation_summary(p_shipment_id UUID)
RETURNS TABLE (source TEXT, refund_state TEXT, refund_updated_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.source,
         CASE
           WHEN o.refund_status = 'succeeded' OR o.refund_resolved_at IS NOT NULL THEN 'refunded'
           WHEN o.refund_status IN ('failed', 'canceled')
             OR o.recovery_escalated_at IS NOT NULL
             OR (o.review_required_at IS NOT NULL AND o.review_resolution IS NULL)
             OR o.review_resolution = 'closed_no_refund' THEN 'delayed'
           ELSE 'processing'
         END,
         o.refund_status_updated_at
  FROM public.shipment_cancellation_operations o
  JOIN public.shipments s ON s.id = o.shipment_id
  JOIN public.orders ord ON ord.id = s.order_id
  WHERE o.shipment_id = p_shipment_id
    AND auth.uid() IS NOT NULL
    AND (ord.buyer_id = auth.uid() OR s.seller_id = auth.uid());
$$;

COMMENT ON FUNCTION public.fn_get_shipment_cancellation_summary(UUID) IS
  'Participant read (SECURITY DEFINER): source and coarse refund state of one shipment cancellation, only for its buyer or seller; zero rows for anyone else.';

-- SECURITY DEFINER bypasses RLS on the operations table (no client can read it), so access is the
-- auth.uid() filter above. Signed-in users only: anon is revoked explicitly because default
-- privileges would otherwise grant it, and service_role has no auth.uid() (it would get no rows).
REVOKE ALL ON FUNCTION public.fn_get_shipment_cancellation_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_shipment_cancellation_summary(UUID) TO authenticated;

COMMIT;
