-- Canonical definition of public.products_public: allow-list of columns and
-- public rows for non-owner product reads. See the migration for the grant review.

CREATE OR REPLACE VIEW public.products_public
WITH (security_barrier = true) AS
SELECT
  p.id,
  p.seller_id,
  p.name,
  p.description,
  p.price,
  p.category,
  p.condition,
  p.usage,
  p.images,
  p.specifications,
  p.aspect_ratio,
  p.status,
  p.views,
  p.created_at,
  p.fts
FROM public.products p
WHERE p.deleted_at IS NULL
  AND p.status IN ('VERIFIED', 'SOLD', 'PENDING_VERIFICATION', 'IN_REVIEW');

REVOKE ALL ON public.products_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.products_public TO anon, authenticated, service_role;
