CREATE TABLE "public"."connect_payout_runs" (
  "id"                         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "idempotency_key"            text                     NOT NULL,
  "seller_id"                  uuid                     NOT NULL,
  "amount"                     integer                  NOT NULL,
  "status"                     text                     NOT NULL DEFAULT 'pending_reconciliation'::text,
  "actor_id"                   uuid                     NOT NULL,
  "stripe_payout_id"           text,
  "created_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "paid_at"                    timestamp with time zone,
  "failed_at"                  timestamp with time zone,
  "failure_reason"             text,
  "retry_of_run_id"            uuid,
  "release_stage"              text,
  "release_stage_version"      integer                  NOT NULL DEFAULT 1,
  "payout_claim_token"         text,
  "payout_claim_expires_at"    timestamp with time zone,
  "payout_create_attempted_at" timestamp with time zone,
  "next_attempt_at"            timestamp with time zone,
  "attempt_count"              integer                  NOT NULL DEFAULT 0,
  "last_error"                 text,
  "action_required_reason"     text,
  CONSTRAINT "connect_payout_runs_amount_check" CHECK ((amount >= 0)),
  CONSTRAINT "connect_payout_runs_idempotency_key_key" UNIQUE (idempotency_key),
  CONSTRAINT "connect_payout_runs_pkey" PRIMARY KEY (id),
  CONSTRAINT "connect_payout_runs_release_stage_check"
    CHECK
    ((release_stage = ANY (ARRAY['ready'::text, 'release_accepted'::text, 'transfer_created'::text, 'awaiting_connected_balance'::text, 'payout_create_in_progress'::text,
    'payout_pending'::text, 'payout_in_transit'::text, 'paid_observed'::text, 'payout_failed'::text, 'payout_canceled'::text, 'action_required'::text]))),
  CONSTRAINT "connect_payout_runs_retry_of_run_id_fkey" FOREIGN KEY (retry_of_run_id) REFERENCES public.connect_payout_runs(id) ON DELETE RESTRICT,
  CONSTRAINT "connect_payout_runs_status_check"
    CHECK ((status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'failed'::text, 'canceled'::text, 'reconciliation_needed'::text]))),
  CONSTRAINT "connect_payout_runs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT "connect_payout_runs_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE RESTRICT
);

ALTER TABLE "public"."connect_payout_runs"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_connect_payout_runs_actor_id ON public.connect_payout_runs USING btree (actor_id);

CREATE UNIQUE INDEX idx_connect_payout_runs_one_retry_per_parent ON public.connect_payout_runs USING btree (retry_of_run_id)
  WHERE (retry_of_run_id IS NOT NULL);

CREATE INDEX idx_connect_payout_runs_release_stage_next_attempt ON public.connect_payout_runs USING btree (release_stage, next_attempt_at)
  WHERE ((status = 'pending_reconciliation'::text) AND (stripe_payout_id IS NULL));

CREATE INDEX idx_connect_payout_runs_seller_id ON public.connect_payout_runs USING btree (seller_id);

CREATE INDEX idx_connect_payout_runs_stripe_payout_id ON public.connect_payout_runs USING btree (stripe_payout_id)
  WHERE (stripe_payout_id IS NOT NULL);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."connect_payout_runs" TO "service_role";

COMMENT ON COLUMN "public"."connect_payout_runs"."action_required_reason" IS 'Why a run sits in the action_required stage. Only the account_not_actionable reason may be auto-resumed by a later actionable account update; every other action_required state requires an admin decision.';

COMMENT ON COLUMN "public"."connect_payout_runs"."amount" IS 'Total payout amount in cents. Single-modal orders use the checkout-fixed sum of order_items.net_payout; legacy orders retain the shipment shipping_cost deduction.';

COMMENT ON COLUMN "public"."connect_payout_runs"."attempt_count" IS 'Number of executor attempts recorded for this run (deferrals increment it).';

COMMENT ON COLUMN "public"."connect_payout_runs"."idempotency_key" IS 'Client-provided idempotency key used to reuse an existing payout run on retry.';

COMMENT ON COLUMN "public"."connect_payout_runs"."last_error" IS 'Last non-fatal executor error or deferral reason recorded for this run; diagnostic only, never a retry authority.';

COMMENT ON COLUMN "public"."connect_payout_runs"."next_attempt_at" IS 'Earliest time the awaiting-balance executor may claim this run again after an insufficient-balance deferral; NULL = immediately eligible.';

COMMENT ON COLUMN "public"."connect_payout_runs"."payout_claim_expires_at" IS 'Expiry of the executor lease. The lease guards worker concurrency and crash recovery only; Stripe idempotency on the persisted idempotency_key remains the duplicate-payout guarantee.';

COMMENT ON COLUMN "public"."connect_payout_runs"."payout_claim_token" IS 'Opaque claim token held by the current executor worker; every worker write is token-conditional. NULL = unclaimed.';

COMMENT ON COLUMN "public"."connect_payout_runs"."payout_create_attempted_at" IS 'Write-ahead timestamp recorded when the payout_create_in_progress fence is opened, before the Stripe payout create call; it bounds the reconciliation listing window.';

COMMENT ON COLUMN "public"."connect_payout_runs"."release_stage" IS 'Selene aggregate release stage (payout operating model). Distinct from Stripe payout state: no Stripe payout exists before payout_pending. payout_create_in_progress is the durable write-ahead fence held while a Stripe payout create is in flight; it is only exited by completing the payout identity, reconciling the Stripe outcome, or an action_required abort — never by a second create.';

COMMENT ON COLUMN "public"."connect_payout_runs"."release_stage_version" IS 'Monotonic stage version; every conditional stage write must carry the version it observed so stale workers conflict instead of overwriting.';

COMMENT ON COLUMN "public"."connect_payout_runs"."retry_of_run_id" IS 'Failed payout run retried by this child run. The parent remains immutable audit history.';

COMMENT ON TABLE "public"."connect_payout_runs" IS 'Auditable manual Stripe Connect payout run created by an admin for a seller shipment batch.';

REVOKE ALL ON TABLE "public"."connect_payout_runs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."connect_payout_runs" TO "postgres";

REVOKE ALL ON TABLE "public"."connect_payout_runs" FROM "anon", "authenticated";
