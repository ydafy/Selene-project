-- Cron leases (odd/tasks/internal-schema.md S4, T1): internal.cron_leases holds
-- one expiring lease per cron job, and only fn_acquire_cron_lease and
-- fn_release_cron_lease touch it. Each job has a fixed lease length, a live
-- lease is never granted twice, an expired one is taken over with a new id, only
-- the holder releases it, an unknown job is refused, only the service_role
-- claim may call them, and checkout recovery gets no lease while it is
-- disabled. The concurrent-acquire races are in scripts/verify
-- (test-auto-cancel-lease.ts, test-checkout-recovery-lease.ts).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(32);

-- The error message of a statement, or 'ok'. The exception block rolls the
-- statement back like a failed call.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute 'set local role service_role';
end $$;

-- The stored lease of a job as lease_id|expires_at, or '-'. Reads the table
-- as the owner.
create function pg_temp.stored(p_job text) returns text language sql as $$
  select coalesce((select l.lease_id::text || '|' || l.expires_at::text
    from internal.cron_leases l where l.job = p_job), '-')
$$;

-- Sets the lease of p_job to expire p_offset after this statement's time, then
-- acquires it: acquired|the old lease is still stored.
create function pg_temp.acquire_at(p_job text, p_offset interval) returns text language plpgsql as $$
declare
  v_old uuid := gen_random_uuid();
  v_row record;
begin
  insert into internal.cron_leases (job, lease_id, expires_at)
  values (p_job, v_old, statement_timestamp() + p_offset)
  on conflict (job) do update set lease_id = excluded.lease_id, expires_at = excluded.expires_at;
  select * into v_row from public.fn_acquire_cron_lease(p_job);
  return v_row.acquired::text || '|'
    || coalesce((select (l.lease_id = v_old)::text from internal.cron_leases l where l.job = p_job), '-');
end $$;

create temp table jobs (job text, ttl interval);
insert into jobs values
  ('auto_cancel_orders', interval '600 seconds'),
  ('auto_cancel_preparing', interval '600 seconds'),
  ('checkout_recovery', interval '600 seconds'),
  ('track_shipments_preparing', interval '300 seconds'),
  ('track_shipments_shipped', interval '300 seconds');
grant select on jobs to service_role;

delete from internal.cron_leases;
update public.system_settings set checkout_recovery_enabled = true where id = 1;

-- 1. Table, grants and security mode ---------------------------------------------------------
select is(
  (select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'internal' and table_name = 'cron_leases'),
  'job:text:NO,lease_id:uuid:NO,expires_at:timestamp with time zone:NO',
  'table: internal.cron_leases holds job, lease_id and expires_at, all required');
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'internal.cron_leases'::regclass and c.contype = 'p'),
  'PRIMARY KEY (job)', 'table: one lease row per job');
select is(
  (select c.relrowsecurity::text || ':' || count(p.*) from pg_class c
   left join pg_policies p on p.schemaname = 'internal' and p.tablename = 'cron_leases'
   where c.oid = 'internal.cron_leases'::regclass group by c.relrowsecurity),
  'true:0', 'table: RLS is on and there is no policy');
select is_empty(
  $$select a.grantee::regrole::text || ':' || a.privilege_type
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'internal.cron_leases'::regclass and a.grantee <> c.relowner$$,
  'table: no role other than the owner holds a privilege on internal.cron_leases');
select is(
  (select string_agg(r || ':' || has_table_privilege(r, 'internal.cron_leases',
     'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')::text, ' ' order by r)
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false authenticated:false service_role:false',
  'table: anon, authenticated and service_role have no privilege on internal.cron_leases');
select is(
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'execute')::text || ':'
     || has_function_privilege('authenticated', f, 'execute')::text || ':'
     || has_function_privilege('service_role', f, 'execute')::text, ' ' order by f)
   from unnest(array['public.fn_acquire_cron_lease(text)', 'public.fn_release_cron_lease(text, uuid)']) f),
  'public.fn_acquire_cron_lease(text):false:false:true public.fn_release_cron_lease(text, uuid):false:false:true',
  'grants: only service_role can execute fn_acquire_cron_lease and fn_release_cron_lease');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_acquire_cron_lease', 'fn_release_cron_lease')),
  'fn_acquire_cron_lease:true:search_path="" fn_release_cron_lease:true:search_path=""',
  'security mode: both run as definer with an empty search_path');
