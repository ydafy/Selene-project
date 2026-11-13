CREATE TABLE "internal"."account_closures" (
  "user_id"                 uuid                     NOT NULL,
  "closed_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "stripe_customer_id"      text,
  "stripe_account_id"       text,
  "stripe_customer_cleanup" text                     NOT NULL DEFAULT 'pending'::text,
  "stripe_account_cleanup"  text                     NOT NULL DEFAULT 'pending'::text,
  "storage_cleanup"         text                     NOT NULL DEFAULT 'pending'::text,
  "attempts"                integer                  NOT NULL DEFAULT 0,
  "last_error"              text,
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "account_closures_attempts_check" CHECK ((attempts >= 0)),
  CONSTRAINT "account_closures_pkey" PRIMARY KEY (user_id),
  CONSTRAINT "account_closures_storage_cleanup_check" CHECK ((storage_cleanup = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text, 'not_needed'::text]))),
  CONSTRAINT "account_closures_stripe_account_cleanup_check" CHECK ((stripe_account_cleanup = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text, 'not_needed'::text]))),
  CONSTRAINT "account_closures_stripe_customer_cleanup_check" CHECK ((stripe_customer_cleanup = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text, 'not_needed'::text]))),
  CONSTRAINT "account_closures_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

ALTER TABLE "internal"."account_closures"
  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "internal"."account_closures" IS 'One row per closed account. Written by fn_close_account; the delete-account Edge Function and its retry worker update the cleanup columns through fn_claim_account_closures, fn_record_closure_attempt and fn_record_closure_cleanup_step. Only those SECURITY DEFINER functions reach it.';

-- Server-only machinery (odd/tasks/internal-schema.md S3): only SECURITY DEFINER
-- functions owned by postgres read or write it, so no client role and not
-- service_role hold a privilege on it.
REVOKE ALL ON TABLE "internal"."account_closures" FROM PUBLIC, "anon", "authenticated", "service_role";
