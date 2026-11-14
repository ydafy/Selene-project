-- Integrity constraints from roadmap #299 item 9 (odd/tasks/integrity-constraints.md):
-- each rule is a constraint, and a write that breaks it fails.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-000000308001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'integrity-308-1@selene.local');

-- S2: profiles_private.role is the admin trust boundary.
select col_type_is('public', 'profiles_private', 'role', 'user_role',
  'profiles_private.role is the user_role enum');

select enum_has_labels('public', 'user_role', array['user', 'admin'],
  'user_role holds exactly user and admin');

select is(
  (select role::text from public.profiles_private where id = '00000000-0000-0000-0000-000000308001'),
  'user', 'a new account gets the user role');

select throws_ok(
  $$update public.profiles_private set role = 'superadmin'
    where id = '00000000-0000-0000-0000-000000308001'$$,
  '22P02', null, 'a role outside user_role is rejected');

select throws_ok(
  $$update public.profiles_private set role = null
    where id = '00000000-0000-0000-0000-000000308001'$$,
  '23502', null, 'a NULL role is rejected');

select throws_ok(
  $$update public.profiles_private set status = null
    where id = '00000000-0000-0000-0000-000000308001'$$,
  '23502', null, 'a NULL account status is rejected');

select throws_ok(
  $$update public.profiles_private set stripe_onboarding_status = null
    where id = '00000000-0000-0000-0000-000000308001'$$,
  '23502', null, 'a NULL onboarding status is rejected');

select throws_ok(
  $$update public.profiles_private set updated_at = null
    where id = '00000000-0000-0000-0000-000000308001'$$,
  '23502', null, 'a NULL profiles_private.updated_at is rejected');

update public.profiles_private set role = 'admin' where id = '00000000-0000-0000-0000-000000308001';
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000308001", "role": "authenticated"}', true);
set local role authenticated;
select ok(public.is_admin(), 'an active account with the admin role is still an admin');
reset role;

select * from finish();
rollback;
