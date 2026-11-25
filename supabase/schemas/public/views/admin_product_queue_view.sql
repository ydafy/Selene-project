CREATE VIEW "public"."admin_product_queue_view" WITH (security_invoker=true) AS  SELECT p.id,
    p.created_at,
    p.name,
    p.description,
    p.price_cents,
    p.category,
    p.condition,
    p.usage,
    p.images,
    p.status,
    p.specifications,
    p.seller_id,
    p.views,
    p.aspect_ratio,
    p.shipping_cost_cents,
    p.shipping_payer,
    p.origin_zip,
    p.package_preset,
    p.updated_at,
    v.id AS verification_id,
    v.submitted_at,
    v.benchmark_score,
    v.locked_by,
    v.locked_at,
    ( SELECT r.public_note
           FROM public.product_verifications r
          WHERE ((r.product_id = p.id) AND (r.decision = 'rejected'::public.product_verification_decision))
          ORDER BY r.submitted_at DESC
         LIMIT 1) AS last_rejection_note,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'storage_path', e.storage_path) ORDER BY e.kind, e.storage_path) AS jsonb_agg
           FROM public.product_verification_evidence e
          WHERE (e.verification_id = v.id)), '[]'::jsonb) AS evidence
   FROM (public.product_verifications v
     JOIN public.products p ON ((p.id = v.product_id)))
  WHERE ((v.decision IS NULL) AND (p.status = 'in_review'::public.product_status) AND (p.deleted_at IS NULL) AND public.is_admin())
  ORDER BY v.submitted_at;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_product_queue_view" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_product_queue_view" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_product_queue_view" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "anon";
