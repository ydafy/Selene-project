-- Canonical definition of the admin verification queue. security_invoker keeps
-- products RLS in force; is_admin() makes the view return rows to admins only.
CREATE OR REPLACE VIEW public.admin_product_queue_view WITH (security_invoker = true) AS
SELECT id,
  created_at,
  name,
  description,
  price,
  category,
  condition,
  usage,
  images,
  status,
  specifications,
  seller_id,
  views,
  aspect_ratio,
  verification_data,
  rejection_reason,
  shipping_cost,
  shipping_payer,
  origin_zip,
  package_preset,
  updated_at,
  reserved_at,
  verified_at,
  locked_by,
  locked_at,
  fts,
  deleted_at
FROM public.products
WHERE status = 'PENDING_VERIFICATION'::public.product_status_enum
  AND deleted_at IS NULL
  AND public.is_admin()
ORDER BY created_at;

REVOKE ALL ON public.admin_product_queue_view FROM PUBLIC;
REVOKE ALL ON public.admin_product_queue_view FROM anon;
REVOKE ALL ON public.admin_product_queue_view FROM authenticated;
GRANT SELECT ON public.admin_product_queue_view TO authenticated;
