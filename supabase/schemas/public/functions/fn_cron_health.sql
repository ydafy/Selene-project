CREATE OR REPLACE FUNCTION public.fn_cron_health()
  RETURNS TABLE (
    jobname     text,
    schedule    text,
    active      boolean,
    last_start  timestamp with time zone,
    last_status text
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
    d.status::text
  FROM cron.job AS j
  LEFT JOIN LATERAL (
    SELECT r.start_time, r.status
    FROM cron.job_run_details AS r
    WHERE r.jobid = j.jobid
      AND r.start_time IS NOT NULL
    ORDER BY r.runid DESC
    LIMIT 1
  ) AS d ON true
  ORDER BY 1;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_cron_health"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_cron_health"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_cron_health"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_cron_health"() FROM PUBLIC, "anon", "authenticated";
