-- V2 per-product reviews: enforce one review per (buyer, shipment, product).
--
-- The `reviews` table already carries `reviewer_id`, `shipment_id` and
-- `product_id` (nullable, with FKs). V1 wrote one review per shipment scoped
-- to the shipment's first product; V2 expands to one review per product within
-- a shipment. Without a uniqueness guard, a buyer could submit two reviews
-- for the same product in the same shipment, which would corrupt the
-- verified-purchase identity contract (`reviewer_id, shipment_id, product_id`).
--
-- This migration adds a UNIQUE constraint that treats NULL linkage columns as
-- distinct (Postgres default), so legacy order-first reviews (where
-- `shipment_id` / `product_id` are NULL) remain allowed and are NOT collapsed
-- together — only fully-linked rows are deduplicated.
--
-- NOTE: `NULLS NOT DISTINCT` (Postgres 15+) is intentionally NOT used here so
-- the constraint stays compatible with older Supabase/Postgres versions and
-- preserves legacy NULL rows. If a stricter "one review per order regardless
-- of linkage" guarantee is later required, ship a follow-up migration with a
-- partial unique index on `(reviewer_id, order_id)` where `shipment_id IS NULL`.

ALTER TABLE reviews
  ADD CONSTRAINT reviews_reviewer_shipment_product_unique
  UNIQUE (reviewer_id, shipment_id, product_id);