-- Integrity constraints from roadmap #299 item 9 (odd/tasks/integrity-constraints.md):
-- each rule is a constraint, and a write that breaks it fails.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(41);
\ir ../fixtures/money.psql

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

-- S3: money tables. Rows come from the money fixtures (seller 308101, buyer
-- 308102, admin 308103; order 308110 with shipment and listing 308111).
select pg_temp.money_user(308101);
select pg_temp.money_user(308102);
select pg_temp.money_user(308103, 'admin');
select pg_temp.money_shipment(308110, 308111, 308101, 308102);
select pg_temp.money_payout_run(308120, 308101, 308103, array[308111]);
insert into internal.checkout_recovery_shells (stripe_payment_intent_id, reason, charged_amount_cents)
values ('pi_integrity_308', 'test', 100000);

-- orders
select is_empty(
  $$select c from unnest(array['created_at', 'updated_at', 'currency']) as c
    left join pg_attribute a on a.attrelid = 'public.orders'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'orders timestamps and currency are NOT NULL');

select throws_ok(
  $$update public.orders set currency = null where id = pg_temp.mu(308110)$$,
  '23502', null, 'a NULL orders.currency is rejected');

select throws_ok(
  $$update public.orders set currency = 'USD' where id = pg_temp.mu(308110)$$,
  '23514', null, 'an orders.currency other than MXN is rejected');

select throws_ok(
  $$update public.orders set actual_stripe_fee_cents = -1 where id = pg_temp.mu(308110)$$,
  '23514', null, 'a negative orders.actual_stripe_fee_cents is rejected');

select throws_ok(
  $$update public.orders set cancellation_loss_cents = -1 where id = pg_temp.mu(308110)$$,
  '23514', null, 'a negative orders.cancellation_loss_cents is rejected');

select throws_ok(
  $$update public.orders set compensation_attempt_count = -1 where id = pg_temp.mu(308110)$$,
  '23514', null, 'a negative orders.compensation_attempt_count is rejected');

-- shipments
select is_empty(
  $$select c from unnest(array['created_at', 'updated_at', 'shipping_cost']) as c
    left join pg_attribute a on a.attrelid = 'public.shipments'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'shipments timestamps and shipping_cost are NOT NULL');

select throws_ok(
  $$update public.shipments set shipping_cost = null where id = pg_temp.mu(308111)$$,
  '23502', null, 'a NULL shipments.shipping_cost is rejected');

select throws_ok(
  $$update public.shipments set shipping_cost = -1 where id = pg_temp.mu(308111)$$,
  '23514', null, 'a negative shipments.shipping_cost is rejected');

-- order_items
select is_empty(
  $$select c from unnest(array['created_at', 'shipping_payer', 'shipment_id']) as c
    left join pg_attribute a on a.attrelid = 'public.order_items'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'order_items created_at, shipping_payer and shipment_id are NOT NULL');

select throws_ok(
  $$update public.order_items set shipment_id = null where shipment_id = pg_temp.mu(308111)$$,
  '23502', null, 'an order item without a shipment is rejected');

select throws_ok(
  $$update public.order_items set shipping_payer = 'platform' where shipment_id = pg_temp.mu(308111)$$,
  '23514', null, 'an order_items.shipping_payer outside buyer and seller is rejected');

-- products
select is_empty(
  $$select c from unnest(array['shipping_payer']) as c
    left join pg_attribute a on a.attrelid = 'public.products'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'products.shipping_payer is NOT NULL');

select throws_ok(
  $$update public.products set shipping_payer = null where id = pg_temp.mu(308111)$$,
  '23502', null, 'a NULL products.shipping_payer is rejected');

select throws_ok(
  $$update public.products set shipping_payer = 'platform' where id = pg_temp.mu(308111)$$,
  '23514', null, 'a products.shipping_payer outside buyer and seller is rejected');

