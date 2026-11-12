-- Runs with its owner's rights on purpose: security_invoker would need a row
-- policy on products that exposes the hidden columns of public listings to
-- every signed-in user (docs/decision-log.md, 2026-11-11).
CREATE VIEW "public"."products_public" WITH (security_barrier=true) AS  SELECT id,
    seller_id,
    name,
    description,
    price,
    category,
    condition,
    usage,
    images,
    specifications,
    aspect_ratio,
    status,
    views,
    created_at,
    fts
   FROM public.products p
  WHERE ((deleted_at IS NULL) AND (status = ANY (ARRAY['VERIFIED'::public.product_status_enum, 'SOLD'::public.product_status_enum, 'PENDING_VERIFICATION'::public.product_status_enum, 'IN_REVIEW'::public.product_status_enum])));

REVOKE ALL ON TABLE "public"."products_public" FROM "anon";

GRANT SELECT ON TABLE "public"."products_public" TO "anon";

REVOKE ALL ON TABLE "public"."products_public" FROM "authenticated";

GRANT SELECT ON TABLE "public"."products_public" TO "authenticated";

REVOKE ALL ON TABLE "public"."products_public" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."products_public" TO "postgres";

REVOKE ALL ON TABLE "public"."products_public" FROM "service_role";

GRANT SELECT ON TABLE "public"."products_public" TO "service_role";
