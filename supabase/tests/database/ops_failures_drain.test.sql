-- Draining internal.ops_failures (odd/tasks/table-cleanup.md T6c, S6b).
-- internal is not exposed through PostgREST, so cron-watchdog reads the oldest
-- failures with public.fn_list_ops_failures(p_limit) and deletes the ones it
-- reported with public.fn_delete_ops_failures(p_ids). Only service_role may
-- execute either. Both run as the caller (SECURITY INVOKER): service_role
-- already holds SELECT and DELETE on the table, so the functions add no
-- privilege. The rows below are created inside the transaction and rolled back.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(20);

-- 1. Grants ------------------------------------------------------------------------
select has_function('public', 'fn_list_ops_failures', array['integer'], 'fn_list_ops_failures(integer) exists');
select has_function('public', 'fn_delete_ops_failures', array['bigint[]'], 'fn_delete_ops_failures(bigint[]) exists');
select results_eq(
  $$select p.proname::text collate "default", p.prosecdef, array_to_string(p.proconfig, $c$,$c$) collate "default", p.proowner::regrole::text collate "default"
    from pg_proc p
    where p.oid in ('public.fn_list_ops_failures(integer)'::regprocedure,
                    'public.fn_delete_ops_failures(bigint[])'::regprocedure)
    order by 1$$,
  $$values ('fn_delete_ops_failures', false, 'search_path=""', 'postgres'),
           ('fn_list_ops_failures', false, 'search_path=""', 'postgres')$$,
  'both functions are SECURITY INVOKER, owned by postgres, with an empty search_path');
select results_eq(
  $$select r.role_name collate "default", f.fn collate "default",
      has_function_privilege(r.role_name, f.fn, 'EXECUTE')
    from (values ('anon'), ('authenticated'), ('service_role')) r(role_name)
    cross join (values ('public.fn_delete_ops_failures(bigint[])'), ('public.fn_list_ops_failures(integer)')) f(fn)
    order by 1, 2$$,
  $$values ('anon', 'public.fn_delete_ops_failures(bigint[])', false),
           ('anon', 'public.fn_list_ops_failures(integer)', false),
           ('authenticated', 'public.fn_delete_ops_failures(bigint[])', false),
           ('authenticated', 'public.fn_list_ops_failures(integer)', false),
           ('service_role', 'public.fn_delete_ops_failures(bigint[])', true),
           ('service_role', 'public.fn_list_ops_failures(integer)', true)$$,
  'only service_role may execute the two functions');

set local role anon;
select throws_ok('select * from public.fn_list_ops_failures(10)', '42501', null, 'anon cannot list failures');
select throws_ok('select public.fn_delete_ops_failures(array[1]::bigint[])', '42501', null, 'anon cannot delete failures');
reset role;
set local role authenticated;
select throws_ok('select * from public.fn_list_ops_failures(10)', '42501', null, 'authenticated cannot list failures');
select throws_ok('select public.fn_delete_ops_failures(array[1]::bigint[])', '42501', null, 'authenticated cannot delete failures');
reset role;

-- 2. Listing -------------------------------------------------------------------------
-- Start from an empty table; the rollback restores whatever was there.
delete from internal.ops_failures;
insert into internal.ops_failures (source, code, context, occurred_at) values
  ('fn_b', 'B', '{"n": 2}', now() - interval '1 hour'),
  ('fn_a', 'A', '{"n": 1}', now() - interval '2 hours'),
  ('fn_c', 'C', '{"n": 3}', now() - interval '1 hour');

set local role service_role;
select results_eq(
  $$select source collate "default", code collate "default", context, occurred_at = now() - interval '2 hours'
    from public.fn_list_ops_failures(10)$$,
  $$values ('fn_a', 'A', '{"n": 1}'::jsonb, true),
           ('fn_b', 'B', '{"n": 2}'::jsonb, false),
           ('fn_c', 'C', '{"n": 3}'::jsonb, false)$$,
  'lists every column, oldest first, then by id for the same time');
select results_eq(
  $$select id from public.fn_list_ops_failures(10)$$,
  $$select id from internal.ops_failures order by occurred_at, id$$,
  'returns the row ids');
select results_eq($$select source collate "default" from public.fn_list_ops_failures(2)$$,
  $$values ('fn_a'), ('fn_b')$$, 'p_limit caps the rows');
select results_eq($$select source collate "default" from public.fn_list_ops_failures(0)$$,
  $$values ('fn_a')$$, 'a p_limit below 1 is raised to 1');
select results_eq($$select source collate "default" from public.fn_list_ops_failures(-5)$$,
  $$values ('fn_a')$$, 'a negative p_limit is raised to 1');
reset role;

insert into internal.ops_failures (source, code) select 'fn_bulk', 'X' from generate_series(1, 110);
set local role service_role;
select is((select count(*) from public.fn_list_ops_failures(1000)), 100::bigint, 'a p_limit above 100 is lowered to 100');
select is((select count(*) from public.fn_list_ops_failures(null)), 100::bigint, 'a null p_limit lists 100');
reset role;
delete from internal.ops_failures where source = 'fn_bulk';

-- 3. Deleting ------------------------------------------------------------------------
create temporary table drain_ids on commit drop as
select source, id from internal.ops_failures;
grant select on drain_ids to service_role;

set local role service_role;
select is(
  public.fn_delete_ops_failures(array[
    (select id from drain_ids where source = 'fn_a'),
    (select id from drain_ids where source = 'fn_c'),
    (select id from drain_ids where source = 'fn_a'),
    -1]),
  2, 'deletes the given ids and returns how many rows it removed (a repeated or unknown id counts nothing)');
reset role;
select results_eq($$select source collate "default" from internal.ops_failures order by id$$,
  $$values ('fn_b')$$, 'only the given ids are gone');

set local role service_role;
select is(public.fn_delete_ops_failures(array[(select id from drain_ids where source = 'fn_a')]), 0,
  'deleting an id again removes nothing and returns 0');
select is(public.fn_delete_ops_failures(array[]::bigint[]), 0, 'an empty array removes nothing');
select is(public.fn_delete_ops_failures(null), 0, 'a null array removes nothing');
reset role;

select * from finish();
rollback;
