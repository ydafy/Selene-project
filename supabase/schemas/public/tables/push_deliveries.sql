CREATE TABLE "public"."push_deliveries" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "notification_id"    uuid                     NOT NULL,
  "push_token_id"      uuid                     NOT NULL,
  "user_id"            uuid                     NOT NULL,
  "channel"            text                     NOT NULL,
  "status"             text                     NOT NULL DEFAULT 'pending'::text,
  "attempts"           integer                  NOT NULL DEFAULT 0,
  "next_attempt_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "claim_token"        uuid,
  "claimed_at"         timestamp with time zone,
  "expo_ticket_id"     text,
  "last_error"         text,
  "sent_at"            timestamp with time zone,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "receipt_status"     text,
  "receipt_error"      text,
  "receipt_checked_at" timestamp with time zone,
  CONSTRAINT "push_deliveries_channel_check" CHECK ((channel = ANY (ARRAY['orders'::text, 'activity'::text]))),
  CONSTRAINT "push_deliveries_notification_id_fkey" FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE,
  CONSTRAINT "push_deliveries_notification_id_push_token_id_key" UNIQUE (notification_id, push_token_id),
  CONSTRAINT "push_deliveries_pkey" PRIMARY KEY (id),
  CONSTRAINT "push_deliveries_receipt_status_check" CHECK ((receipt_status = ANY (ARRAY['ok'::text, 'error'::text, 'missing'::text]))),
  CONSTRAINT "push_deliveries_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))),
  CONSTRAINT "push_deliveries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "push_deliveries_push_token_id_fkey" FOREIGN KEY (push_token_id) REFERENCES public.push_tokens(id) ON DELETE CASCADE
);

ALTER TABLE "public"."push_deliveries"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX push_deliveries_claim_idx ON public.push_deliveries USING btree (next_attempt_at)
  WHERE (status = ANY (ARRAY['pending'::text, 'sending'::text]));

CREATE INDEX push_deliveries_purge_idx ON public.push_deliveries USING btree (updated_at)
  WHERE (status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped'::text]));

CREATE INDEX push_deliveries_push_token_idx ON public.push_deliveries USING btree (push_token_id);

CREATE INDEX push_deliveries_receipt_due_idx ON public.push_deliveries USING btree (sent_at)
  WHERE ((status = 'sent'::text) AND (receipt_status IS NULL));

CREATE INDEX push_deliveries_user_id_idx ON public.push_deliveries USING btree (user_id);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_deliveries" TO "service_role";

COMMENT ON COLUMN "public"."push_deliveries"."receipt_status" IS 'Expo push receipt of a sent delivery: ok, error (receipt_error holds the code) or missing (no receipt one hour after sending). NULL while the check is due.';

COMMENT ON TABLE "public"."push_deliveries" IS 'Push outbox: one row per (notification, push token). Written by fn_enqueue_push_deliveries; claimed and completed by the dispatcher through fn_claim_push_deliveries and fn_record_push_results. expo_ticket_id and sent_at let the dispatcher check receipts later.';

REVOKE ALL ON TABLE "public"."push_deliveries" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_deliveries" TO "postgres";

REVOKE ALL ON TABLE "public"."push_deliveries" FROM "anon", "authenticated";