select is(
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'system_settings'
     and (column_name like '%lease%' or column_name like '%\_running')),
  null, 'settings: the lease columns and the *_running flags are gone from system_settings');
select is(
  (select count(*)::integer from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_acquire_auto_cancel_lease', 'fn_release_auto_cancel_lease',
       'fn_acquire_track_shipments_lease', 'fn_release_track_shipments_lease',
       'fn_acquire_checkout_recovery_lease', 'fn_release_checkout_recovery_lease')),
  0, 'functions: the six per-job lease functions are gone');

-- 2. Callers ---------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role service_role;
select is(
  pg_temp.err($$select public.fn_acquire_cron_lease('auto_cancel_orders')$$) || ' '
    || pg_temp.err($$select public.fn_release_cron_lease('auto_cancel_orders', gen_random_uuid())$$),
  'UNAUTHORIZED UNAUTHORIZED', 'callers: both refuse a caller without the service_role claim, even as the service_role database role');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  pg_temp.err($$select public.fn_acquire_cron_lease('auto_cancel_orders')$$) || ' '
    || pg_temp.err($$select public.fn_release_cron_lease('auto_cancel_orders', gen_random_uuid())$$),
  'UNAUTHORIZED UNAUTHORIZED', 'callers: both refuse a caller without claims');
select is(pg_temp.stored('auto_cancel_orders'), '-', 'callers: a refused acquire stores nothing');
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.fn_acquire_cron_lease('auto_cancel_orders')$$, '42501', null,
  'callers: authenticated cannot execute fn_acquire_cron_lease');
select throws_ok($$select public.fn_release_cron_lease('auto_cancel_orders', gen_random_uuid())$$, '42501', null,
  'callers: authenticated cannot execute fn_release_cron_lease');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select public.fn_acquire_cron_lease('auto_cancel_orders')$$, '42501', null,
  'callers: anon cannot execute fn_acquire_cron_lease');
reset role;

-- 3. Job names -------------------------------------------------------------------------------
select pg_temp.as_service();
select is(
  (select string_agg(coalesce(j, 'NULL') || ':'
     || pg_temp.err(format('select public.fn_acquire_cron_lease(%L)', j)) || ':'
     || pg_temp.err(format('select public.fn_release_cron_lease(%L, gen_random_uuid())', j)), ' ' order by j nulls first)
   from unnest(array[null, '', 'orders', 'preparing', 'shipped', 'AUTO_CANCEL_ORDERS', 'nope']) j),
  'NULL:INVALID_CRON_LEASE_JOB:INVALID_CRON_LEASE_JOB :INVALID_CRON_LEASE_JOB:INVALID_CRON_LEASE_JOB '
    || 'AUTO_CANCEL_ORDERS:INVALID_CRON_LEASE_JOB:INVALID_CRON_LEASE_JOB nope:INVALID_CRON_LEASE_JOB:INVALID_CRON_LEASE_JOB '
    || 'orders:INVALID_CRON_LEASE_JOB:INVALID_CRON_LEASE_JOB preparing:INVALID_CRON_LEASE_JOB:INVALID_CRON_LEASE_JOB '
    || 'shipped:INVALID_CRON_LEASE_JOB:INVALID_CRON_LEASE_JOB',
  'jobs: NULL, unknown and the old per-function job names are refused by both functions');
reset role;
select is((select count(*)::integer from internal.cron_leases), 0, 'jobs: a refused job stores nothing');

-- 4. Acquire ---------------------------------------------------------------------------------
select pg_temp.as_service();
create temp table first_leases as
select j.job, a.acquired, a.lease_id, a.lease_expires_at, statement_timestamp() as st, j.ttl
from jobs j cross join lateral public.fn_acquire_cron_lease(j.job) a;
reset role;
select is(
  (select string_agg(job || ':' || acquired::text || ':' || (lease_expires_at - st)::text, ' ' order by job) from first_leases),
  'auto_cancel_orders:true:00:10:00 auto_cancel_preparing:true:00:10:00 checkout_recovery:true:00:10:00 '
    || 'track_shipments_preparing:true:00:05:00 track_shipments_shipped:true:00:05:00',
  'acquire: every job gets a free lease for its own length from the statement time');
