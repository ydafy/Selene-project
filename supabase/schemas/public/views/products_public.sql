-- Runs with its owner's rights on purpose: security_invoker would need a row
-- policy on products that exposes the hidden columns of public listings to
-- every signed-in user (docs/decision-log.md, 2026-11-11).
CREATE VIEW "public"."products_public" WITH (security_barrier=true) AS  SELECT id,
    seller_id,
    name,
    description,
    price_cents,
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
  WHERE ((deleted_at IS NULL) AND (status = ANY (ARRAY['verified'::public.product_status, 'sold'::public.product_status, 'pending_verification'::public.product_status, 'in_review'::public.product_status])));

REVOKE ALL ON TABLE "public"."products_public" FROM "anon";

GRANT SELECT ON TABLE "public"."products_public" TO "anon";

REVOKE ALL ON TABLE "public"."products_public" FROM "authenticated";

GRANT SELECT ON TABLE "public"."products_public" TO "authenticated";

REVOKE ALL ON TABLE "public"."products_public" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."products_public" TO "postgres";

REVOKE ALL ON TABLE "public"."products_public" FROM "service_role";

GRANT SELECT ON TABLE "public"."products_public" TO "service_role";
