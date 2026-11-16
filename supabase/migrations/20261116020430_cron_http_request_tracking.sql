-- Cron HTTP request tracking (odd/tasks/ops-cron-storage.md S3, L6).
--
-- Hand-edited after `supabase db schema declarative sync`: pg-delta unscheduled
-- every HTTP job before scheduling it again, which gives each job a new jobid
-- and loses its run history. cron.schedule_in_database updates a job with the
-- same name and owner in place (same jobid), so the unschedule calls are
-- removed and only the commands change; no schedule changes.
--
-- The explicit REVOKEs for anon, authenticated and service_role on the new
-- table and function were added by hand; the default privileges already
-- grant them nothing, so they only make the grant review readable here.
SET local check_function_bodies = off;

CREATE TABLE "internal"."cron_http_requests" (
  "request_id"   bigint                   NOT NULL,
  "jobname"      text                     NOT NULL,
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cron_http_requests_pkey" PRIMARY KEY (request_id)
);

ALTER TABLE "internal"."cron_http_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION internal.fn_track_cron_request (
  p_jobname    text,
  p_request_id bigint
)
  RETURNS bigint
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  DELETE FROM internal.cron_http_requests
  WHERE requested_at < pg_catalog.now() - interval '1 day';

  INSERT INTO internal.cron_http_requests (request_id, jobname)
  VALUES (p_request_id, p_jobname)
  ON CONFLICT (request_id) DO UPDATE
    SET jobname = excluded.jobname, requested_at = excluded.requested_at
  RETURNING request_id;
$function$;

CREATE INDEX cron_http_requests_jobname_requested_at_idx ON internal.cron_http_requests USING btree (jobname, requested_at DESC);

REVOKE ALL ON FUNCTION "internal"."fn_track_cron_request"(text, bigint) FROM PUBLIC, "anon", "authenticated", "service_role";

REVOKE ALL ON TABLE "internal"."cron_http_requests" FROM PUBLIC, "anon", "authenticated", "service_role";

SELECT cron.schedule_in_database('account-closure-cleanup', '0 * * * *', 'select internal.fn_track_cron_request(''account-closure-cleanup'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/account-closure-cleanup'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''account_closure_cleanup_cron_secret'')
    ),
    body := ''{}''::jsonb
  ))', 'postgres', NULL, true);

SELECT cron.schedule_in_database('auto-cancel-orders-job', '0 * * * *', 'select internal.fn_track_cron_request(''auto-cancel-orders-job'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/auto-cancel-orders'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''auto_cancel_orders_cron_secret'')
    ),
    body := ''{}''::jsonb
  ))', 'postgres', NULL, true);

SELECT cron.schedule_in_database('auto-cancel-preparing-job', '30 * * * *', 'select internal.fn_track_cron_request(''auto-cancel-preparing-job'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/auto-cancel-preparing'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''auto_cancel_orders_cron_secret'')
    ),
    body := ''{}''::jsonb,
    timeout_milliseconds := 120000
  ))', 'postgres', NULL, true);

SELECT
  cron.schedule_in_database('checkout-recovery-worker-every-5-minutes', '*/5 * * * *',
  'select internal.fn_track_cron_request(''checkout-recovery-worker-every-5-minutes'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/checkout-recovery-worker'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''checkout_recovery_worker_cron_secret'')
    ),
    body := ''{}''::jsonb
  ))', 'postgres', NULL, true);

SELECT cron.schedule_in_database('complete-delivered-shipments', '*/5 * * * *', 'select internal.fn_track_cron_request(''complete-delivered-shipments'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/complete-delivered-shipments'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''complete_delivered_shipments_cron_secret'')
    ),
    body := ''{}''::jsonb
  ))', 'postgres', NULL, true);

SELECT cron.schedule_in_database('cron-watchdog-every-15-minutes', '*/15 * * * *', 'select internal.fn_track_cron_request(''cron-watchdog-every-15-minutes'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/cron-watchdog'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''cron_watchdog_cron_secret'')
    ),
    body := ''{}''::jsonb,
    timeout_milliseconds := 30000
  ))', 'postgres', NULL, true);

SELECT cron.schedule_in_database('dispatch-push-every-minute', '*/1 * * * *', 'select internal.fn_track_cron_request(''dispatch-push-every-minute'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/dispatch-push'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''dispatch_push_cron_secret'')
    ),
    body := ''{}''::jsonb,
    timeout_milliseconds := 120000
  ))', 'postgres', NULL, true);

SELECT
  cron.schedule_in_database('reconcile-stripe-fees-every-5-minutes', '*/5 * * * *', 'select internal.fn_track_cron_request(''reconcile-stripe-fees-every-5-minutes'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/reconcile-stripe-fees'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''reconcile_stripe_fees_cron_secret'')
    ),
    body := ''{}''::jsonb
  ))', 'postgres', NULL, true);

SELECT cron.schedule_in_database('resume-pending-payouts', '*/5 * * * *', 'select internal.fn_track_cron_request(''resume-pending-payouts'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/resume-pending-payouts'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''resume_pending_payouts_cron_secret'')
    ),
    body := ''{}''::jsonb
  ))', 'postgres', NULL, true);

SELECT cron.schedule_in_database('track-shipments-preparing', '*/5 * * * *', 'select internal.fn_track_cron_request(''track-shipments-preparing'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/track-shipments'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''track_shipments_cron_secret'')
    ),
    body := ''{"lane": "preparing"}''::jsonb
  ))', 'postgres', NULL, true);

SELECT cron.schedule_in_database('track-shipments-shipped', '*/15 * * * *', 'select internal.fn_track_cron_request(''track-shipments-shipped'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/track-shipments'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''track_shipments_cron_secret'')
    ),
    body := ''{"lane": "shipped"}''::jsonb
  ))', 'postgres', NULL, true);