select is(
  (select count(*)::integer from first_leases f join internal.cron_leases l
     on l.job = f.job and l.lease_id = f.lease_id and l.expires_at = f.lease_expires_at),
  5, 'acquire: each job stores its returned lease id and expiry in its own row');
select is((select count(distinct lease_id)::integer from first_leases), 5, 'acquire: every lease gets its own id');
select pg_temp.as_service();
select is(
  (select string_agg(j.job || ':' || row(a.*)::text, ' ' order by j.job)
   from jobs j cross join lateral public.fn_acquire_cron_lease(j.job) a),
  'auto_cancel_orders:(f,,) auto_cancel_preparing:(f,,) checkout_recovery:(f,,) '
    || 'track_shipments_preparing:(f,,) track_shipments_shipped:(f,,)',
  'acquire: a live lease is not granted a second time');
reset role;
select is(
  (select count(*)::integer from first_leases f join internal.cron_leases l
     on l.job = f.job and l.lease_id = f.lease_id and l.expires_at = f.lease_expires_at),
  5, 'acquire: a refused second acquire leaves every lease unchanged');

-- 5. Release ---------------------------------------------------------------------------------
select pg_temp.as_service();
select is(
  public.fn_release_cron_lease('auto_cancel_orders', gen_random_uuid())::text || ':'
    || public.fn_release_cron_lease('auto_cancel_orders', null)::text || ':'
    || public.fn_release_cron_lease('auto_cancel_preparing',
         (select lease_id from first_leases where job = 'auto_cancel_orders'))::text,
  'false:false:false', 'release: another id, a NULL id and the id of another job release nothing');
reset role;
select is(
  (select count(*)::integer from first_leases f join internal.cron_leases l
     on l.job = f.job and l.lease_id = f.lease_id),
  5, 'release: a refused release leaves every lease in place');
select pg_temp.as_service();
select is(
  public.fn_release_cron_lease('auto_cancel_orders', (select lease_id from first_leases where job = 'auto_cancel_orders'))::text
    || ':' || public.fn_release_cron_lease('auto_cancel_orders', (select lease_id from first_leases where job = 'auto_cancel_orders'))::text,
  'true:false', 'release: the holder releases its lease once; a second release returns false');
reset role;
select is(
  pg_temp.stored('auto_cancel_orders') || ' ' || (select count(*)::integer from internal.cron_leases)::text,
  '- 4', 'release: the holder''s release deletes only its own job''s row');
select pg_temp.as_service();
select is(
  (select acquired::text from public.fn_acquire_cron_lease('auto_cancel_orders')),
  'true', 'release: a released lease is acquired again');
reset role;

-- 6. Expiry and takeover ---------------------------------------------------------------------
select is(pg_temp.acquire_at('track_shipments_shipped', interval '1 microsecond'), 'false|true',
  'expiry: a lease that expires after the statement time is still live');
select is(pg_temp.acquire_at('track_shipments_shipped', interval '0'), 'true|false',
  'expiry: a lease that expires exactly at the statement time is taken over with a new id');
create temp table stale as select lease_id from internal.cron_leases where job = 'track_shipments_preparing';
grant select on stale to service_role;
update internal.cron_leases set expires_at = statement_timestamp() - interval '1 second'
where job = 'track_shipments_preparing';
select pg_temp.as_service();
create temp table fresh as select * from public.fn_acquire_cron_lease('track_shipments_preparing');
select is(
  (select (f.acquired and f.lease_id <> s.lease_id)::text from fresh f, stale s) || ':'
    || public.fn_release_cron_lease('track_shipments_preparing', (select lease_id from stale))::text,
  'true:false', 'expiry: an expired lease is taken over with a new id, and the superseded holder cannot release it');
reset role;

-- 7. Checkout recovery switch ----------------------------------------------------------------
delete from internal.cron_leases where job = 'checkout_recovery';
update public.system_settings set checkout_recovery_enabled = false where id = 1;
select pg_temp.as_service();
select is(
  (select row(a.*)::text from public.fn_acquire_cron_lease('checkout_recovery') a),
  '(f,,)', 'checkout recovery: a disabled worker gets no lease');
reset role;
select is(pg_temp.stored('checkout_recovery'), '-', 'checkout recovery: a disabled worker stores no lease');

select * from finish();
rollback;
