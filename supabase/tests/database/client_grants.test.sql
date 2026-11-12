-- The exact client grant contract for schema public (#305, option A in
-- odd/tasks/explicit-role-grants.md): every privilege anon and authenticated
-- hold on a table, view, materialized view or sequence, and on a column, is
-- listed here, and nothing else is allowed. A new relation that grants a client
-- role anything must add its rows here; one that grants nothing needs no row.
-- RLS stays the row control; these grants are the object control.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(6);

select results_eq(
  $$select distinct r.rolname::text collate "default",
      c.relname::text collate "default",
      a.privilege_type::text collate "default"
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and r.rolname in ('anon', 'authenticated')
    order by 1, 2, 3$$,
  $$select role_name collate "default", rel collate "default", privilege collate "default"
    from (values
      ('anon', 'category_configurations', 'SELECT'),
      -- fn_get_location_by_zip is SECURITY INVOKER and reads mexico_zips; a
      -- guest reaches the address form from the home location picker.
      ('anon', 'mexico_zips', 'SELECT'),
      ('anon', 'products_public', 'SELECT'),
      ('anon', 'profiles', 'SELECT'),
      ('anon', 'reviews', 'SELECT'),
      ('authenticated', 'addresses', 'INSERT'),
      ('authenticated', 'addresses', 'SELECT'),
      ('authenticated', 'addresses', 'UPDATE'),
      ('authenticated', 'admin_audit_logs', 'SELECT'),
      ('authenticated', 'admin_disputes_monitor_view', 'SELECT'),
      ('authenticated', 'admin_product_queue_view', 'SELECT'),
      ('authenticated', 'admin_user_directory_view', 'SELECT'),
      ('authenticated', 'admin_user_notes', 'INSERT'),
      ('authenticated', 'admin_user_notes', 'SELECT'),
      ('authenticated', 'blocked_users', 'INSERT'),
      ('authenticated', 'category_configurations', 'SELECT'),
      ('authenticated', 'disputes', 'SELECT'),
      ('authenticated', 'favorites', 'DELETE'),
      ('authenticated', 'favorites', 'INSERT'),
      ('authenticated', 'favorites', 'SELECT'),
      ('authenticated', 'mexico_zips', 'SELECT'),
      ('authenticated', 'notifications', 'SELECT'),
      ('authenticated', 'order_items', 'SELECT'),
      ('authenticated', 'orders', 'SELECT'),
      ('authenticated', 'products', 'INSERT'),
      ('authenticated', 'products', 'SELECT'),
      ('authenticated', 'products', 'UPDATE'),
      ('authenticated', 'products_public', 'SELECT'),
      ('authenticated', 'profiles', 'SELECT'),
      ('authenticated', 'profiles_private', 'SELECT'),
      ('authenticated', 'reports', 'INSERT'),
      ('authenticated', 'reports', 'SELECT'),
      ('authenticated', 'reviews', 'INSERT'),
      ('authenticated', 'reviews', 'SELECT'),
      ('authenticated', 'seller_trust_stats', 'SELECT'),
      ('authenticated', 'shipment_tracking_events', 'SELECT'),
      ('authenticated', 'shipments', 'SELECT'),
      ('authenticated', 'system_logs', 'INSERT')
    ) as m(role_name, rel, privilege)
    order by 1, 2, 3$$,
  'anon and authenticated hold exactly the client grant matrix on public relations and sequences');

select results_eq(
  $$select distinct r.rolname::text collate "default",
      c.relname::text collate "default",
      att.attname::text collate "default",
      a.privilege_type::text collate "default"
    from pg_class c
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral aclexplode(att.attacl) a
    join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace
      and r.rolname in ('anon', 'authenticated')
    order by 1, 2, 3, 4$$,
  $$select role_name collate "default", rel collate "default", col collate "default",
      privilege collate "default"
    from (values
      -- system_settings: only the columns useSystemConfig and the publish flow
      -- select (id is the filter). One cached query serves the guest guard and
      -- signed-in screens, so anon gets the same list (#305, #309).
      ('anon', 'system_settings', 'id', 'SELECT'),
      ('anon', 'system_settings', 'insurance_rate', 'SELECT'),
      ('anon', 'system_settings', 'is_maintenance', 'SELECT'),
      ('anon', 'system_settings', 'min_version_android', 'SELECT'),
      ('anon', 'system_settings', 'min_version_ios', 'SELECT'),
      ('anon', 'system_settings', 'order_expiration_hours', 'SELECT'),
      ('anon', 'system_settings', 'package_presets', 'SELECT'),
      ('anon', 'system_settings', 'preparing_expiration_hours', 'SELECT'),
      ('anon', 'system_settings', 'service_fee_pct', 'SELECT'),
      ('anon', 'system_settings', 'shipping_buffer_cents', 'SELECT'),
      ('authenticated', 'notifications', 'deleted_at', 'UPDATE'),
      ('authenticated', 'notifications', 'read', 'UPDATE'),
      ('authenticated', 'profiles', 'avatar_url', 'UPDATE'),
      ('authenticated', 'profiles', 'updated_at', 'UPDATE'),
      ('authenticated', 'profiles', 'username', 'UPDATE'),
      ('authenticated', 'system_settings', 'id', 'SELECT'),
      ('authenticated', 'system_settings', 'insurance_rate', 'SELECT'),
      ('authenticated', 'system_settings', 'is_maintenance', 'SELECT'),
      ('authenticated', 'system_settings', 'min_version_android', 'SELECT'),
      ('authenticated', 'system_settings', 'min_version_ios', 'SELECT'),
      ('authenticated', 'system_settings', 'order_expiration_hours', 'SELECT'),
      ('authenticated', 'system_settings', 'package_presets', 'SELECT'),
      ('authenticated', 'system_settings', 'preparing_expiration_hours', 'SELECT'),
      ('authenticated', 'system_settings', 'service_fee_pct', 'SELECT'),
      ('authenticated', 'system_settings', 'shipping_buffer_cents', 'SELECT')
    ) as m(role_name, rel, col, privilege)
    order by 1, 2, 3, 4$$,
  'anon and authenticated hold exactly the client column grants in public');

-- Clients read only the system_settings columns above: not the Envia
-- reference address.
set local role anon;
select throws_ok(
  $$select listing_quote_reference_destination from public.system_settings$$,
  '42501', null, 'anon cannot read system_settings.listing_quote_reference_destination');
select lives_ok(
  $$select id, is_maintenance, min_version_android, min_version_ios, service_fee_pct,
      insurance_rate, shipping_buffer_cents, package_presets, order_expiration_hours,
      preparing_expiration_hours
    from public.system_settings where id = 1$$,
  'anon reads the system_settings columns the app selects');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000305", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select listing_quote_reference_destination from public.system_settings$$,
  '42501', null, 'authenticated cannot read system_settings.listing_quote_reference_destination');
select lives_ok(
  $$select id, is_maintenance, min_version_android, min_version_ios, service_fee_pct,
      insurance_rate, shipping_buffer_cents, package_presets, order_expiration_hours,
      preparing_expiration_hours
    from public.system_settings where id = 1$$,
  'authenticated reads the system_settings columns the app selects');
reset role;

select * from finish();
rollback;
