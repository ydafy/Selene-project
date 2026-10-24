-- Allow-list view of products for non-owner reads (purchase intent, T4d1).
--
-- Why: products grants are table-wide and RLS only filters rows, so a buyer who
-- can read a row reads every column (origin_zip, verification_data paths,
-- locked_by, publication_* economics, ...). This view exposes only the columns
-- a buyer needs. A new products column stays hidden until it is added here.
--
-- The view runs with its owner's rights on purpose (no security_invoker): once
-- products_select_public is dropped (T4d3) the view must still return public
-- rows, so the row predicate lives here. It equals products_select_public:
-- live rows in VERIFIED, SOLD, PENDING_VERIFICATION or IN_REVIEW.
-- security_barrier stops a caller-supplied filter or function from running
-- before the predicate and leaking hidden rows.
--
-- Grant review: PUBLIC, anon, authenticated and service_role lose every privilege
-- first (service_role would otherwise keep the default ALL), then
-- SELECT is granted to anon, authenticated and service_role only. The view is
-- not updatable by any API role (no INSERT/UPDATE/DELETE grant). Anonymous read
-- is intended: the listings are already public. No table policy or grant on
-- public.products changes.

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

REVOKE ALL ON public.products_public FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.products_public TO anon, authenticated, service_role;
