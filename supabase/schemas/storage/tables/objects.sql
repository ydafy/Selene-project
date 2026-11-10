CREATE POLICY "Admins can view all avatars" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING (((bucket_id = 'Avatars'::text) AND public.is_admin()));

CREATE POLICY "Allow Select Own Files 1ahc6qj_0" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'verification'::text) AND (public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.products p
  WHERE (((p.id)::text = (storage.foldername(objects.name))[1]) AND (p.seller_id = ( SELECT auth.uid() AS uid))))))));

CREATE POLICY "Allow Uploads 1ahc6qj_0" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'verification'::text) AND (EXISTS ( SELECT 1
   FROM public.products p
  WHERE (((p.id)::text = (storage.foldername(objects.name))[1]) AND (p.seller_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY "Products Visual Access" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING (((bucket_id = 'products'::text) AND ((storage.foldername(name))[1] IS NOT NULL)));

CREATE POLICY "Users can upload their own avatar h0za56_0" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'Avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "Users can upload their own avatar h0za56_1" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'Avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "Users can upload their own avatar h0za56_2" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'Avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "evidence_insert_order_participant" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((bucket_id = 'evidence'::text) AND ((storage.foldername(name))[3] = (( SELECT auth.uid() AS uid))::text) AND ((((storage.foldername(name))[1] = ANY (ARRAY['disputes'::text,
    'returns'::text])) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE (((o.id)::text = (storage.foldername(objects.name))[2]) AND (o.buyer_id = ( SELECT auth.uid() AS uid)))))) OR
    (((storage.foldername(name))[1] = ANY (ARRAY['disputes'::text, 'shipments'::text])) AND (EXISTS ( SELECT 1
   FROM public.shipments s
  WHERE (((s.order_id)::text = (storage.foldername(objects.name))[2]) AND (s.seller_id = ( SELECT auth.uid() AS uid)))))))));

CREATE POLICY "evidence_select_uploader_or_admin" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'evidence'::text) AND (((storage.foldername(name))[3] = (( SELECT auth.uid() AS uid))::text) OR public.is_admin())));

CREATE POLICY "evidence_update_order_participant" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'evidence'::text) AND ((storage.foldername(name))[3] = (( SELECT auth.uid() AS uid))::text)))
  WITH
    CHECK
    (((bucket_id = 'evidence'::text) AND ((storage.foldername(name))[3] = (( SELECT auth.uid() AS uid))::text) AND ((((storage.foldername(name))[1] = ANY (ARRAY['disputes'::text,
    'returns'::text])) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE (((o.id)::text = (storage.foldername(objects.name))[2]) AND (o.buyer_id = ( SELECT auth.uid() AS uid)))))) OR
    (((storage.foldername(name))[1] = ANY (ARRAY['disputes'::text, 'shipments'::text])) AND (EXISTS ( SELECT 1
   FROM public.shipments s
  WHERE (((s.order_id)::text = (storage.foldername(objects.name))[2]) AND (s.seller_id = ( SELECT auth.uid() AS uid)))))))));

CREATE POLICY "products_insert_own_folder" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'products'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
