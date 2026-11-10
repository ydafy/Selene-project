CREATE TABLE "public"."notifications" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "user_id"          uuid                     NOT NULL,
  "type"             text,
  "title"            text                     NOT NULL,
  "message"          text,
  "read"             boolean                  DEFAULT false,
  "action_path"      text,
  "deleted_at"       timestamp with time zone,
  "event_kind"       text,
  "source_event_key" text,
  "event_payload"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "notifications_event_identity_pair_chk" CHECK ((((event_kind IS NULL) AND (source_event_key IS NULL)) OR ((event_kind IS NOT NULL) AND (source_event_key IS
    NOT NULL)))),
  CONSTRAINT "notifications_event_kind_catalogue_chk"
    CHECK
    (((event_kind IS NULL) OR (event_kind = ANY (ARRAY['order.payment_confirmed'::text, 'shipment.cancelled'::text, 'shipment.refund_failed'::text, 'dispute.opened'::text,
    'dispute.verdict'::text,
    'product.approved'::text,
    'product.approved_with_note'::text,
    'product.rejected'::text,
    'return.seller_evidence_submitted'::text,
    'return.delivered'::text,
    'product.available'::text,
    'product.interest'::text,
    'shipment.in_transit'::text, 'shipment.delivered'::text, 'shipment.funds_released'::text, 'shipment.refunded'::text, 'shipment.label_deadline'::text])))),
  CONSTRAINT "notifications_event_payload_object_chk" CHECK ((jsonb_typeof(event_payload) = 'object'::text)),
  CONSTRAINT "notifications_pkey" PRIMARY KEY (id),
  CONSTRAINT "notifications_source_event_key_nonempty_chk" CHECK (((source_event_key IS NULL) OR (length(btrim(source_event_key)) > 0))),
  CONSTRAINT "notifications_type_check" CHECK ((type = ANY (ARRAY['info'::text, 'success'::text, 'error'::text, 'warning'::text]))),
  CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE "public"."notifications"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_notifications_user_id ON public.notifications USING btree (user_id);

CREATE UNIQUE INDEX notifications_source_event_key_user_id_uidx ON public.notifications USING btree (source_event_key, user_id)
  WHERE (source_event_key IS NOT NULL);

CREATE TRIGGER trg_notifications_enqueue_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN ((new.event_kind IS NOT NULL))
  EXECUTE FUNCTION public.fn_enqueue_push_deliveries();

CREATE POLICY "notifications_owner_select" ON "public"."notifications"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "notifications_owner_update" ON "public"."notifications"
  FOR UPDATE
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

REVOKE ALL ON TABLE "public"."notifications" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "service_role";

REVOKE ALL ("deleted_at") ON TABLE "public"."notifications" FROM "authenticated";

GRANT UPDATE ("deleted_at") ON TABLE "public"."notifications" TO "authenticated";

REVOKE ALL ("read") ON TABLE "public"."notifications" FROM "authenticated";

GRANT UPDATE ("read") ON TABLE "public"."notifications" TO "authenticated";

GRANT SELECT ON TABLE "public"."notifications" TO "authenticated";

REVOKE ALL ON TABLE "public"."notifications" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "postgres";

REVOKE ALL ON TABLE "public"."notifications" FROM "anon";
