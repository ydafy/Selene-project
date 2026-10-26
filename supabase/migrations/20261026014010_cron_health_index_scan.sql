-- ============================================================================
-- fn_cron_health: read the latest run of each job through the primary key.
--
-- Why (BL33): the first production run of cron-watchdog answered 500
-- CRON_HEALTH_RPC_FAILED. cron.job_run_details held 86,638 rows (116 MB), and
-- the LATERAL subquery ordered by start_time scanned the whole table once per
-- job (15 sequential scans, 4.2 s warm), past the 8 s statement timeout of
-- service_role when cold. runid comes from a sequence at run start, so the
-- highest runid with a start_time is the latest started run; walking the
-- primary key backwards reads a few rows per job (13 ms on the same data).
-- Checked on the remote data: identical result for all 15 jobs and no pair of
-- runs of one job whose runid order contradicts their start_time order.
-- A run with no start_time yet is skipped, as NULLS LAST did before.
--
-- Grant review (AGENTS.md): unchanged from 20261021025844_cron_health.sql.
-- SECURITY DEFINER because the service role cannot read the cron schema;
-- search_path pinned to pg_catalog, pg_temp; EXECUTE revoked from PUBLIC, anon
-- and authenticated (job names and schedules are internal) and granted only to
-- service_role. Restated below so this file is complete on its own.
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
      AND r.start_time IS NOT NULL
    ORDER BY r.runid DESC
    LIMIT 1
  ) AS d ON true
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.fn_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cron_health() TO service_role;
