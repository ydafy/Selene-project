-- The pg_cron jobs declared in supabase/schemas/ hold no secret: every HTTP
-- job takes its URL and every header value except Content-Type from Vault by
-- name (cron-functions-as-code S2, S6, S7). The test pins invariants, not the
-- job list. It gives each Vault name a known value, runs every HTTP job's
-- command with net.http_post swapped for a recorder, and checks what the job
-- would send. The scripts/guards/cron-jobs.test.ts guard checks the targets and
-- schedules. Runs against the local database only: `supabase start`, then
-- `bun run test:db`.
begin;
select plan(12);

create temporary table captured (
  jobname text not null,
  url text,
  headers jsonb
) on commit drop;

-- Same parameters as net.http_post; records the call instead of sending it.
create function pg_temp.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language sql as $$
  insert into captured (jobname, url, headers)
  values (current_setting('cron_jobs_test.jobname'), url, headers);
  select 1::bigint;
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

select * from finish();
rollback;
