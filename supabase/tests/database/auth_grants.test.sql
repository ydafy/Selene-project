-- Least-privilege grants on the auth tables and admin views (T10f, #122, L172).
-- The matrix is asserted per relation and role with has_table_privilege, then the
-- paths clients really use are exercised under each role. RLS stays the row
-- control; these grants only remove privileges nobody needs.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(44);

-- Exact table privileges per relation and role ---------------------------------
select is(
  (select coalesce(string_agg(p, ',' order by p), '')
   from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p
   where has_table_privilege(m.role_name, m.rel, p)),
  m.expected,
  m.role_name || ' holds exactly [' || m.expected || '] on ' || m.rel)
from (values
  ('anon', 'public.profiles', 'SELECT'),
  ('authenticated', 'public.profiles', 'SELECT'),
  ('anon', 'public.profiles_private', ''),
  ('authenticated', 'public.profiles_private', 'SELECT'),
  ('anon', 'public.admin_audit_logs', ''),
  ('authenticated', 'public.admin_audit_logs', 'SELECT'),
  ('anon', 'public.admin_user_notes', ''),
  ('authenticated', 'public.admin_user_notes', 'INSERT,SELECT'),
  ('anon', 'public.admin_user_directory_view', ''),
  ('authenticated', 'public.admin_user_directory_view', 'SELECT'),
  ('anon', 'public.admin_disputes_monitor_view', ''),
  ('authenticated', 'public.admin_disputes_monitor_view', 'SELECT'),
  ('anon', 'public.admin_product_queue_view', ''),
  ('authenticated', 'public.admin_product_queue_view', 'SELECT'),
  ('anon', 'public.admin_connect_earnings_view', ''),
  ('authenticated', 'public.admin_connect_earnings_view', ''),
  ('anon', 'public.admin_seller_onboarding_view', ''),
  ('authenticated', 'public.admin_seller_onboarding_view', ''),
  ('anon', 'public.admin_connect_payout_release_view', ''),
  ('authenticated', 'public.admin_connect_payout_release_view', ''),
  ('anon', 'public.account_closures', ''),
  ('authenticated', 'public.account_closures', '')
) as m(role_name, rel, expected);

-- profiles UPDATE is column-level -----------------------------------------------
select is(
  (select coalesce(string_agg(attname, ',' order by attname), '')
   from pg_attribute
   where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
     and has_column_privilege('authenticated', 'public.profiles', attname, 'UPDATE')),
  'avatar_url,updated_at,username',
  'authenticated may update only username, avatar_url and updated_at on profiles');
select is(
  (select count(*) from pg_attribute
   where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
     and has_column_privilege('anon', 'public.profiles', attname, 'UPDATE')),
  0::bigint,
  'anon may update no column of profiles');

-- Users and rows ----------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'grants-user@test.local', '', now(),
   '{}'::jsonb, '{"username": "grants_matrix_user"}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'grants-admin@test.local', '', now(),
   '{}'::jsonb, '{"username": "grants_matrix_admin"}'::jsonb, now(), now(), '', '', '', '');
update public.profiles_private set role = 'admin'
  where id = 'd1000000-0000-4000-8000-000000000002';
insert into public.admin_audit_logs (admin_id, action_type)
  values ('d1000000-0000-4000-8000-000000000002', 'grants_matrix_probe');

-- anon ----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

select lives_ok($$select id, username from public.profiles$$, 'anon can select from profiles');
select throws_ok($$select 1 from public.profiles_private$$, '42501', null,
  'anon cannot select from profiles_private');
select throws_ok($$select 1 from public.admin_user_directory_view$$, '42501', null,
  'anon cannot select from admin_user_directory_view');
select throws_ok($$select 1 from public.admin_disputes_monitor_view$$, '42501', null,
  'anon cannot select from admin_disputes_monitor_view');
select throws_ok($$select 1 from public.admin_connect_earnings_view$$, '42501', null,
  'anon cannot select from admin_connect_earnings_view');
select throws_ok($$select 1 from public.admin_seller_onboarding_view$$, '42501', null,
  'anon cannot select from admin_seller_onboarding_view');

-- authenticated, ordinary user ---------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "d1000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update public.profiles set username = 'grants_mx_renamed', avatar_url = 'https://example.test/m.png'
    where id = 'd1000000-0000-4000-8000-000000000001'$$,
  'authenticated can update their own username and avatar_url');
select is(
  (select count(*) from public.profiles_private where id = 'd1000000-0000-4000-8000-000000000001'),
  1::bigint, 'authenticated can select their own profiles_private row');
select is(
  (select count(*) from public.profiles_private where id <> 'd1000000-0000-4000-8000-000000000001'),
  0::bigint, 'authenticated does not see other users profiles_private rows');
select is((select count(*) from public.admin_audit_logs), 0::bigint,
  'RLS still hides admin_audit_logs rows from a non-admin');
select throws_ok(
  $$insert into public.profiles_private (id) values ('d1000000-0000-4000-8000-0000000000ff')$$,
  '42501', null, 'authenticated cannot insert into profiles_private');
select throws_ok(
  $$update public.profiles_private set role = 'admin' where id = 'd1000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot update profiles_private');
select throws_ok(
  $$delete from public.profiles_private where id = 'd1000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot delete from profiles_private');

reset role;
select is(
  (select username from public.profiles where id = 'd1000000-0000-4000-8000-000000000001'),
  'grants_mx_renamed', 'the allowed username update was stored');
select is(
  (select role from public.profiles_private where id = 'd1000000-0000-4000-8000-000000000001'),
  'user', 'profiles_private.role of the user is unchanged');

-- authenticated, admin --------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "d1000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;

select ok(
  exists (select 1 from public.admin_audit_logs where action_type = 'grants_matrix_probe'),
  'an admin can select admin_audit_logs');
select ok(
  exists (select 1 from public.admin_user_directory_view),
  'an admin can select admin_user_directory_view');
select lives_ok($$select 1 from public.admin_disputes_monitor_view$$,
  'an admin can select admin_disputes_monitor_view');
select lives_ok(
  $$insert into public.admin_user_notes (user_id, admin_id, content)
    values ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'matrix note')$$,
  'an admin can insert into admin_user_notes');
select ok(
  exists (select 1 from public.admin_user_notes where content = 'matrix note'),
  'an admin can select admin_user_notes');

reset role;
select * from finish();
rollback;
