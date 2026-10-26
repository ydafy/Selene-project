-- ============================================================================
-- Canonical: public.fn_cron_health()
-- Read model of pg_cron health for the cron-watchdog Edge Function
-- (service_role only). Never exposes `command` or `return_message`.
-- Deployed by: supabase/migrations/20261021025844_cron_health.sql, replaced by
-- 20261026014010_cron_health_index_scan.sql (primary key read, BL33).
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
      AND r.start_time IS NOT NULL
    ORDER BY r.runid DESC
    LIMIT 1
  ) AS d ON true
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.fn_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cron_health() TO service_role;
