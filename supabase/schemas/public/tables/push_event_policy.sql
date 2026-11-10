CREATE TABLE "public"."push_event_policy" (
  "event_kind"     text NOT NULL,
  "recipient_role" text NOT NULL,
  "channel"        text NOT NULL,
  CONSTRAINT "push_event_policy_channel_check" CHECK ((channel = ANY (ARRAY['orders'::text, 'activity'::text]))),
  CONSTRAINT "push_event_policy_pkey" PRIMARY KEY (event_kind, recipient_role),
  CONSTRAINT "push_event_policy_recipient_role_check" CHECK ((recipient_role = ANY (ARRAY['buyer'::text, 'seller'::text])))
);

ALTER TABLE "public"."push_event_policy"
  ENABLE ROW LEVEL SECURITY;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_event_policy" TO "service_role";

COMMENT ON TABLE "public"."push_event_policy" IS 'Allowlist of notification (event_kind, recipient_role) pairs that are also delivered by push, with the Android channel. Read by fn_enqueue_push_deliveries. To push a new kind, insert one row.';

REVOKE ALL ON TABLE "public"."push_event_policy" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_event_policy" TO "postgres";

REVOKE ALL ON TABLE "public"."push_event_policy" FROM "anon", "authenticated";
