CREATE VIEW "public"."admin_product_queue_view" WITH (security_invoker=true) AS  SELECT id,
    created_at,
    name,
    description,
    price_cents,
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
    shipping_cost_cents,
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
  WHERE ((status = 'PENDING_VERIFICATION'::public.product_status_enum) AND (deleted_at IS NULL) AND public.is_admin())
  ORDER BY created_at;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_product_queue_view" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_product_queue_view" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_product_queue_view" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "anon";
