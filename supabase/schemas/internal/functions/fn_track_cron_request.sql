-- Records the pg_net request id of an HTTP cron call under its job name and
-- returns the id (odd/tasks/ops-cron-storage.md S3, L6). Every HTTP job in
-- schemas/_cluster/misc.sql runs
-- `select internal.fn_track_cron_request('<jobname>', net.http_post(...))`.
-- It deletes tracking rows older than 1 day: pg_net keeps responses for 6 hours
-- (pg_net.ttl), so an older row has nothing left to join.
--
-- Grant review (AGENTS.md): SECURITY INVOKER; only pg_cron calls it, as
-- postgres, which owns internal.cron_http_requests. EXECUTE is revoked from
-- PUBLIC, anon, authenticated and service_role and kept for postgres alone.
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
  RETURNING request_id;
$function$;

REVOKE ALL ON FUNCTION "internal"."fn_track_cron_request"(text, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "internal"."fn_track_cron_request"(text, bigint) TO "postgres";

REVOKE ALL ON FUNCTION "internal"."fn_track_cron_request"(text, bigint) FROM PUBLIC, "anon", "authenticated", "service_role";
