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
