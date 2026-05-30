-- Migration: Drop legacy columns from orders (moved to shipments)
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS tracking_number,
  DROP COLUMN IF EXISTS label_url,
  DROP COLUMN IF EXISTS last_tracked_at,
  DROP COLUMN IF EXISTS shipping_evidence,
  DROP COLUMN IF EXISTS origin_address;
