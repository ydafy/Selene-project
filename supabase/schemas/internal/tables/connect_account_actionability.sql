CREATE TABLE "internal"."connect_account_actionability" (
  "stripe_account_id"            text                     NOT NULL,
  "is_actionable"                boolean                  NOT NULL,
  "blocked_reason"               text,
  "payouts_enabled"              boolean,
  "external_account_status"      text,
  "source_event_id"              text,
  "stripe_created"               timestamp with time zone NOT NULL,
  "updated_at"                   timestamp with time zone NOT NULL DEFAULT now(),
  "refresh_generation"           bigint                   NOT NULL DEFAULT 0,
  "refresh_pending"              boolean                  NOT NULL DEFAULT false,
  "current_external_account_id"  text,
  "current_observed_at"          timestamp with time zone,
  "current_currency"             text,
  "current_default_for_currency" boolean,
  "current_mxn_default_count"    integer,
  CONSTRAINT "connect_account_actionability_pkey" PRIMARY KEY (stripe_account_id),
  CONSTRAINT "connect_account_actionability_refresh_generation_check" CHECK ((refresh_generation >= 0))
);

ALTER TABLE "internal"."connect_account_actionability"
  ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN "internal"."connect_account_actionability"."blocked_reason" IS 'Documented non-actionable external-account status (errored, verification_failed, tokenized_account_number_deactivated) or payouts_disabled when the account-level payouts_enabled flag is false.';

COMMENT ON COLUMN "internal"."connect_account_actionability"."current_external_account_id" IS 'Current server-retrieved MXN default bank identity; distinct from the historical bank in connect_account_events. Usable only when refresh_pending is FALSE.';

COMMENT ON COLUMN "internal"."connect_account_actionability"."current_observed_at" IS 'Database receipt time of the last accepted server snapshot, not Stripe event creation or a claimed Stripe mutation time. Prior snapshot remains historical while pending.';

COMMENT ON COLUMN "internal"."connect_account_actionability"."refresh_generation" IS 'Monotonic per-account Selene refresh epoch, not Stripe mutation ordering. Zero means legacy projection; only acquire increments it.';

COMMENT ON COLUMN "internal"."connect_account_actionability"."refresh_pending" IS 'Acquire sets TRUE and is_actionable FALSE before network reads. Failed retrieval remains pending; only a current-generation commit clears it.';

COMMENT ON COLUMN "internal"."connect_account_actionability"."source_event_id" IS 'Signed Stripe trigger event identity bound to this account and refresh generation, NOT current destination identity. A duplicate trigger may acquire another generation.';

COMMENT ON COLUMN "internal"."connect_account_actionability"."stripe_created" IS 'Occurrence timestamp of the signed trigger event, copied from immutable evidence. Provenance only after generation adoption; never current-state ordering or observation time.';

COMMENT ON TABLE "internal"."connect_account_actionability" IS 'Payout gate: legacy compatibility until refreshed, then generation-fenced current Stripe MXN destination snapshots with fail-closed pending refreshes. Signed evidence stays separate and immutable.';

-- Server-only machinery (odd/tasks/internal-schema.md S3): only SECURITY DEFINER
-- functions owned by postgres read or write it, so no client role and not
-- service_role hold a privilege on it.
REVOKE ALL ON TABLE "internal"."connect_account_actionability" FROM PUBLIC, "anon", "authenticated", "service_role";
