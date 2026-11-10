CREATE VIEW "public"."admin_seller_onboarding_view" WITH (security_invoker=true) AS  SELECT p.id,
    p.username,
    pp.email,
    pp.stripe_account_id,
    pp.stripe_onboarding_status,
    ((pp.stripe_onboarding_status = 'complete'::public.stripe_onboarding_status) AND (pp.stripe_account_id IS NOT NULL)) AS charges_enabled,
    p.created_at
   FROM (public.profiles p
     JOIN public.profiles_private pp ON ((pp.id = p.id)))
  WHERE ((p.is_verified_seller = true) OR (pp.stripe_account_id IS NOT NULL));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_seller_onboarding_view" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_seller_onboarding_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_seller_onboarding_view" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_seller_onboarding_view" FROM "anon", "authenticated";
