CREATE VIEW "public"."admin_user_directory_view" WITH (security_invoker=true) AS  SELECT p.id,
    p.username,
    pp.email,
    p.avatar_url,
    pp.role,
    pp.status,
    p.is_verified_seller,
    p.created_at
   FROM (public.profiles p
     LEFT JOIN public.profiles_private pp ON ((p.id = pp.id)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_user_directory_view" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_user_directory_view" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_user_directory_view" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_user_directory_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_user_directory_view" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_user_directory_view" FROM "anon";
