DROP INDEX "public"."idx_disputes_shipment_id";

DROP INDEX "public"."idx_orders_stripe_transfer_group";

DROP INDEX "public"."ix_notifications_user_id";

CREATE INDEX idx_reviews_order_id ON public.reviews USING btree (order_id);

CREATE INDEX idx_shipments_origin_address_id ON public.shipments USING btree (origin_address_id);

CREATE INDEX ix_notifications_user_id_created_at ON public.notifications USING btree (user_id, created_at DESC, id DESC);

CREATE INDEX push_deliveries_user_id_idx ON public.push_deliveries USING btree (user_id);

CREATE INDEX push_tokens_user_id_idx ON public.push_tokens USING btree (user_id);

CREATE INDEX shipment_cancellation_operations_order_id_idx ON public.shipment_cancellation_operations USING btree (order_id);

CREATE INDEX shipment_completion_events_actor_id_idx ON public.shipment_completion_events USING btree (actor_id);

CREATE INDEX shipment_completion_events_order_id_idx ON public.shipment_completion_events USING btree (order_id);

CREATE INDEX shipment_label_events_shipment_id_idx ON public.shipment_label_events USING btree (shipment_id);

CREATE INDEX shipment_tracking_events_webhook_delivery_id_idx ON public.shipment_tracking_events USING btree (webhook_delivery_id);
