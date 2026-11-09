-- Privileges a database rebuilt from migrations shares with the remote project
-- (odd/tasks/migration-history.md, L2). PUBLIC keeps EXECUTE on functions, so
-- has_function_privilege stays true for every role: these assertions read the
-- explicit ACL entries instead.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(10);

-- EXECUTE entries granted explicitly to p_role on p_function.
create function pg_temp.execute_entries(p_function regprocedure, p_role text) returns bigint
language sql as $$
  select count(*)
  from pg_proc p,
    aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = p_function
    and a.grantee = p_role::regrole
    and a.privilege_type = 'EXECUTE'
$$;

select is(
  (select count(*)
   from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'f'
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
     and a.privilege_type = 'EXECUTE'),
  0::bigint,
  'postgres default privileges in public grant no EXECUTE to anon or authenticated');

select is(
  pg_temp.execute_entries('public.fn_shipments_status_trigger()', 'anon')
    + pg_temp.execute_entries('public.fn_shipments_status_trigger()', 'authenticated'),
  0::bigint,
  'fn_shipments_status_trigger has no anon or authenticated EXECUTE entry');
select is(
  pg_temp.execute_entries('public.prevent_shipment_origin_snapshot_mutation()', 'anon')
    + pg_temp.execute_entries('public.prevent_shipment_origin_snapshot_mutation()', 'authenticated'),
  0::bigint,
  'prevent_shipment_origin_snapshot_mutation has no anon or authenticated EXECUTE entry');
select is(
  pg_temp.execute_entries('public.is_admin()', 'anon'),
  0::bigint,
  'is_admin has no anon EXECUTE entry');
select is(
  pg_temp.execute_entries('public.is_admin()', 'authenticated'),
  1::bigint,
  'is_admin keeps its authenticated EXECUTE entry');

-- A new function picks up the default privileges.
create function public.privilege_parity_probe() returns integer language sql as 'select 1';
select is(
  pg_temp.execute_entries('public.privilege_parity_probe()', 'anon')
    + pg_temp.execute_entries('public.privilege_parity_probe()', 'authenticated'),
  0::bigint,
  'a function postgres creates in public gets no anon or authenticated EXECUTE entry');

select ok(
  not has_table_privilege('service_role', 'public.connect_account_actionability', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has no privilege on connect_account_actionability');
select ok(
  not has_table_privilege('service_role', 'public.connect_account_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has no privilege on connect_account_events');
select ok(
  not has_table_privilege('service_role', 'public.connect_payout_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has no privilege on connect_payout_events');
select ok(
  not has_table_privilege('service_role', 'public.shipment_cancellation_operations', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has no privilege on shipment_cancellation_operations');

select * from finish();
rollback;
