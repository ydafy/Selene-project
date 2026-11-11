-- The exact client grant contract for schema public (#305, option A in
-- odd/tasks/explicit-role-grants.md): every privilege anon and authenticated
-- hold on a table, view, materialized view or sequence, and on a column, is
-- listed here, and nothing else is allowed. A new relation that grants a client
-- role anything must add its rows here; one that grants nothing needs no row.
-- RLS stays the row control; these grants are the object control.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(2);

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
      ('anon', 'system_settings', 'SELECT'),
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
      ('authenticated', 'system_logs', 'INSERT'),
      ('authenticated', 'system_settings', 'SELECT')
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
      ('authenticated', 'notifications', 'deleted_at', 'UPDATE'),
      ('authenticated', 'notifications', 'read', 'UPDATE'),
      ('authenticated', 'profiles', 'avatar_url', 'UPDATE'),
      ('authenticated', 'profiles', 'updated_at', 'UPDATE'),
      ('authenticated', 'profiles', 'username', 'UPDATE')
    ) as m(role_name, rel, col, privilege)
    order by 1, 2, 3, 4$$,
  'anon and authenticated hold exactly the client column grants in public');

select * from finish();
rollback;
