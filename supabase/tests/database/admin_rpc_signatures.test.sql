-- The admin account RPCs take no admin id argument (#308, S9 in
-- odd/tasks/integrity-constraints.md): the actor is always the session user
-- that is_admin() checks, so the contract does not suggest the client chooses
-- the admin. Pins the signatures, the definer settings and grants, and proves
-- an admin call records the session admin while a non-admin is refused.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(22);

select has_function('public', 'fn_admin_toggle_verified_seller', array['uuid', 'boolean'],
  'fn_admin_toggle_verified_seller(p_target_user_id, p_is_verified) exists');
select hasnt_function('public', 'fn_admin_toggle_verified_seller', array['uuid', 'uuid', 'boolean'],
  'fn_admin_toggle_verified_seller no longer takes p_admin_id');
select has_function('public', 'fn_admin_update_user_status', array['uuid', 'account_status', 'text'],
  'fn_admin_update_user_status(p_target_user_id, p_new_status, p_reason) exists');
select hasnt_function('public', 'fn_admin_update_user_status', array['uuid', 'uuid', 'account_status', 'text'],
  'fn_admin_update_user_status no longer takes p_admin_id');

select is_definer('public', 'fn_admin_toggle_verified_seller', array['uuid', 'boolean'],
  'fn_admin_toggle_verified_seller stays SECURITY DEFINER');
select is_definer('public', 'fn_admin_update_user_status', array['uuid', 'account_status', 'text'],
  'fn_admin_update_user_status stays SECURITY DEFINER');
select is(
  (select string_agg(p.proname || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_admin_toggle_verified_seller', 'fn_admin_update_user_status')),
  'fn_admin_toggle_verified_seller:search_path=public, pg_temp fn_admin_update_user_status:search_path=public, pg_temp',
  'both keep search_path public, pg_temp');

select function_privs_are('public', 'fn_admin_toggle_verified_seller', array['uuid', 'boolean'],
  'authenticated', array['EXECUTE'], 'authenticated executes fn_admin_toggle_verified_seller');
select function_privs_are('public', 'fn_admin_toggle_verified_seller', array['uuid', 'boolean'],
  'service_role', array['EXECUTE'], 'service_role executes fn_admin_toggle_verified_seller');
select function_privs_are('public', 'fn_admin_toggle_verified_seller', array['uuid', 'boolean'],
  'anon', array[]::text[], 'anon cannot execute fn_admin_toggle_verified_seller');
select function_privs_are('public', 'fn_admin_update_user_status', array['uuid', 'account_status', 'text'],
  'authenticated', array['EXECUTE'], 'authenticated executes fn_admin_update_user_status');
select function_privs_are('public', 'fn_admin_update_user_status', array['uuid', 'account_status', 'text'],
  'service_role', array['EXECUTE'], 'service_role executes fn_admin_update_user_status');
select function_privs_are('public', 'fn_admin_update_user_status', array['uuid', 'account_status', 'text'],
  'anon', array[]::text[], 'anon cannot execute fn_admin_update_user_status');

-- 01 admin, 02 target seller, 03 ordinary user.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('a8000000-0000-4000-8000-000000000001'::uuid, 'sig_admin@test.local', 'sig_admin'),
  ('a8000000-0000-4000-8000-000000000002'::uuid, 'sig_target@test.local', 'sig_target'),
  ('a8000000-0000-4000-8000-000000000003'::uuid, 'sig_user@test.local', 'sig_user')
) as u(id, email, username);
update public.profiles_private set role = 'admin'
where id = 'a8000000-0000-4000-8000-000000000001';

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

-- A non-admin is refused through the new signatures and changes nothing.
select pg_temp.as_user('a8000000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  public.fn_admin_toggle_verified_seller('a8000000-0000-4000-8000-000000000002', true),
  false, 'a non-admin cannot toggle the verified seller badge');
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'a8000000-0000-4000-8000-000000000002', 'suspended', 'x')$$,
  'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'a non-admin cannot change a status');
reset role;
select is(
  (select p.is_verified_seller::text || ':' || pp.status::text
   from public.profiles p join public.profiles_private pp on pp.id = p.id
   where p.id = 'a8000000-0000-4000-8000-000000000002'),
  'false:active', 'the refused calls left the target unverified and active');

-- An admin calls both through the new signatures; the session admin is recorded.
select pg_temp.as_user('a8000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  public.fn_admin_toggle_verified_seller('a8000000-0000-4000-8000-000000000002', true),
  true, 'an admin toggles the verified seller badge');
select is(
  public.fn_admin_update_user_status('a8000000-0000-4000-8000-000000000002', 'suspended', 'review'),
  true, 'an admin suspends the account');
reset role;
select is(
  (select p.is_verified_seller::text || ':' || pp.status::text || ':' || pp.status_reason
   from public.profiles p join public.profiles_private pp on pp.id = p.id
   where p.id = 'a8000000-0000-4000-8000-000000000002'),
  'true:suspended:review', 'the target is verified and suspended with the reason');
select is(
  (select status_updated_by from public.profiles_private
   where id = 'a8000000-0000-4000-8000-000000000002'),
  'a8000000-0000-4000-8000-000000000001', 'the status change records the session admin');
select is(
  (select string_agg(right(admin_id::text, 2) || ':' || action_type, ',' order by action_type)
   from public.admin_audit_logs where target_id = 'a8000000-0000-4000-8000-000000000002'),
  '01:USER_STATUS_UPDATE,01:USER_VERIFICATION_TOGGLE',
  'both changes are audited with the session admin');

-- anon cannot reach either RPC.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'a8000000-0000-4000-8000-000000000002', 'active', 'x')$$,
  '42501', null, 'anon cannot execute the status RPC');
reset role;

select * from finish();
rollback;
