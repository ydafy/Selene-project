SET local check_function_bodies = off;

DROP POLICY "addresses_delete_policy" ON "public"."addresses";

DROP POLICY "addresses_insert_policy" ON "public"."addresses";

DROP POLICY "addresses_select_policy" ON "public"."addresses";

DROP POLICY "addresses_update_policy" ON "public"."addresses";

DROP POLICY "products_select_admin" ON "public"."products";

DROP POLICY "products_select_owner" ON "public"."products";

DROP POLICY "products_update_admin" ON "public"."products";

DROP POLICY "products_update_owner" ON "public"."products";

DROP POLICY "admin_payments_select" ON "public"."profiles";

DROP POLICY "profiles_private_access" ON "public"."profiles_private";

DROP POLICY "shipment tracking events are visible to participants and admins" ON "public"."shipment_tracking_events";

DROP POLICY "shipments_select_admin" ON "public"."shipments";

DROP POLICY "shipments_select_buyer" ON "public"."shipments";

DROP POLICY "shipments_select_policy" ON "public"."shipments";

DROP POLICY "shipments_select_seller" ON "public"."shipments";

DROP POLICY "Admins can view all avatars" ON "storage"."objects";

DROP POLICY "Allow Select Own Files 1ahc6qj_0" ON "storage"."objects";

DROP POLICY "Users can upload their own avatar h0za56_0" ON "storage"."objects";

DROP POLICY "Users can upload their own avatar h0za56_1" ON "storage"."objects";

DROP POLICY "Users can upload their own avatar h0za56_2" ON "storage"."objects";

DROP POLICY "evidence_select_uploader_or_admin" ON "storage"."objects";

CREATE OR REPLACE FUNCTION internal.fn_check_order_access (
  p_order_id uuid,
  p_user_id  uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
    RETURN EXISTS (
        -- Regla 1: El usuario es el comprador de la orden
        SELECT 1 FROM public.orders WHERE id = p_order_id AND buyer_id = p_user_id
        UNION ALL
        -- Regla 2: El usuario es vendedor de algún artículo en la orden
        SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND seller_id = p_user_id
        UNION ALL
        -- Regla 3: Override de Administrador (Verifica directo en profiles_private)
        SELECT 1 FROM public.profiles_private WHERE id = p_user_id AND role = 'admin'
    );
END; $function$;

CREATE POLICY "addresses_delete_policy" ON "public"."addresses"
  FOR DELETE
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "addresses_insert_policy" ON "public"."addresses"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "addresses_select_policy" ON "public"."addresses"
  FOR SELECT
  TO "authenticated"
  USING (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.is_admin() AS is_admin)));

CREATE POLICY "addresses_update_policy" ON "public"."addresses"
  FOR UPDATE
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "products_select_owner_or_admin" ON "public"."products"
  FOR SELECT
  TO "authenticated"
  USING (((seller_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

CREATE POLICY "products_update_owner_or_admin" ON "public"."products"
  FOR UPDATE
  TO "authenticated"
  USING
    ((( SELECT public.is_admin() AS is_admin) OR ((seller_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL) AND (status = ANY
    (ARRAY['PENDING_VERIFICATION'::public.product_status_enum, 'VERIFIED'::public.product_status_enum, 'HIDDEN'::public.product_status_enum,
    'REJECTED'::public.product_status_enum])) AND ( SELECT public.fn_current_account_is_active() AS fn_current_account_is_active))))
  WITH
    CHECK
    ((( SELECT public.is_admin() AS is_admin) OR ((seller_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['PENDING_VERIFICATION'::public.product_status_enum,
    'VERIFIED'::public.product_status_enum,
    'HIDDEN'::public.product_status_enum,
    'IN_REVIEW'::public.product_status_enum])) AND (status_before_account_hold IS NULL) AND ( SELECT public.fn_current_account_is_active() AS fn_current_account_is_active))));

CREATE POLICY "profiles_private_access" ON "public"."profiles_private"
  FOR SELECT
  TO "authenticated"
  USING (((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.is_admin() AS is_admin)));

CREATE POLICY "shipment tracking events are visible to participants and admins" ON "public"."shipment_tracking_events"
  FOR SELECT
  TO "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM (public.shipments s
     JOIN public.orders o ON ((o.id = s.order_id)))
  WHERE ((s.id = shipment_tracking_events.shipment_id) AND ((o.buyer_id = ( SELECT auth.uid() AS uid)) OR (s.seller_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
   FROM public.profiles_private pp
  WHERE ((pp.id = ( SELECT auth.uid() AS uid)) AND (pp.role = 'admin'::text))))));

CREATE POLICY "shipments_select_participant_or_admin" ON "public"."shipments"
  FOR SELECT
  TO "authenticated"
  USING (((seller_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = shipments.order_id) AND (o.buyer_id = ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() AS is_admin)));

CREATE POLICY "Admins can view all avatars" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING (((bucket_id = 'Avatars'::text) AND ( SELECT public.is_admin() AS is_admin)));

CREATE POLICY "Allow Select Own Files 1ahc6qj_0" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'verification'::text) AND (( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1
   FROM public.products p
  WHERE (((p.id)::text = (storage.foldername(objects.name))[1]) AND (p.seller_id = ( SELECT auth.uid() AS uid))))))));

CREATE POLICY "Users can upload their own avatar h0za56_0" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'Avatars'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

CREATE POLICY "Users can upload their own avatar h0za56_1" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'Avatars'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

CREATE POLICY "Users can upload their own avatar h0za56_2" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'Avatars'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

CREATE POLICY "evidence_select_uploader_or_admin" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'evidence'::text) AND (((storage.foldername(name))[3] = (( SELECT auth.uid() AS uid))::text) OR ( SELECT public.is_admin() AS is_admin))));
