-- The exact client EXECUTE contract for functions in public and internal
-- (#305, odd/tasks/explicit-role-grants.md T4). It covers every function that
-- is not part of an extension, SECURITY DEFINER and SECURITY INVOKER alike: no
-- function keeps EXECUTE for PUBLIC, and anon and authenticated execute exactly
-- the functions listed below. A new function a client calls, or that an RLS or
-- storage policy evaluated for a client role calls, adds its rows here; one
-- that grants nothing to clients needs no row. Functions are named as
-- schema.name(argument types).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(5);

create temporary view all_functions as
select p.oid,
  format('%s.%s(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature,
  p.proacl,
  p.proowner,
  p.proconfig,
  p.prosecdef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'internal')
  and not exists (
    select 1 from pg_depend d
    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
  );

create temporary table expected_grants (role_name text, signature text) on commit drop;
insert into expected_grants values
  -- A guest can open the address form from the home location picker; the ZIP
  -- lookup runs before the save asks for a session.
  ('anon', 'public.fn_get_location_by_zip(text)'),
  -- A guest adding a listing to the cart checks whether the seller can take
  -- payments.
  ('anon', 'public.fn_product_seller_payment_readiness(uuid[])'),
  -- A device retries a pending unregister after the session ended.
  ('anon', 'public.fn_unregister_push_token(text)'),
  -- The storage policy "Admins can view all avatars" is TO public, and table
  -- policies TO public call it.
  ('anon', 'public.is_admin()'),
  ('authenticated', 'internal.fn_check_order_access(uuid, uuid)'), -- orders and order_items RLS
  ('authenticated', 'public.fn_admin_restore_product(uuid)'),
  ('authenticated', 'public.fn_admin_soft_delete_product(uuid, text)'),
  ('authenticated', 'public.fn_admin_toggle_verified_seller(uuid, uuid, boolean)'),
  ('authenticated', 'public.fn_admin_update_user_status(uuid, uuid, account_status, text)'),
  ('authenticated', 'public.fn_current_account_is_active()'), -- RLS policies
  ('authenticated', 'public.fn_get_location_by_zip(text)'),
  ('authenticated', 'public.fn_get_shipment_cancellation_summary(uuid)'),
  ('authenticated', 'public.fn_lock_product(uuid)'),
  ('authenticated', 'public.fn_product_seller_payment_readiness(uuid[])'),
  ('authenticated', 'public.fn_register_push_token(text, text)'),
  ('authenticated', 'public.fn_resolve_product_verdict(uuid, text, text, text)'),
  ('authenticated', 'public.fn_seller_submit_return_evidence(uuid, text[], text)'),
  ('authenticated', 'public.fn_unlock_product(uuid)'),
  ('authenticated', 'public.fn_unregister_push_token(text)'),
  ('authenticated', 'public.is_admin()'); -- RLS and storage policies, admin views

select is_empty(
  $$select f.signature
    from all_functions f,
      aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
    where a.grantee = 0
      and a.privilege_type = 'EXECUTE'
    order by 1$$,
  'no function in public or internal has a PUBLIC EXECUTE entry');

select results_eq(
  $$select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end collate "default",
      f.signature collate "default"
    from all_functions f,
      aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
    where a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))
    order by 1, 2$$,
  $$select role_name collate "default", signature collate "default"
    from expected_grants order by 1, 2$$,
  'PUBLIC, anon and authenticated hold exactly the expected EXECUTE entries');

select results_eq(
  $$select r.role_name collate "default", f.signature collate "default"
    from all_functions f
    cross join (values ('anon'), ('authenticated')) as r(role_name)
    where has_function_privilege(r.role_name, f.oid, 'EXECUTE')
    order by 1, 2$$,
  $$select role_name collate "default", signature collate "default"
    from expected_grants order by 1, 2$$,
  'anon and authenticated can execute exactly the expected functions');

select is_empty(
  $$select signature from all_functions
    where prosecdef
      and not exists (
        select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%'
      )
    order by 1$$,
  'every SECURITY DEFINER function pins its search_path');

select ok(
  not has_schema_privilege('anon', 'internal', 'USAGE')
    and not has_schema_privilege('authenticated', 'internal', 'USAGE'),
  'anon and authenticated have no USAGE on schema internal');

select * from finish();
rollback;
