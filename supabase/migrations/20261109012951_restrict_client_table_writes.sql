-- Orders, order items and disputes are written only by server code: Edge Functions with
-- the service role and SECURITY DEFINER RPCs owned by postgres. No client (the Expo app,
-- admin-web) writes these tables, so client roles keep SELECT and their read policies only.
--
-- The SECURITY INVOKER functions that write these tables (fn_shipments_status_trigger,
-- fn_release_shipment_funds) run only from service-role or postgres-owned paths, so no
-- client-callable path loses a privilege it needs.

DROP POLICY IF EXISTS "orders_insert" ON public.orders;
DROP POLICY IF EXISTS "disputes_insert" ON public.disputes;
DROP POLICY IF EXISTS "disputes_update" ON public.disputes;

-- Revoking the table privileges also revokes the matching column privileges.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.orders, public.order_items, public.disputes
  FROM PUBLIC, anon, authenticated;

-- A buyer reviews a seller only for a completed shipment of that seller in the buyer's
-- order. The review names that shipment and, optionally, one of its items. The app
-- offers the review only for completed shipments and always sends the shipment.
DROP POLICY IF EXISTS "reviews_insert" ON public.reviews;
CREATE POLICY "reviews_insert" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = reviewer_id
    AND EXISTS (
      SELECT 1
      FROM public.shipments s
      JOIN public.orders o ON o.id = s.order_id
      WHERE s.order_id = reviews.order_id
        AND s.seller_id = reviews.seller_id
        AND s.status = 'completed'
        AND o.buyer_id = (SELECT auth.uid())
        AND s.id = reviews.shipment_id
        AND (
          reviews.product_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.order_items oi
            WHERE oi.shipment_id = s.id
              AND oi.product_id = reviews.product_id
          )
        )
    )
  );

-- One review per reviewer, shipment and product, where a review without a product counts
-- once per shipment too (NULLS NOT DISTINCT).
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS "reviews_reviewer_shipment_product_unique";
ALTER TABLE public.reviews
  ADD CONSTRAINT "reviews_reviewer_shipment_product_unique"
  UNIQUE NULLS NOT DISTINCT (reviewer_id, shipment_id, product_id);
