-- ============================================================================
-- Canonical: public.fn_cron_health()
-- Read model of pg_cron health for the cron-watchdog Edge Function
-- (service_role only). Never exposes `command` or `return_message`.
-- Deployed by: supabase/migrations/*_cron_health.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cron_health()
RETURNS TABLE(
  jobname text,
  schedule text,
  active boolean,
  last_start timestamptz,
  last_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
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
    ORDER BY r.start_time DESC NULLS LAST
    LIMIT 1
  ) AS d ON true
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.fn_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cron_health() TO service_role;
