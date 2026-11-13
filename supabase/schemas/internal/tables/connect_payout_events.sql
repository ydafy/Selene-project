CREATE TABLE "internal"."connect_payout_events" (
  "id"                          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "stripe_event_id"             text                     NOT NULL,
  "event_type"                  text                     NOT NULL,
  "stripe_payout_id"            text                     NOT NULL,
  "connect_payout_run_id"       uuid,
  "stripe_created"              timestamp with time zone NOT NULL,
  "received_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "observed_payout_status"      text                     NOT NULL,
  "failure_code"                text,
  "failure_message"             text,
  "failure_balance_transaction" text,
  CONSTRAINT "connect_payout_events_event_type_check"
    CHECK ((event_type = ANY (ARRAY['payout.created'::text, 'payout.updated'::text, 'payout.paid'::text, 'payout.failed'::text, 'payout.canceled'::text]))),
  CONSTRAINT "connect_payout_events_observed_payout_status_check"
    CHECK ((observed_payout_status = ANY (ARRAY['pending'::text, 'in_transit'::text, 'paid'::text, 'failed'::text, 'canceled'::text]))),
  CONSTRAINT "connect_payout_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "connect_payout_events_stripe_event_id_key" UNIQUE (stripe_event_id),
  CONSTRAINT "connect_payout_events_connect_payout_run_id_fkey" FOREIGN KEY (connect_payout_run_id) REFERENCES public.connect_payout_runs(id) ON DELETE SET NULL
);

ALTER TABLE "internal"."connect_payout_events"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_connect_payout_events_event_type ON internal.connect_payout_events USING btree (event_type);

CREATE INDEX idx_connect_payout_events_run_id ON internal.connect_payout_events USING btree (connect_payout_run_id);

CREATE INDEX idx_connect_payout_events_stripe_payout_id ON internal.connect_payout_events USING btree (stripe_payout_id, stripe_created);

CREATE TRIGGER trg_connect_payout_events_append_only
  BEFORE DELETE OR UPDATE ON internal.connect_payout_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_connect_payout_event_mutation();

COMMENT ON COLUMN "internal"."connect_payout_events"."failure_balance_transaction" IS 'Stripe balance transaction returning payout funds to the Stripe balance after a payout failure; evidence for late paid→failed reversal.';

COMMENT ON COLUMN "internal"."connect_payout_events"."observed_payout_status" IS 'Observed Stripe payout state carried by the event (pending, in_transit, paid, failed, canceled).';

COMMENT ON COLUMN "internal"."connect_payout_events"."stripe_created" IS 'Stripe occurrence time (event.created); webhook arrival order is not occurrence order.';

COMMENT ON COLUMN "internal"."connect_payout_events"."stripe_event_id" IS 'Stripe event.id; duplicate webhook deliveries dedupe on this identity and must never create a second evidence row or a second projection.';

COMMENT ON TABLE "internal"."connect_payout_events" IS 'Append-only, immutable Stripe Connect payout event evidence keyed by Stripe event identity; the aggregate payout-run status is a projection rebuilt from this evidence plus authoritative Stripe state.';

-- Server-only machinery (odd/tasks/internal-schema.md S3): only SECURITY DEFINER
-- functions owned by postgres read or write it, so no client role and not
-- service_role hold a privilege on it.
REVOKE ALL ON TABLE "internal"."connect_payout_events" FROM PUBLIC, "anon", "authenticated", "service_role";
