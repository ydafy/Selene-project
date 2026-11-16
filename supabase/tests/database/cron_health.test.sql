-- Cron health read model (#277 T8): fn_cron_health returns one row per pg_cron
-- job with its name, schedule, active flag and the start time and status of
-- its newest started run (highest runid), never the job command or a run's
-- return message. It also returns the latest HTTP outcome of the job's tracked
-- pg_net requests (internal.cron_http_requests joined to net._http_response,
-- odd/tasks/ops-cron-storage.md S3, L6): the status code of the newest
-- response, and the time and text of the newest failed one. The jobs, runs,
-- requests and responses below are created inside the transaction and rolled
-- back. Runs against the local database only: `supabase start`,
-- then `bun run test:db`.
begin;
select plan(14);

-- Jobs created out of name order: z, a, b, c, then one without a name.
create temporary table t8_jobs (tag text primary key, jobid bigint not null) on commit drop;
insert into t8_jobs values
  ('z', cron.schedule('t8_health_z', '0 5 * * *', 'select 1')),
  ('a', cron.schedule('t8_health_a', '0 3 * * *', 'select 1')),
  ('b', cron.schedule('t8_health_b', '*/10 * * * *', 'select 1')),
  ('c', cron.schedule('t8_health_c', '0 4 * * *', 'select 1')),
  ('d', cron.schedule('t8_health_d', '*/5 * * * *', 'select 1')),
  ('e', cron.schedule('t8_health_e', '*/5 * * * *', 'select 1')),
  ('f', cron.schedule('t8_health_f', '*/5 * * * *', 'select 1')),
  ('g', cron.schedule('t8_health_g', '*/5 * * * *', 'select 1')),
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

-- Tracked HTTP requests, in request order, with the response pg_net wrote
-- p_ago before now (no response when p_ago is NULL: still pending). Request
-- ids far above the real ones. Job d: HTTP 500, then 200. Job e: a refused
-- connection, then a timeout. Job f: a refused connection. Job g: 200, then a
-- request still pending. Jobs a, b, c and the unnamed one: no tracked request.
create temporary sequence t8_request_id start 9000000000000001;
create function pg_temp.http(p_tag text, p_ago interval, p_status integer, p_timed_out boolean, p_error text)
returns void language plpgsql as $$
declare
  v_id bigint := internal.fn_track_cron_request('t8_health_' || p_tag, nextval('t8_request_id'));
begin
  -- Tracked first, unconditionally: a CTE filtered by a constant-false WHERE
  -- is never evaluated, which would drop the pending request.
  if p_ago is not null then
    insert into net._http_response (id, status_code, timed_out, error_msg, created)
    values (v_id, p_status, p_timed_out, p_error, now() - p_ago);
  end if;
end
$$;
select pg_temp.http('d', interval '50 minutes', 500, false, null);
select pg_temp.http('d', interval '10 minutes', 200, false, null);
select pg_temp.http('e', interval '40 minutes', null, false, 'Could not connect to server');
select pg_temp.http('e', interval '20 minutes', null, true, null);
select pg_temp.http('f', interval '30 minutes', null, false, 'Could not connect to server');
select pg_temp.http('g', interval '15 minutes', 200, false, null);
select pg_temp.http('g', null, null, null, null);

select is(
  (select count(*) from internal.cron_http_requests t
   where t.jobname = 't8_health_g'
     and not exists (select 1 from net._http_response r where r.id = t.request_id)),
  1::bigint,
  'job g has one tracked request still waiting for its response');

-- The row of a job tag, as text, read as service_role.
create function pg_temp.health(p_tag text) returns text language sql as $$
  select row(h.*)::text from public.fn_cron_health() h
  where h.jobname = coalesce('t8_health_' || nullif(p_tag, 'unnamed'),
    'job-' || (select jobid from t8_jobs where tag = 'unnamed'))
$$;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

select is(pg_get_function_result('public.fn_cron_health()'::regprocedure),
  'TABLE(jobname text, schedule text, active boolean, last_start timestamp with time zone, last_status text, last_http_status integer, last_http_failed_at timestamp with time zone, last_http_error text)',
  'returns jobname, schedule, active, last_start, last_status and the HTTP outcome, and no command, return_message or response body column');
select is(pg_temp.health('a'),
  row('t8_health_a', '0 3 * * *', true, now() - interval '2 hours', 'succeeded', null::integer, null::timestamptz, null::text)::text,
  'a job reports its newest run by runid, even when an older run started later');
select is(pg_temp.health('c'),
  row('t8_health_c', '0 4 * * *', true, now() - interval '3 hours', 'succeeded', null::integer, null::timestamptz, null::text)::text,
  'a run without a start time is skipped');
select is(pg_temp.health('b'),
  row('t8_health_b', '*/10 * * * *', false, null::timestamptz, null::text, null::integer, null::timestamptz, null::text)::text,
  'a job with no runs and no tracked request is listed with its active flag and NULL run and HTTP columns');
select is(pg_temp.health('unnamed'),
  row('job-' || (select jobid from t8_jobs where tag = 'unnamed'), '0 6 * * *', true, null::timestamptz, null::text, null::integer, null::timestamptz, null::text)::text,
  'a job without a name is listed as job-<jobid>');
select is(
  (select array_agg(h.jobname order by o)
   from public.fn_cron_health() with ordinality
     h(jobname, schedule, active, last_start, last_status, last_http_status, last_http_failed_at, last_http_error, o)
   where h.jobname like 't8_health_%'),
  array['t8_health_a', 't8_health_b', 't8_health_c', 't8_health_d', 't8_health_e', 't8_health_f', 't8_health_g', 't8_health_z'],
  'rows come ordered by job name');
select is((select count(*) from public.fn_cron_health() h where h.jobname in ('t8_health_a', 't8_health_c', 't8_health_d', 't8_health_g')), 4::bigint,
  'one row per job, however many runs and tracked requests it has');

select is(pg_temp.health('d'),
  row('t8_health_d', '*/5 * * * *', true, null::timestamptz, null::text, 200, now() - interval '50 minutes', 'HTTP 500')::text,
  'an HTTP 500 followed by a success: the latest status is 200 and the earlier failure stays visible as HTTP 500');
select is(pg_temp.health('e'),
  row('t8_health_e', '*/5 * * * *', true, null::timestamptz, null::text, null::integer, now() - interval '20 minutes', 'timed out')::text,
  'a timed-out response is the latest failure, reported as timed out with no status code');
select is(pg_temp.health('f'),
  row('t8_health_f', '*/5 * * * *', true, null::timestamptz, null::text, null::integer, now() - interval '30 minutes', 'Could not connect to server')::text,
  'a response without a status code reports the pg_net error message');
select is(pg_temp.health('g'),
  row('t8_health_g', '*/5 * * * *', true, null::timestamptz, null::text, 200, null::timestamptz, null::text)::text,
  'a request still waiting for its response is skipped: the latest status is the newest response');

-- The body checks no role: the EXECUTE grant (function_grants.test.sql) is its only guard.
reset role;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select is(pg_temp.health('b'),
  row('t8_health_b', '*/10 * * * *', false, null::timestamptz, null::text, null::integer, null::timestamptz, null::text)::text,
  'the body reads no JWT role: a caller holding EXECUTE gets the rows whatever its claims');

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.oid = 'public.fn_cron_health()'::regprocedure),
  'true:search_path=pg_catalog, pg_temp',
  'fn_cron_health stays SECURITY DEFINER with search_path pg_catalog, pg_temp, so service_role needs no privilege on cron, internal or net');

select * from finish();
rollback;
