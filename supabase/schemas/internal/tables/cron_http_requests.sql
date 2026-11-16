CREATE TABLE "internal"."cron_http_requests" (
  "request_id"   bigint                   NOT NULL,
  "jobname"      text                     NOT NULL,
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cron_http_requests_pkey" PRIMARY KEY (request_id)
);

CREATE INDEX cron_http_requests_jobname_requested_at_idx ON internal.cron_http_requests USING btree (jobname, requested_at DESC);

ALTER TABLE "internal"."cron_http_requests"
  ENABLE ROW LEVEL SECURITY;

-- The pg_net request id of every HTTP cron call, under its job name
-- (odd/tasks/ops-cron-storage.md S3, L6). fn_cron_health joins it to
-- net._http_response to return each job's latest HTTP outcome. Only
-- internal.fn_track_cron_request (run by pg_cron as postgres) writes it and only
-- fn_cron_health (SECURITY DEFINER, owner postgres) reads it, so no client role
-- and not service_role hold a privilege on it.
REVOKE ALL ON TABLE "internal"."cron_http_requests" FROM PUBLIC, "anon", "authenticated", "service_role";
