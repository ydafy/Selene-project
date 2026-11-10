CREATE TABLE "public"."connect_account_events" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "stripe_event_id"         text                     NOT NULL,
  "stripe_account_id"       text                     NOT NULL,
  "event_type"              text                     NOT NULL,
  "stripe_created"          timestamp with time zone NOT NULL,
  "received_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "payouts_enabled"         boolean,
  "external_account_id"     text,
  "external_account_status" text,
  CONSTRAINT "connect_account_events_event_type_check"
    CHECK
    ((event_type = ANY (ARRAY['account.updated'::text, 'account.external_account.created'::text, 'account.external_account.updated'::text,
    'account.external_account.deleted'::text]))),
  CONSTRAINT "connect_account_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "connect_account_events_stripe_event_id_key" UNIQUE (stripe_event_id)
);

ALTER TABLE "public"."connect_account_events"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_connect_account_events_account_id ON public.connect_account_events USING btree (stripe_account_id, stripe_created);

CREATE TRIGGER trg_connect_account_events_append_only
  BEFORE DELETE OR UPDATE ON public.connect_account_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_connect_account_event_mutation();

COMMENT ON COLUMN "public"."connect_account_events"."external_account_id" IS 'External bank-account id carried by the signed event, when parseable; NULL when absent or not parseable. Evidence only: identity attribution, never an actionability input by itself.';

COMMENT ON COLUMN "public"."connect_account_events"."external_account_status" IS 'Historical bank status extracted from the signed event. An external-account event may concern an old or non-default bank; this field is never the current destination authority.';

COMMENT ON COLUMN "public"."connect_account_events"."payouts_enabled" IS 'Account-level payouts_enabled carried by the signed event; NULL when the field is absent or undocumented.';

COMMENT ON COLUMN "public"."connect_account_events"."stripe_event_id" IS 'Immutable signed event identity. Duplicate evidence stays unchanged, but webhook retry must re-read current state under a new refresh generation.';

COMMENT ON TABLE "public"."connect_account_events" IS 'Append-only, immutable Stripe account/external-account event evidence keyed by Stripe event identity; the derived per-account actionability is a projection rebuilt from this evidence, and it never mutates the Phase 2A payout event ledger.';

REVOKE ALL ON TABLE "public"."connect_account_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."connect_account_events" TO "postgres";

REVOKE ALL ON TABLE "public"."connect_account_events" FROM "anon", "authenticated", "service_role";
