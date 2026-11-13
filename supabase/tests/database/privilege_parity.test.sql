-- Privileges a database rebuilt from migrations shares with the remote project
-- (odd/tasks/migration-history.md, L2). These assertions read the explicit ACL
-- entries; function_grants.test.sql holds the full client EXECUTE contract.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(16);

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
-- Storage and table policies TO public call it, so anon is granted explicitly
-- now that PUBLIC no longer holds EXECUTE (#305).
select is(
  pg_temp.execute_entries('public.is_admin()', 'anon'),
  1::bigint,
  'is_admin has an anon EXECUTE entry');
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

-- Tables and sequences: clients get only the grants each object's schema file
-- states (#305); the default privileges give them nothing.
select is(
  (select count(*)
   from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype in ('r', 'S')
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole)),
  0::bigint,
  'postgres default privileges in public grant nothing on tables or sequences to anon or authenticated');

create table public.privilege_parity_probe_table (id bigint generated always as identity primary key);
select ok(
  not has_table_privilege('anon', 'public.privilege_parity_probe_table',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
  'a table postgres creates in public gives anon no privilege');
select ok(
  not has_table_privilege('authenticated', 'public.privilege_parity_probe_table',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
  'a table postgres creates in public gives authenticated no privilege');
select ok(
  not has_sequence_privilege('anon', 'public.privilege_parity_probe_table_id_seq', 'SELECT,UPDATE,USAGE')
    and not has_sequence_privilege('authenticated', 'public.privilege_parity_probe_table_id_seq', 'SELECT,UPDATE,USAGE'),
  'a sequence postgres creates in public gives anon and authenticated no privilege');

-- The server keeps its defaults: Edge Functions use service_role.
select ok(
  has_table_privilege('service_role', 'public.privilege_parity_probe_table', 'SELECT')
    and has_table_privilege('service_role', 'public.privilege_parity_probe_table', 'INSERT')
    and has_table_privilege('service_role', 'public.privilege_parity_probe_table', 'UPDATE')
    and has_table_privilege('service_role', 'public.privilege_parity_probe_table', 'DELETE'),
  'a table postgres creates in public keeps service_role privileges');
select ok(
  has_sequence_privilege('service_role', 'public.privilege_parity_probe_table_id_seq', 'USAGE'),
  'a sequence postgres creates in public keeps service_role USAGE');

select ok(
  not has_table_privilege('service_role', 'internal.connect_account_actionability', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has no privilege on connect_account_actionability');
select ok(
  not has_table_privilege('service_role', 'internal.connect_account_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has no privilege on connect_account_events');
select ok(
  not has_table_privilege('service_role', 'internal.connect_payout_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has no privilege on connect_payout_events');
select ok(
  not has_table_privilege('service_role', 'public.shipment_cancellation_operations', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has no privilege on shipment_cancellation_operations');

select * from finish();
rollback;
