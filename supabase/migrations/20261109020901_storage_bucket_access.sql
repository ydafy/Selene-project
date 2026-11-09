-- Storage bucket limits and object policies for evidence, products and Avatars.
--
-- evidence: private. Paths are `<folder>/<order_id>/<uploader_id>/<file>`, uploaded
-- before any dispute row exists. `disputes/` is written by the order's buyer or
-- by a seller with a shipment in that order, `returns/` only by the buyer, and
-- `shipments/` (packing photos) only by such a seller. The third segment is always the
-- caller. The uploader and admins read the objects; clients share them through
-- signed URLs. The app uploads with upsert, so the uploader may overwrite their
-- own objects within the same rule. Clients never delete evidence.
-- Uploads are limited to 50 MiB and to photo and video types.
--
-- products: public. Paths are `<seller_id>/<file>`; a user uploads only into
-- their own folder. Photo types only, 10 MiB.
--
-- Avatars: public. Paths are `<user_id>/avatar.<ext>`. Files are served through
-- the public bucket URL; the object rows are readable by their owner and admins
-- (the owner policies support upsert). Photo types only, 2 MiB.
--
-- The `public-assets` bucket is unused and is removed from the Dashboard
-- (docs/go-live.md): Storage blocks direct SQL deletes on its tables.
--
-- Grant review (AGENTS.md): no function and no table privilege changes. Every new
-- policy is TO authenticated; anon has no policy on these buckets' objects and
-- service_role bypasses RLS. Policy subqueries run as the caller, under the
-- existing RLS of orders (the buyer reads their orders) and shipments (the seller
-- reads their shipments). Order ids are compared as text, so a segment that is
-- not a uuid fails the check instead of raising a cast error.

UPDATE storage.buckets
SET public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/x-m4v']
WHERE id = 'evidence';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
WHERE id = 'products';

UPDATE storage.buckets
SET file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
WHERE id = 'Avatars';

-- evidence
-- Despite its name, "Admins can read verification files" applies to the evidence
-- bucket; admins keep reading `verification` through "Allow Select Own Files 1ahc6qj_0".
DROP POLICY IF EXISTS "Admins can read verification files" ON storage.objects;
DROP POLICY IF EXISTS "Evidence Read Access" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to evidence" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to delete own evidence" ON storage.objects;

DROP POLICY IF EXISTS "evidence_select_uploader_or_admin" ON storage.objects;
CREATE POLICY "evidence_select_uploader_or_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'evidence'
    AND (
      (storage.foldername(objects.name))[3] = (SELECT auth.uid())::text
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "evidence_insert_order_participant" ON storage.objects;
CREATE POLICY "evidence_insert_order_participant" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'evidence'
    AND (storage.foldername(objects.name))[3] = (SELECT auth.uid())::text
    AND (
      (
        (storage.foldername(objects.name))[1] IN ('disputes', 'returns')
        AND EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id::text = (storage.foldername(objects.name))[2]
            AND o.buyer_id = (SELECT auth.uid())
        )
      )
      OR (
        (storage.foldername(objects.name))[1] IN ('disputes', 'shipments')
        AND EXISTS (
          SELECT 1 FROM public.shipments s
          WHERE s.order_id::text = (storage.foldername(objects.name))[2]
            AND s.seller_id = (SELECT auth.uid())
        )
      )
    )
  );

-- The uploader overwrites their own objects; the new row must pass the INSERT rule.
DROP POLICY IF EXISTS "evidence_update_order_participant" ON storage.objects;
CREATE POLICY "evidence_update_order_participant" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'evidence'
    AND (storage.foldername(objects.name))[3] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'evidence'
    AND (storage.foldername(objects.name))[3] = (SELECT auth.uid())::text
    AND (
      (
        (storage.foldername(objects.name))[1] IN ('disputes', 'returns')
        AND EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id::text = (storage.foldername(objects.name))[2]
            AND o.buyer_id = (SELECT auth.uid())
        )
      )
      OR (
        (storage.foldername(objects.name))[1] IN ('disputes', 'shipments')
        AND EXISTS (
          SELECT 1 FROM public.shipments s
          WHERE s.order_id::text = (storage.foldername(objects.name))[2]
            AND s.seller_id = (SELECT auth.uid())
        )
      )
    )
  );

-- products
DROP POLICY IF EXISTS "Authenticated Upload 1ifhysk_0" ON storage.objects;
DROP POLICY IF EXISTS "products_insert_own_folder" ON storage.objects;
CREATE POLICY "products_insert_own_folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(objects.name))[1] = (SELECT auth.uid())::text
  );

-- Avatars: the owner and admin read policies stay.
DROP POLICY IF EXISTS "Public Avatars Read Access" ON storage.objects;
