CREATE TABLE "internal"."checkout_recovery_shells" (
  "stripe_payment_intent_id"      text                     NOT NULL,
  "reason"                        text                     NOT NULL,
  "source_metadata"               jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "charged_amount_cents"          bigint,
  "compensation_state"            text                     NOT NULL DEFAULT 'refund_pending'::text,
  "compensation_attempt_count"    integer                  NOT NULL DEFAULT 0,
  "next_compensation_retry_at"    timestamp with time zone,
  "compensation_lease_expires_at" timestamp with time zone,
  "stripe_refund_id"              text,
  "compensation_last_error"       text,
  "created_at"                    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                    timestamp with time zone NOT NULL DEFAULT now(),
  "stripe_charge_id"              text,
  CONSTRAINT "checkout_recovery_shells_compensation_state_check"
    CHECK ((compensation_state = ANY (ARRAY['refund_pending'::text, 'refunding'::text, 'refund_failed_retry_queued'::text, 'refunded'::text, 'reconciliation_needed'::text]))),
  CONSTRAINT "checkout_recovery_shells_pkey" PRIMARY KEY (stripe_payment_intent_id)
);

ALTER TABLE "internal"."checkout_recovery_shells"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX checkout_recovery_shells_claim_idx ON internal.checkout_recovery_shells USING btree (next_compensation_retry_at, created_at)
  WHERE (compensation_state = ANY (ARRAY['refund_pending'::text, 'refund_failed_retry_queued'::text, 'refunding'::text]));

COMMENT ON TABLE "internal"."checkout_recovery_shells" IS 'Refund queue for checkout payments that have no order to settle against, one row per payment intent. Only fn_upsert_checkout_recovery_shell, fn_set_checkout_recovery_charge_evidence, fn_claim_checkout_recovery_shells, fn_mark_checkout_recovery_retry, fn_mark_checkout_recovery_reconciliation_needed and fn_finalize_checkout_recovery (SECURITY DEFINER) reach it.';

-- Server-only machinery (odd/tasks/internal-schema.md S3): only SECURITY DEFINER
-- functions owned by postgres read or write it, so no client role and not
-- service_role hold a privilege on it.
REVOKE ALL ON TABLE "internal"."checkout_recovery_shells" FROM PUBLIC, "anon", "authenticated", "service_role";