-- connect_payout_runs
select throws_ok(
  $$update public.connect_payout_runs set attempt_count = -1 where id = pg_temp.mu(308120)$$,
  '23514', null, 'a negative connect_payout_runs.attempt_count is rejected');

select throws_ok(
  $$update public.connect_payout_runs set release_stage_version = 0 where id = pg_temp.mu(308120)$$,
  '23514', null, 'a connect_payout_runs.release_stage_version below 1 is rejected');

-- system_settings
select is_empty(
  $$select c from unnest(array[
      'is_maintenance', 'min_version_android', 'min_version_ios', 'service_fee_fixed_cents',
      'payout_fee_fixed_cents', 'currency', 'updated_at', 'shipping_buffer_cents',
      'package_presets', 'return_label_fee_cents', 'order_expiration_hours',
      'min_payout_amount_cents', 'preparing_expiration_hours', 'novice_completed_threshold',
      'novice_active_limit', 'trusted_active_limit']) as c
    left join pg_attribute a on a.attrelid = 'public.system_settings'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'every always-expected system_settings column is NOT NULL');

select throws_ok(
  $$update public.system_settings set order_expiration_hours = null where id = 1$$,
  '23502', null, 'a NULL system_settings.order_expiration_hours is rejected');

select throws_ok(
  $$update public.system_settings set service_fee_fixed_cents = -1 where id = 1$$,
  '23514', null, 'a negative system_settings.service_fee_fixed_cents is rejected');

select throws_ok(
  $$update public.system_settings set payout_fee_fixed_cents = -1 where id = 1$$,
  '23514', null, 'a negative system_settings.payout_fee_fixed_cents is rejected');

select throws_ok(
  $$update public.system_settings set shipping_buffer_cents = -1 where id = 1$$,
  '23514', null, 'a negative system_settings.shipping_buffer_cents is rejected');

select throws_ok(
  $$update public.system_settings set return_label_fee_cents = -1 where id = 1$$,
  '23514', null, 'a negative system_settings.return_label_fee_cents is rejected');

select throws_ok(
  $$update public.system_settings set min_payout_amount_cents = -1 where id = 1$$,
  '23514', null, 'a negative system_settings.min_payout_amount_cents is rejected');

select throws_ok(
  $$update public.system_settings set order_expiration_hours = 0 where id = 1$$,
  '23514', null, 'a zero system_settings.order_expiration_hours is rejected');

select throws_ok(
  $$update public.system_settings set preparing_expiration_hours = 0 where id = 1$$,
  '23514', null, 'a zero system_settings.preparing_expiration_hours is rejected');

select throws_ok(
  $$update public.system_settings set novice_completed_threshold = -1 where id = 1$$,
  '23514', null, 'a negative system_settings.novice_completed_threshold is rejected');

select throws_ok(
  $$update public.system_settings set novice_active_limit = -1, trusted_active_limit = 0 where id = 1$$,
  '23514', null, 'a negative system_settings.novice_active_limit is rejected');

select throws_ok(
  $$update public.system_settings set trusted_active_limit = novice_active_limit - 1 where id = 1$$,
  '23514', null, 'a trusted_active_limit below novice_active_limit is rejected');

select throws_ok(
  $$update public.system_settings set currency = 'USD' where id = 1$$,
  '23514', null, 'a system_settings.currency other than MXN is rejected');

-- internal.checkout_recovery_shells
select throws_ok(
  $$update internal.checkout_recovery_shells set compensation_attempt_count = -1
    where stripe_payment_intent_id = 'pi_integrity_308'$$,
  '23514', null, 'a negative checkout_recovery_shells.compensation_attempt_count is rejected');

select throws_ok(
  $$update internal.checkout_recovery_shells set charged_amount_cents = -1
    where stripe_payment_intent_id = 'pi_integrity_308'$$,
  '23514', null, 'a negative checkout_recovery_shells.charged_amount_cents is rejected');

select * from finish();
rollback;
