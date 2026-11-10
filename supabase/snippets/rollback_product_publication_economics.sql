BEGIN;

DROP TRIGGER IF EXISTS validate_product_publication_economics ON public.products;
DROP FUNCTION IF EXISTS public.backfill_product_publication_economics(UUID);
DROP FUNCTION IF EXISTS public.validate_product_publication_economics();
DROP FUNCTION IF EXISTS public.normalize_publication_rate(NUMERIC);

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS product_publication_economics_snapshot_check,
  DROP COLUMN IF EXISTS publication_shipping_reserve_cents,
  DROP COLUMN IF EXISTS publication_commission_rate,
  DROP COLUMN IF EXISTS publication_insurance_rate;

COMMIT;
