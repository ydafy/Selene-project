-- ============================================================================
-- fn_cron_health: pg_cron job health for the cron-watchdog Edge Function.
--
-- Why: missed or failing cron jobs (payouts, fee reconciliation, shipment
-- completion) were only visible in logs nobody reads. The watchdog needs one
-- row per job with its schedule and latest run outcome. The `cron` schema is
-- not readable by the service role, hence SECURITY DEFINER.
--
-- Exposes only: jobname, schedule, active, last_start, last_status. It never
-- selects `command` (Vault lookups, URLs) or `return_message` (can echo data
-- or secrets).
--
-- Grant review (AGENTS.md): SECURITY DEFINER with search_path pinned to
-- pg_catalog, pg_temp and fully qualified references. PUBLIC gets EXECUTE by
-- default and anon/authenticated inherit it, so revoke all three explicitly and
-- grant only service_role. Anonymous access is not intended: job names and
-- schedules are internal operational data.
--
-- Canonical definition: supabase/queries/maintenance/fn_cron_health.sql
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
