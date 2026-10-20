-- Storage part of the schema baseline. `supabase db dump` does not include the
-- managed `storage` schema, so buckets and storage.objects policies are
-- recreated here exactly as they exist in project acoiclkeymgtlwcxilun on
-- 2026-10-20. This mirrors the remote state; it does not fix it.
--
-- Idempotent: buckets use ON CONFLICT DO NOTHING and every policy is dropped
-- before it is created, so replaying it changes nothing.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('Avatars', 'Avatars', true, NULL, NULL),
  ('evidence', 'evidence', true, NULL, NULL),
  ('products', 'products', true, 10485760, ARRAY['image/*']),
  ('public-assets', 'public-assets', true, NULL, NULL),
  ('verification', 'verification', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admins can read verification files" ON storage.objects;
CREATE POLICY "Admins can read verification files" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'evidence' AND public.is_admin());

DROP POLICY IF EXISTS "Admins can view all avatars" ON storage.objects;
CREATE POLICY "Admins can view all avatars" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'Avatars' AND public.is_admin());

DROP POLICY IF EXISTS "Allow Select Own Files 1ahc6qj_0" ON storage.objects;
CREATE POLICY "Allow Select Own Files 1ahc6qj_0" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'verification');

DROP POLICY IF EXISTS "Allow Uploads 1ahc6qj_0" ON storage.objects;
CREATE POLICY "Allow Uploads 1ahc6qj_0" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'verification');

DROP POLICY IF EXISTS "Allow authenticated uploads to evidence" ON storage.objects;
CREATE POLICY "Allow authenticated uploads to evidence" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'evidence');

DROP POLICY IF EXISTS "Allow users to delete own evidence" ON storage.objects;
CREATE POLICY "Allow users to delete own evidence" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'evidence' AND name ~~ ('%' || auth.uid()::text || '%'));

DROP POLICY IF EXISTS "Authenticated Upload 1ifhysk_0" ON storage.objects;
CREATE POLICY "Authenticated Upload 1ifhysk_0" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'products');

DROP POLICY IF EXISTS "Evidence Read Access" ON storage.objects;
CREATE POLICY "Evidence Read Access" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'evidence' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Products Visual Access" ON storage.objects;
CREATE POLICY "Products Visual Access" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'products' AND (storage.foldername(name))[1] IS NOT NULL);

DROP POLICY IF EXISTS "Public Avatars Read Access" ON storage.objects;
CREATE POLICY "Public Avatars Read Access" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'Avatars' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can upload their own avatar h0za56_0" ON storage.objects;
CREATE POLICY "Users can upload their own avatar h0za56_0" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'Avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can upload their own avatar h0za56_1" ON storage.objects;
CREATE POLICY "Users can upload their own avatar h0za56_1" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'Avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can upload their own avatar h0za56_2" ON storage.objects;
CREATE POLICY "Users can upload their own avatar h0za56_2" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'Avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMIT;
