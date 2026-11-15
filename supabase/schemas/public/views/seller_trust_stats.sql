CREATE VIEW "public"."seller_trust_stats" WITH (security_invoker=true) AS  SELECT seller_id,
    count(*) AS total_listings,
    count(*) FILTER (WHERE (status = 'verified'::public.product_status)) AS verified_count,
    count(*) FILTER (WHERE (status = 'in_review'::public.product_status)) AS in_review_count,
    count(*) FILTER (WHERE (status = 'rejected'::public.product_status)) AS rejected_count,
    count(*) FILTER (WHERE (status = 'sold'::public.product_status)) AS sold_count,
    count(*) FILTER (WHERE (status = ANY (ARRAY['verified'::public.product_status, 'sold'::public.product_status, 'rejected'::public.product_status]))) AS processed_count
   FROM public.products
  WHERE ((deleted_at IS NULL) AND public.is_admin())
  GROUP BY seller_id;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."seller_trust_stats" TO "service_role";

REVOKE ALL ON TABLE "public"."seller_trust_stats" FROM "authenticated";

GRANT SELECT ON TABLE "public"."seller_trust_stats" TO "authenticated";

REVOKE ALL ON TABLE "public"."seller_trust_stats" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."seller_trust_stats" TO "postgres";

REVOKE ALL ON TABLE "public"."seller_trust_stats" FROM "anon";
