CREATE TABLE "internal"."stripe_fee_reconciliation_jobs" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "order_id"                 uuid                     NOT NULL,
  "stripe_payment_intent_id" text                     NOT NULL,
  "status"                   text                     NOT NULL DEFAULT 'pending'::text,
  "attempt_count"            integer                  NOT NULL DEFAULT 0,
  "next_retry_at"            timestamp with time zone,
  "last_error"               text,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "claim_token"              uuid,
  "claim_expires_at"         timestamp with time zone,
  CONSTRAINT "stripe_fee_reconciliation_job_order_id_stripe_payment_inten_key" UNIQUE (order_id, stripe_payment_intent_id),
  CONSTRAINT "stripe_fee_reconciliation_jobs_attempt_count_check" CHECK (((attempt_count >= 0) AND (attempt_count <= 100))),
  CONSTRAINT "stripe_fee_reconciliation_jobs_last_error_check" CHECK (((last_error IS NULL) OR (char_length(last_error) <= 4000))),
  CONSTRAINT "stripe_fee_reconciliation_jobs_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT,
  CONSTRAINT "stripe_fee_reconciliation_jobs_pkey" PRIMARY KEY (id),
  CONSTRAINT "stripe_fee_reconciliation_jobs_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'succeeded'::text, 'failed'::text]))),
  CONSTRAINT "stripe_fee_reconciliation_jobs_stripe_payment_intent_id_check"
    CHECK (((char_length(stripe_payment_intent_id) >= 1) AND (char_length(stripe_payment_intent_id) <= 255)))
);

ALTER TABLE "internal"."stripe_fee_reconciliation_jobs"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX stripe_fee_reconciliation_jobs_processing_lease_idx ON internal.stripe_fee_reconciliation_jobs USING btree (claim_expires_at, updated_at, id)
  WHERE (status = 'processing'::text);

CREATE INDEX stripe_fee_reconciliation_jobs_retry_idx ON internal.stripe_fee_reconciliation_jobs USING btree (next_retry_at, created_at)
  WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

COMMENT ON COLUMN "internal"."stripe_fee_reconciliation_jobs"."attempt_count" IS 'Bounded count of reconciliation attempts, including the active processing attempt.';

COMMENT ON COLUMN "internal"."stripe_fee_reconciliation_jobs"."claim_expires_at" IS 'Database-clock active lease expiry; NULL after success, retry, or failure.';

COMMENT ON COLUMN "internal"."stripe_fee_reconciliation_jobs"."claim_token" IS 'Opaque active ownership; retained on success solely for same-token completion replay.';

COMMENT ON COLUMN "internal"."stripe_fee_reconciliation_jobs"."next_retry_at" IS 'Earliest time a pending or failed reconciliation job is eligible for its next attempt.';

COMMENT ON TABLE "internal"."stripe_fee_reconciliation_jobs" IS 'Server-only recovery ledger for reconciling actual Stripe processing fees against paid orders. Only fn_enqueue_stripe_fee_reconciliation_job, fn_claim_stripe_fee_reconciliation_jobs_leased, fn_transition_stripe_fee_reconciliation_job_leased and fn_complete_stripe_fee_reconciliation_job_leased (SECURITY DEFINER) reach it.';

-- Server-only machinery (odd/tasks/internal-schema.md S3): only SECURITY DEFINER
-- functions owned by postgres read or write it, so no client role and not
-- service_role hold a privilege on it.
REVOKE ALL ON TABLE "internal"."stripe_fee_reconciliation_jobs" FROM PUBLIC, "anon", "authenticated", "service_role";
