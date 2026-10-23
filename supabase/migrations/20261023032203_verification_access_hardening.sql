-- Verification access hardening (pre-existing leak, closed before listings in
-- review become publicly visible).
--
-- Leak: the storage policies "Allow Select Own Files 1ahc6qj_0" and "Allow
-- Uploads 1ahc6qj_0" on the private `verification` bucket only checked
-- bucket_id, so any authenticated user could read or upload any listing's
-- proof files. admin_product_queue_view and seller_trust_stats were also
-- SELECTable by anon and authenticated.
--
-- Rule: proofs live at `<product_id>/...`. SELECT is allowed to an admin or to
-- the seller of that product; INSERT only to the seller. UPDATE/DELETE policies
-- are untouched. Both views now return rows only when public.is_admin().
--
-- Grant review (AGENTS.md): no SECURITY DEFINER function is added. The views
-- stay security_invoker; anon and PUBLIC lose every privilege, authenticated
-- keeps SELECT (admins are authenticated), service_role keeps its grants.

-- Canonical storage policies for the private `verification` bucket.
-- Object paths are `<product_id>/<prefix>_<timestamp>.<ext>`, so the first
-- folder segment identifies the listing. Only the listing's seller or an admin
-- reads proofs; only the seller uploads them. No policy for anon or public.
-- UPDATE/DELETE policies are intentionally untouched. The name is qualified as
-- objects.name because products also has a `name` column that would shadow it.

DROP POLICY IF EXISTS "Allow Select Own Files 1ahc6qj_0" ON storage.objects;
CREATE POLICY "Allow Select Own Files 1ahc6qj_0" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'verification'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id::text = (storage.foldername(objects.name))[1]
          AND p.seller_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Allow Uploads 1ahc6qj_0" ON storage.objects;
CREATE POLICY "Allow Uploads 1ahc6qj_0" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'verification'
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id::text = (storage.foldername(objects.name))[1]
        AND p.seller_id = (SELECT auth.uid())
    )
  );

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
