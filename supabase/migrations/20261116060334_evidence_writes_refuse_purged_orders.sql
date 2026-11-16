DROP POLICY "evidence_insert_order_participant" ON "storage"."objects";

DROP POLICY "evidence_update_order_participant" ON "storage"."objects";

CREATE POLICY "evidence_insert_order_participant" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((bucket_id = 'evidence'::text) AND ((storage.foldername(name))[3] = (( SELECT auth.uid() AS uid))::text) AND ((((storage.foldername(name))[1] = ANY (ARRAY['disputes'::text,
    'returns'::text])) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id =
        CASE
            WHEN ((storage.foldername(objects.name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN ((storage.foldername(objects.name))[2])::uuid
            ELSE NULL::uuid
        END) AND (o.buyer_id = ( SELECT auth.uid() AS uid)) AND (o.evidence_purged_at IS NULL))))) OR
          (((storage.foldername(name))[1] = ANY (ARRAY['disputes'::text, 'shipments'::text])) AND (EXISTS ( SELECT 1
   FROM (public.shipments s
     JOIN public.orders o ON ((o.id = s.order_id)))
  WHERE ((s.order_id =
        CASE
            WHEN ((storage.foldername(objects.name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN ((storage.foldername(objects.name))[2])::uuid
            ELSE NULL::uuid
        END) AND (s.seller_id = ( SELECT auth.uid() AS uid)) AND (o.evidence_purged_at IS NULL))))))));

CREATE POLICY "evidence_update_order_participant" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'evidence'::text) AND ((storage.foldername(name))[3] = (( SELECT auth.uid() AS uid))::text)))
  WITH
    CHECK
    (((bucket_id = 'evidence'::text) AND ((storage.foldername(name))[3] = (( SELECT auth.uid() AS uid))::text) AND ((((storage.foldername(name))[1] = ANY (ARRAY['disputes'::text,
    'returns'::text])) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id =
        CASE
            WHEN ((storage.foldername(objects.name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN ((storage.foldername(objects.name))[2])::uuid
            ELSE NULL::uuid
        END) AND (o.buyer_id = ( SELECT auth.uid() AS uid)) AND (o.evidence_purged_at IS NULL))))) OR
          (((storage.foldername(name))[1] = ANY (ARRAY['disputes'::text, 'shipments'::text])) AND (EXISTS ( SELECT 1
   FROM (public.shipments s
     JOIN public.orders o ON ((o.id = s.order_id)))
  WHERE ((s.order_id =
        CASE
            WHEN ((storage.foldername(objects.name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN ((storage.foldername(objects.name))[2])::uuid
            ELSE NULL::uuid
        END) AND (s.seller_id = ( SELECT auth.uid() AS uid)) AND (o.evidence_purged_at IS NULL))))))));
