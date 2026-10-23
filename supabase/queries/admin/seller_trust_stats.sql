-- Canonical definition of per-seller listing counts used by the admin panel.
-- security_invoker keeps products RLS in force; is_admin() makes the view
-- return rows to admins only.
CREATE OR REPLACE VIEW public.seller_trust_stats WITH (security_invoker = true) AS
SELECT seller_id,
  count(*) AS total_listings,
  count(*) FILTER (WHERE status = 'VERIFIED'::public.product_status_enum) AS verified_count,
  count(*) FILTER (WHERE status = 'IN_REVIEW'::public.product_status_enum) AS in_review_count,
  count(*) FILTER (WHERE status = 'REJECTED'::public.product_status_enum) AS rejected_count,
  count(*) FILTER (WHERE status = 'SOLD'::public.product_status_enum) AS sold_count,
  count(*) FILTER (WHERE status = ANY (ARRAY['VERIFIED'::public.product_status_enum, 'SOLD'::public.product_status_enum, 'REJECTED'::public.product_status_enum])) AS processed_count
FROM public.products
WHERE deleted_at IS NULL
  AND public.is_admin()
GROUP BY seller_id;

REVOKE ALL ON public.seller_trust_stats FROM PUBLIC;
REVOKE ALL ON public.seller_trust_stats FROM anon;
REVOKE ALL ON public.seller_trust_stats FROM authenticated;
GRANT SELECT ON public.seller_trust_stats TO authenticated;
