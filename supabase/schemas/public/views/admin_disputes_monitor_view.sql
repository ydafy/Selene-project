CREATE VIEW "public"."admin_disputes_monitor_view" WITH (security_invoker=true) AS  SELECT d.id AS dispute_id,
    d.created_at AS dispute_date,
    d.updated_at AS resolved_at,
    d.status AS dispute_status,
    "left"(d.description, 100) AS dispute_description_preview,
    d.resolution_type,
    o.id AS order_id,
    o.total_amount,
    o.status AS order_status,
    b.id AS buyer_id,
    b.username AS buyer_username,
    s.id AS seller_id,
    s.username AS seller_username
   FROM (((public.disputes d
     LEFT JOIN public.orders o ON ((d.order_id = o.id)))
     LEFT JOIN public.profiles b ON ((d.buyer_id = b.id)))
     LEFT JOIN public.profiles s ON ((d.seller_id = s.id)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_disputes_monitor_view" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_disputes_monitor_view" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_disputes_monitor_view" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_disputes_monitor_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_disputes_monitor_view" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_disputes_monitor_view" FROM "anon";
