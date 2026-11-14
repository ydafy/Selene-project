ALTER POLICY "admin_audit_logs_read" ON "public"."admin_audit_logs" TO "authenticated";

ALTER POLICY "admin_user_notes_all" ON "public"."admin_user_notes" TO "authenticated";

ALTER POLICY "blocked_users_all" ON "public"."blocked_users" TO "authenticated";

ALTER POLICY "category_config_select" ON "public"."category_configurations" TO "anon", "authenticated";

ALTER POLICY "disputes_select" ON "public"."disputes" TO "authenticated";

ALTER POLICY "favorites_all" ON "public"."favorites" TO "authenticated";

ALTER POLICY "mexico_zips_read" ON "public"."mexico_zips" TO "anon", "authenticated";

ALTER POLICY "order_items_select_v4" ON "public"."order_items" TO "authenticated";

ALTER POLICY "orders_select_v4" ON "public"."orders" TO "authenticated";

ALTER POLICY "payment_methods_manage" ON "public"."payment_methods" TO "authenticated";

ALTER POLICY "products_delete_block" ON "public"."products" TO "anon", "authenticated";

ALTER POLICY "profiles_public_read" ON "public"."profiles" TO "anon", "authenticated";

ALTER POLICY "profiles_update" ON "public"."profiles" TO "authenticated";

ALTER POLICY "reports_insert" ON "public"."reports" TO "authenticated";

ALTER POLICY "reviews_select" ON "public"."reviews" TO "anon", "authenticated";

ALTER POLICY "shipment label events are append-only" ON "public"."shipment_label_events" TO "anon", "authenticated";

ALTER POLICY "shipments_delete_block" ON "public"."shipments" TO "anon", "authenticated";

ALTER POLICY "shipments_insert_block" ON "public"."shipments" TO "anon", "authenticated";

ALTER POLICY "system_logs_insert" ON "public"."system_logs" TO "authenticated";

ALTER POLICY "system_logs_read" ON "public"."system_logs" TO "authenticated";

ALTER POLICY "system_settings_read" ON "public"."system_settings" TO "anon", "authenticated";

ALTER POLICY "dlq_admin_select" ON "public"."webhook_dlq" TO "authenticated";

ALTER POLICY "Admins can view all avatars" ON "storage"."objects" TO "authenticated";

ALTER POLICY "Products Visual Access" ON "storage"."objects" TO "anon", "authenticated";
