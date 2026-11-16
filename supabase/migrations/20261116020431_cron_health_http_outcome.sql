-- fn_cron_health returns each cron job's latest HTTP outcome
-- (odd/tasks/ops-cron-storage.md S3, L6), read from internal.cron_http_requests
-- joined to net._http_response. The return type changes, so the function is
-- dropped and created again, and its grants and REVOKEs are restated.
DROP FUNCTION "public"."fn_cron_health"();

CREATE OR REPLACE FUNCTION public.fn_cron_health()
  RETURNS TABLE (
    jobname             text,
    schedule            text,
    active              boolean,
    last_start          timestamp with time zone,
    last_status         text,
    last_http_status    integer,
    last_http_failed_at timestamp with time zone,
    last_http_error     text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp'
  AS $function$
  SELECT
    COALESCE(j.jobname, 'job-' || j.jobid::text)::text,
    j.schedule::text,
    j.active,
    d.start_time,
    d.status::text,
    h.status_code,
    f.created,
    f.error
  FROM cron.job AS j
  LEFT JOIN LATERAL (
    SELECT r.start_time, r.status
    FROM cron.job_run_details AS r
    WHERE r.jobid = j.jobid
      AND r.start_time IS NOT NULL
    ORDER BY r.runid DESC
    LIMIT 1
  ) AS d ON true
  LEFT JOIN LATERAL (
    SELECT resp.status_code
    FROM internal.cron_http_requests AS t
    JOIN net._http_response AS resp ON resp.id = t.request_id
    WHERE t.jobname = j.jobname
    ORDER BY t.requested_at DESC, t.request_id DESC
    LIMIT 1
  ) AS h ON true
  LEFT JOIN LATERAL (
    SELECT
      resp.created,
      CASE
        WHEN resp.status_code >= 400 THEN 'HTTP ' || resp.status_code::text
        WHEN resp.timed_out IS TRUE THEN 'timed out'
        ELSE resp.error_msg
      END AS error
    FROM internal.cron_http_requests AS t
    JOIN net._http_response AS resp ON resp.id = t.request_id
    WHERE t.jobname = j.jobname
      AND (resp.status_code >= 400 OR resp.timed_out IS TRUE OR resp.error_msg IS NOT NULL)
    ORDER BY t.requested_at DESC, t.request_id DESC
    LIMIT 1
  ) AS f ON true
  ORDER BY 1;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_cron_health"() FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."fn_cron_health"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_cron_health"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_cron_health"() TO "service_role";
