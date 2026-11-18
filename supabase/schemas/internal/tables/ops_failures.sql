CREATE TABLE "internal"."ops_failures" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source"      text                     NOT NULL,
  "code"        text                     NOT NULL,
  "context"     jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_failures_pkey" PRIMARY KEY (id),
  CONSTRAINT "ops_failures_source_check" CHECK ((btrim(source) <> ''::text)),
  CONSTRAINT "ops_failures_code_check" CHECK ((btrim(code) <> ''::text)),
  CONSTRAINT "ops_failures_context_check" CHECK ((jsonb_typeof(context) = 'object'::text))
);

ALTER TABLE "internal"."ops_failures"
  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "internal"."ops_failures" IS 'Failures that a cron or trigger catches and continues past, or that an RPC catches and answers with a generic code, with no other record: source is the function, code a SQLSTATE or a named reason, context the ids involved (never personal data or secrets). cron-watchdog reports each row to Sentry and deletes it.';

-- odd/tasks/table-cleanup.md S6a. Written only by SECURITY DEFINER functions
-- owned by postgres (the dispute crons, fn_notify_held_payouts, the notice
-- failures of fn_complete_shipment_transfer and fn_record_dispute_refund,
-- fn_refresh_seller_stats, fn_update_product_fts) and, since S6d (T6b, #153),
-- the RPCs that catch an unexpected error and answer with a generic code
-- (supabase/tests/database/rpc_error_paths.test.sql lists them). Growth (docs/conventions.md,
-- "Design target"): one row per swallowed failure, normally none; a failure
-- that repeats adds one row per run (hourly at most). cron-watchdog deletes the
-- rows it reported (S6b), so the table stays small and needs no index beyond
-- its key. No client role holds a privilege on it; service_role may read and
-- delete it to drain it, and never writes it.
REVOKE ALL ON TABLE "internal"."ops_failures" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT DELETE, SELECT ON TABLE "internal"."ops_failures" TO "service_role";
