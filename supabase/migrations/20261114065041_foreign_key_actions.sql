ALTER TABLE "internal"."account_closures"
  DROP CONSTRAINT "account_closures_user_id_fkey";

ALTER TABLE "internal"."connect_payout_events"
  DROP CONSTRAINT "connect_payout_events_connect_payout_run_id_fkey";

ALTER TABLE "public"."addresses"
  DROP CONSTRAINT "addresses_user_id_fkey";

ALTER TABLE "public"."admin_audit_logs"
  DROP CONSTRAINT "admin_audit_logs_admin_id_fkey";

ALTER TABLE "public"."admin_user_notes"
  DROP CONSTRAINT "admin_user_notes_admin_id_fkey";

ALTER TABLE "public"."connect_payout_run_shipments"
  DROP CONSTRAINT "connect_payout_run_shipments_run_id_fkey";

ALTER TABLE "public"."notifications"
  DROP CONSTRAINT "notifications_user_id_fkey";

ALTER TABLE "public"."order_items"
  DROP CONSTRAINT "order_items_order_id_fkey";

ALTER TABLE "public"."order_items"
  DROP CONSTRAINT "order_items_product_id_fkey";

ALTER TABLE "public"."order_items"
  DROP CONSTRAINT "order_items_seller_id_fkey";

ALTER TABLE "public"."orders"
  DROP CONSTRAINT "orders_buyer_id_fkey";

ALTER TABLE "public"."products"
  DROP CONSTRAINT "products_locked_by_fkey";

ALTER TABLE "public"."push_deliveries"
  DROP CONSTRAINT "push_deliveries_user_id_fkey";

ALTER TABLE "public"."push_tokens"
  DROP CONSTRAINT "push_tokens_user_id_fkey";

ALTER TABLE "public"."reviews"
  DROP CONSTRAINT "reviews_order_id_fkey";

ALTER TABLE "public"."shipments"
  DROP CONSTRAINT "shipments_origin_address_id_fkey";

ALTER TABLE "internal"."account_closures"
  ADD CONSTRAINT "account_closures_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "internal"."connect_payout_events"
  ADD CONSTRAINT "connect_payout_events_connect_payout_run_id_fkey" FOREIGN KEY (connect_payout_run_id) REFERENCES public.connect_payout_runs(id) ON DELETE RESTRICT;

ALTER TABLE "public"."addresses"
  ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."admin_audit_logs"
  ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY (admin_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."admin_user_notes"
  ADD CONSTRAINT "admin_user_notes_admin_id_fkey" FOREIGN KEY (admin_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."connect_payout_run_shipments"
  ADD CONSTRAINT "connect_payout_run_shipments_run_id_fkey" FOREIGN KEY (run_id) REFERENCES public.connect_payout_runs(id) ON DELETE RESTRICT;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."order_items"
  ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;

ALTER TABLE "public"."order_items"
  ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE "public"."order_items"
  ADD CONSTRAINT "order_items_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."push_deliveries"
  ADD CONSTRAINT "push_deliveries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."push_tokens"
  ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."reviews"
  ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;

ALTER TABLE "public"."shipments"
  ADD CONSTRAINT "shipments_origin_address_id_fkey" FOREIGN KEY (origin_address_id) REFERENCES public.addresses(id) ON DELETE RESTRICT;
