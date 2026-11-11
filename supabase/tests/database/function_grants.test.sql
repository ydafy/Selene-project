-- Catalog-wide EXECUTE rules for SECURITY DEFINER functions in public and
-- internal (remaining-sql-pgtap S10). These are invariants, not each function's
-- grant list: a function may lose a grant freely, and #305 edits the
-- allowlists below when it redesigns grants. Each allowlist is sorted and names
-- why the entry is there. Functions are named as schema.name(argument types).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(5);

create temporary view definer_functions as
select p.oid,
  format('%s.%s(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature,
  p.proacl,
  p.proowner,
  p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'internal')
  and p.prosecdef
  and not exists (
    select 1 from pg_depend d
    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
  );

-- PUBLIC keeps EXECUTE on these three. PUBLIC includes anon, so they appear in
-- the anon allowlist too.
create temporary table public_allowlist (signature text primary key) on commit drop;
insert into public_allowlist values
  -- RLS policies on orders and order_items call it; no client role has USAGE
  -- on schema internal, so it is reachable only through those policies.
  ('internal.fn_check_order_access(uuid)'),
  -- Called by internal.fn_check_order_access; same reach.
  ('internal.is_admin()'),
  -- RLS policies that anon queries evaluate call it, so anon must execute it.
  ('public.is_admin()');

create temporary table anon_allowlist (signature text primary key) on commit drop;
insert into anon_allowlist values
  ('internal.fn_check_order_access(uuid)'), -- through PUBLIC, see above
  ('internal.is_admin()'), -- through PUBLIC, see above
  -- The public listing screen shows whether a seller can take payments
  -- before sign-in.
  ('public.fn_product_seller_payment_readiness(uuid[])'),
  -- A device unregisters its push token at sign-out, after the session ends.
  ('public.fn_unregister_push_token(text)'),
  ('public.is_admin()'); -- through PUBLIC, see above

-- Client RPCs and the helpers RLS policies call for signed-in users.
create temporary table authenticated_allowlist (signature text primary key) on commit drop;
insert into authenticated_allowlist values
  ('internal.fn_check_order_access(uuid)'), -- through PUBLIC
  ('internal.fn_check_order_access(uuid, uuid)'), -- orders and order_items RLS
  ('internal.is_admin()'), -- through PUBLIC
  ('public.fn_admin_restore_product(uuid)'),
  ('public.fn_admin_soft_delete_product(uuid, text)'),
  ('public.fn_admin_toggle_verified_seller(uuid, uuid, boolean)'),
  ('public.fn_admin_update_user_status(uuid, uuid, account_status, text)'),
  ('public.fn_current_account_is_active()'),
  ('public.fn_get_shipment_cancellation_summary(uuid)'),
  ('public.fn_lock_product(uuid)'),
  ('public.fn_product_seller_payment_readiness(uuid[])'),
  ('public.fn_register_push_token(text, text)'),
  ('public.fn_resolve_product_verdict(uuid, text, text, text)'),
  ('public.fn_seller_submit_return_evidence(uuid, text[], text)'),
  ('public.fn_unlock_product(uuid)'),
  ('public.fn_unregister_push_token(text)'),
  ('public.is_admin()');

select is_empty(
  $$select f.signature
    from definer_functions f,
      aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
    where a.grantee = 0
      and a.privilege_type = 'EXECUTE'
      and f.signature not in (select signature from public_allowlist)
    order by 1$$,
  'no SECURITY DEFINER function outside the allowlist has a PUBLIC EXECUTE entry');

select is_empty(
  $$select signature from definer_functions
    where has_function_privilege('anon', oid, 'EXECUTE')
      and signature not in (select signature from anon_allowlist)
    order by 1$$,
  'anon can execute no SECURITY DEFINER function outside the allowlist');

select is_empty(
  $$select signature from definer_functions
    where has_function_privilege('authenticated', oid, 'EXECUTE')
      and signature not in (select signature from authenticated_allowlist)
    order by 1$$,
  'authenticated can execute no SECURITY DEFINER function outside the allowlist');

select is_empty(
  $$select signature from definer_functions
    where not exists (
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
