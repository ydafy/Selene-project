-- Grants on profiles, profiles_private and the server-only tables (T9g, #88).
-- profiles_private has a SELECT-only policy and broad table grants locally (see
-- #122), so client writes are stopped by RLS: updates and deletes touch no row.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(64);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'grants-a@test.local', '', now(),
  '{}'::jsonb, '{"username": "grants_user_a"}'::jsonb, now(), now(), '', '', '', ''
);

-- authenticated user A: own profile -----------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update public.profiles set username = 'grants_renamed', avatar_url = 'https://example.test/a.png'
    where id = 'd0000000-0000-4000-8000-000000000001'$$,
  'authenticated can update their own username and avatar_url');
select throws_ok(
  $$update public.profiles set is_verified_seller = true
    where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot update is_verified_seller');
select throws_ok(
  $$update public.profiles set deleted_at = now()
    where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot update deleted_at');
select lives_ok(
  $$update public.profiles_private set role = 'admin', status = 'banned'
    where id = 'd0000000-0000-4000-8000-000000000001'$$,
  'authenticated update of profiles_private runs but RLS leaves no row to change');
select throws_ok(
  $$insert into public.profiles_private (id) values ('d0000000-0000-4000-8000-0000000000ff')$$,
  '42501', null, 'authenticated cannot insert into profiles_private');
select lives_ok(
  $$delete from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000001'$$,
  'authenticated delete from profiles_private runs but RLS leaves no row to delete');

reset role;
select is(
  (select username from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  'grants_renamed', 'the allowed username update was stored');
select is(
  (select avatar_url from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  'https://example.test/a.png', 'the allowed avatar_url update was stored');
select is(
  (select is_verified_seller from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  false, 'is_verified_seller is unchanged');
select is(
  (select role from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000001'),
  'user', 'profiles_private.role is unchanged after the authenticated write');
select is(
  (select status::text from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000001'),
  'active', 'profiles_private.status is unchanged after the authenticated write');
select ok(
  exists (select 1 from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000001'),
  'the profiles_private row survives the authenticated delete');

-- anon ----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

select throws_ok(
  $$update public.profiles set username = 'anon_rename'
    where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'anon cannot update profiles.username');
select throws_ok(
  $$update public.profiles set avatar_url = 'https://example.test/x.png'
    where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'anon cannot update profiles.avatar_url');
select lives_ok(
  $$update public.profiles_private set role = 'admin'
    where id = 'd0000000-0000-4000-8000-000000000001'$$,
  'anon update of profiles_private runs but RLS leaves no row to change');
select throws_ok(
  $$insert into public.profiles_private (id) values ('d0000000-0000-4000-8000-0000000000ff')$$,
  '42501', null, 'anon cannot insert into profiles_private');

-- server-only tables and views: neither client role reads or writes them -----
select throws_ok(format('select 1 from public.%I', t), '42501', null, 'anon cannot read ' || t)
from unnest(array[
  'admin_connect_payout_release_view', 'checkout_recovery_shells',
  'connect_account_actionability', 'connect_account_events', 'connect_payout_events',
  'connect_payout_run_shipments', 'connect_payout_runs',
  'shipment_cancellation_operations', 'shipment_completion_events',
  'stripe_fee_reconciliation_jobs', 'webhook_deliveries'
]) as t;
select throws_ok(format('delete from public.%I', t), '42501', null, 'anon cannot delete from ' || t)
from unnest(array[
  'checkout_recovery_shells', 'connect_account_actionability', 'connect_account_events',
  'connect_payout_events', 'connect_payout_run_shipments', 'connect_payout_runs',
  'shipment_cancellation_operations', 'shipment_completion_events',
  'stripe_fee_reconciliation_jobs', 'webhook_deliveries'
]) as t;

select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(format('select 1 from public.%I', t), '42501', null, 'authenticated cannot read ' || t)
from unnest(array[
  'admin_connect_payout_release_view', 'admin_connect_earnings_view',
  'admin_seller_onboarding_view', 'checkout_recovery_shells',
  'connect_account_actionability', 'connect_account_events', 'connect_payout_events',
  'connect_payout_run_shipments', 'connect_payout_runs',
  'shipment_cancellation_operations', 'shipment_completion_events',
  'stripe_fee_reconciliation_jobs', 'webhook_deliveries'
]) as t;
select throws_ok(format('delete from public.%I', t), '42501', null, 'authenticated cannot delete from ' || t)
from unnest(array[
  'checkout_recovery_shells', 'connect_account_actionability', 'connect_account_events',
  'connect_payout_events', 'connect_payout_run_shipments', 'connect_payout_runs',
  'shipment_cancellation_operations', 'shipment_completion_events',
  'stripe_fee_reconciliation_jobs', 'webhook_deliveries'
]) as t;
select throws_ok(
  $$insert into public.notifications default values$$,
  '42501', null, 'authenticated cannot insert notifications');
select throws_ok(
  $$insert into public.shipment_tracking_events default values$$,
  '42501', null, 'authenticated cannot insert shipment_tracking_events');
select throws_ok(
  $$update public.notifications set title = 'x'$$,
  '42501', null, 'authenticated cannot update notifications.title');

reset role;
select is(
  (select role from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000001'),
  'user', 'profiles_private.role is unchanged after the anon write');
select * from finish();
rollback;
