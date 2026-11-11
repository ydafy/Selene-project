-- Cron health read model (#277 T8): fn_cron_health returns one row per pg_cron
-- job with its name, schedule, active flag and the start time and status of
-- its newest started run (highest runid), never the job command or a run's
-- return message. The jobs and runs below are created inside the transaction
-- and rolled back. Runs against the local database only: `supabase start`,
-- then `bun run test:db`.
begin;
select plan(8);

-- Jobs created out of name order: z, a, b, c, then one without a name.
create temporary table t8_jobs (tag text primary key, jobid bigint not null) on commit drop;
insert into t8_jobs values
  ('z', cron.schedule('t8_health_z', '0 5 * * *', 'select 1')),
  ('a', cron.schedule('t8_health_a', '0 3 * * *', 'select 1')),
  ('b', cron.schedule('t8_health_b', '*/10 * * * *', 'select 1')),
  ('c', cron.schedule('t8_health_c', '0 4 * * *', 'select 1')),
  ('unnamed', cron.schedule('0 6 * * *', 'select 1'));
select cron.alter_job((select jobid from t8_jobs where tag = 'b'), active := false);
grant select on t8_jobs to service_role;

-- Runs, inserted in runid order. Job a: the newest run started earlier than
-- the previous one. Job c: the newest run has not started. Job b: no runs.
-- runids far above the real ones (the test cannot use cron.runid_seq).
create temporary sequence t8_runid start 9000000000000001;
create function pg_temp.run(p_tag text, p_ago interval, p_status text) returns void language sql as $$
  insert into cron.job_run_details (jobid, runid, command, status, return_message, start_time)
  select j.jobid, nextval('t8_runid'), 'select 1', p_status, 'secret detail', now() - p_ago
  from t8_jobs j where j.tag = p_tag
$$;
select pg_temp.run('a', interval '1 hour', 'failed');
select pg_temp.run('a', interval '2 hours', 'succeeded');
select pg_temp.run('c', interval '3 hours', 'succeeded');
select pg_temp.run('c', null, 'starting');

-- The row of a job tag, as text, read as service_role.
create function pg_temp.health(p_tag text) returns text language sql as $$
  select row(h.*)::text from public.fn_cron_health() h
  where h.jobname = coalesce('t8_health_' || nullif(p_tag, 'unnamed'),
    'job-' || (select jobid from t8_jobs where tag = 'unnamed'))
$$;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

select is(pg_get_function_result('public.fn_cron_health()'::regprocedure),
  'TABLE(jobname text, schedule text, active boolean, last_start timestamp with time zone, last_status text)',
  'returns jobname, schedule, active, last_start and last_status, and no command or return_message column');
select is(pg_temp.health('a'),
  row('t8_health_a', '0 3 * * *', true, now() - interval '2 hours', 'succeeded')::text,
  'a job reports its newest run by runid, even when an older run started later');
select is(pg_temp.health('c'),
  row('t8_health_c', '0 4 * * *', true, now() - interval '3 hours', 'succeeded')::text,
  'a run without a start time is skipped');
select is(pg_temp.health('b'),
  row('t8_health_b', '*/10 * * * *', false, null::timestamptz, null::text)::text,
  'a job with no runs is listed with its active flag and NULL last_start and last_status');
select is(pg_temp.health('unnamed'),
  row('job-' || (select jobid from t8_jobs where tag = 'unnamed'), '0 6 * * *', true, null::timestamptz, null::text)::text,
  'a job without a name is listed as job-<jobid>');
select is(
  (select array_agg(h.jobname order by o) from public.fn_cron_health() with ordinality h(jobname, schedule, active, last_start, last_status, o)
   where h.jobname like 't8_health_%'),
  array['t8_health_a', 't8_health_b', 't8_health_c', 't8_health_z'],
  'rows come ordered by job name');
select is((select count(*) from public.fn_cron_health() h where h.jobname in ('t8_health_a', 't8_health_c')), 2::bigint,
  'one row per job, however many runs it has');

-- The body checks no role: the EXECUTE grant (function_grants.test.sql) is its only guard.
reset role;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select is(pg_temp.health('b'),
  row('t8_health_b', '*/10 * * * *', false, null::timestamptz, null::text)::text,
  'the body reads no JWT role: a caller holding EXECUTE gets the rows whatever its claims');

select * from finish();
rollback;
