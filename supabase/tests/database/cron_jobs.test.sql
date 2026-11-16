-- The pg_cron jobs declared in supabase/schemas/ hold no secret: every HTTP
-- job takes its URL and every header value except Content-Type from Vault by
-- name (cron-functions-as-code S2, S6, S7). The test pins invariants, not the
-- job list. It gives each Vault name a known value, runs every HTTP job's
-- command with net.http_post swapped for a recorder, and checks what the job
-- would send. Every HTTP job also records its pg_net request id under its own
-- name through internal.fn_track_cron_request (odd/tasks/ops-cron-storage.md
-- S3, L6), which fn_cron_health reads. The scripts/guards/cron-jobs.test.ts
-- guard checks the targets and schedules. Runs against the local database only: `supabase start`, then
-- `bun run test:db`.
begin;
select plan(18);

create temporary table captured (
  jobname text not null,
  url text,
  headers jsonb,
  request_id bigint not null
) on commit drop;

-- Same parameters as net.http_post; records the call instead of sending it and
-- returns a distinct request id per call, far above the real ones.
create temporary sequence cron_jobs_request_id start 9000000000000001;
create function pg_temp.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language sql as $$
  insert into captured (jobname, url, headers, request_id)
  values (current_setting('cron_jobs_test.jobname'), url, headers, nextval('cron_jobs_request_id'))
  returning request_id;
$$;

-- Every Vault name a job reads now holds 'vault:<name>'.
do $$
declare
  secret_name text;
  existing uuid;
begin
  for secret_name in
    select distinct m[1]
    from cron.job,
      regexp_matches(command, 'name\s*=\s*''([^'']+)''', 'g') as m
  loop
    select id into existing from vault.secrets where name = secret_name;
    if existing is null then
      perform vault.create_secret('vault:' || secret_name, secret_name);
    else
      perform vault.update_secret(existing, 'vault:' || secret_name);
    end if;
  end loop;
end
$$;

do $$
declare
  job record;
begin
  for job in
    select jobname, command from cron.job
    where command ~* 'net\.http_post\s*\('
  loop
    perform set_config('cron_jobs_test.jobname', job.jobname, true);
    execute regexp_replace(
      job.command, 'net\.http_post\s*\(', 'pg_temp.http_post(', 'gi'
    );
  end loop;
end
$$;

select ok(
  (select count(*) from cron.job) > 0,
  'the migrations create at least one cron job'
);

select is_empty(
  $$ select jobname from cron.job
     where command ~ 'eyJ[A-Za-z0-9_-]{10,}'
        or command ~ '\m(sk|rk)_'
        or command ~ '\m(whsec|sb_secret|sb_publishable)_' $$,
  'no cron job command holds a literal JWT, Stripe key, webhook secret or Supabase API key'
);

select ok(
  (select count(*) from captured) > 0,
  'at least one cron job calls an Edge Function'
);

select is(
  (select count(*) from captured),
  (select count(*) from cron.job where command ~* 'net\.http_post\s*\('),
  'every HTTP job command ran through the recorder exactly once'
);

select is_empty(
  $$ select jobname, url from captured
     where url is null or url !~ '^vault:[a-z0-9_]+/functions/v1/[a-z0-9-]+$' $$,
  'every HTTP job URL is a Vault entry followed by /functions/v1/<function>'
);

select is_empty(
  $$ select jobname, h.key, h.value
     from captured, jsonb_each_text(headers) as h
     where h.key <> 'Content-Type'
       and h.value !~ '^(Bearer )?vault:[a-z0-9_]+$' $$,
  'every HTTP header except Content-Type is a Vault entry (after "Bearer " for Authorization)'
);

select is_empty(
  $$ select jobname from captured
     where headers is null
        or headers ->> 'Content-Type' is distinct from 'application/json' $$,
  'every HTTP job sends JSON'
);

-- Cron jobs send no Supabase API key or JWT (#397): every cron-invoked
-- function runs with verify_jwt = false and checks its own secret header.
select is_empty(
  $$ select jobname from captured where headers ? 'apikey' $$,
  'no HTTP job sends an apikey header'
);

select is_empty(
  $$ select distinct jobname, m[1]
     from cron.job,
       regexp_matches(command, 'name\s*=\s*''([^'']+)''', 'g') as m
     where m[1] ~ '(jwt|anon|service_role)' $$,
  'no cron job reads a Vault secret named like a JWT, anon key or service-role key'
);

select is_empty(
  $$ select jobname from captured
     where headers ? 'Authorization'
       and url !~ '/functions/v1/track-shipments$' $$,
  'only the track-shipments jobs send an Authorization header'
);

select is_empty(
  $$ select jobname from captured
     where url !~ '/functions/v1/track-shipments$'
       and not headers ? 'x-cron-secret' $$,
  'every HTTP job except track-shipments sends x-cron-secret'
);

select is_empty(
  $$ select jobname from cron.job where jobname = 'purge-old-evidence' $$,
  'purge-old-evidence is not scheduled (#29 recreates it through the Storage API)'
);

-- Request tracking (S3) -------------------------------------------------------
select is_empty(
  $$ select jobname from cron.job
     where command ~* 'net\.http_post\s*\('
       and position(format('select internal.fn_track_cron_request(%L, net.http_post(', jobname) in command) <> 1 $$,
  'every HTTP job command is select internal.fn_track_cron_request(<its own jobname>, net.http_post(...))'
);

select is(
  (select count(distinct request_id) from captured),
  (select count(*) from captured),
  'the recorder returned a distinct request id for every HTTP job call'
);

select is_empty(
  $$ select c.jobname, c.request_id from captured c
     left join internal.cron_http_requests t on t.request_id = c.request_id
     where t.jobname is distinct from c.jobname
        or t.requested_at is distinct from now() $$,
  'every HTTP job call wrote a tracking row with its request id, its own jobname and the request time'
);

select is(
  internal.fn_track_cron_request('cron-jobs-test', 9100000000000001),
  9100000000000001::bigint,
  'fn_track_cron_request returns the request id it records'
);

insert into internal.cron_http_requests (request_id, jobname, requested_at) values
  (9100000000000002, 'cron-jobs-test', now() - interval '25 hours'),
  (9100000000000003, 'cron-jobs-test', now() - interval '23 hours');
select internal.fn_track_cron_request('cron-jobs-test', 9100000000000004);
select is(
  (select array_agg(request_id order by request_id) from internal.cron_http_requests
   where jobname = 'cron-jobs-test'),
  array[9100000000000001, 9100000000000003, 9100000000000004]::bigint[],
  'fn_track_cron_request deletes tracking rows older than 1 day and keeps newer ones'
);

select is(
  (select c.relrowsecurity::text || ' '
     || (select string_agg(r || ':' || has_table_privilege(r, 'internal.cron_http_requests',
           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')::text, ' ' order by r)
         from unnest(array['anon', 'authenticated', 'service_role']) r)
     || ' ' || (select string_agg(r || ':' || has_function_privilege(r,
           'internal.fn_track_cron_request(text, bigint)', 'EXECUTE')::text, ' ' order by r)
         from unnest(array['anon', 'authenticated', 'postgres', 'service_role']) r)
   from pg_class c where c.oid = 'internal.cron_http_requests'::regclass),
  'true anon:false authenticated:false service_role:false anon:false authenticated:false postgres:true service_role:false',
  'cron_http_requests has RLS on and no client or service_role privilege; only postgres executes fn_track_cron_request'
);

select * from finish();
rollback;
