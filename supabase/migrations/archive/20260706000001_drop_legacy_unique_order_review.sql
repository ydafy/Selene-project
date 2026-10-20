-- Drop the V1 unique constraint that enforces "one review per order".
--
-- V1 (`unique_order_review`) enforced UNIQUE (reviewer_id, order_id), which
-- blocks per-product reviews in multi-product shipments: once a buyer
-- reviewed ANY product in an order, no further reviews could be inserted for
-- that order — even for a different product in a different (completed)
-- shipment.
--
-- V2 (staged in 20260706000000_reviews_unique_per_product.sql) replaces this
-- with UNIQUE (reviewer_id, shipment_id, product_id), scoping uniqueness to
-- the shipment+product tuple. This allows one review per product per
-- shipment while still preventing duplicate reviews of the same product.
--
-- Context: discovered via dev logs on second review attempt — PostgREST
-- error 23505 "duplicate key value violates unique constraint
-- unique_order_review". The V1 constraint was created manually in Supabase
-- dashboard and was never captured in a repository migration before now.

ALTER TABLE reviews
  DROP CONSTRAINT IF EXISTS unique_order_review;
