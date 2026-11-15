-- Integrity constraints from roadmap #299 item 9 (odd/tasks/integrity-constraints.md):
-- each rule is a constraint, and a write that breaks it fails.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(80);
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

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000308001", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.profiles_private set role = 'admin' where id = auth.uid()$$,
  '42501', null, 'an ordinary user cannot make themselves an admin');
reset role;
select is(
  (select role::text from public.profiles_private where id = '00000000-0000-0000-0000-000000308001'),
  'user', 'the user role is unchanged after the attempt');

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
  $$select c from unnest(array['created_at', 'updated_at', 'shipping_cost_cents']) as c
    left join pg_attribute a on a.attrelid = 'public.shipments'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'shipments timestamps and shipping_cost_cents are NOT NULL');

select throws_ok(
  $$update public.shipments set shipping_cost_cents = null where id = pg_temp.mu(308111)$$,
  '23502', null, 'a NULL shipments.shipping_cost_cents is rejected');

select throws_ok(
  $$update public.shipments set shipping_cost_cents = -1 where id = pg_temp.mu(308111)$$,
  '23514', null, 'a negative shipments.shipping_cost_cents is rejected');

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

-- S4: the other tables. Rows reuse the money fixtures above plus one address,
-- notification, admin note, audit row, push delivery, category, DLQ row and
-- Connect account snapshot.
insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label)
values (pg_temp.mu(308130), pg_temp.mu(308102), 'Integrity Buyer', '5512345678', 'Calle 1',
        'CDMX', 'CMX', '06600', 'Casa');
insert into public.push_tokens (id, user_id, token, platform)
values (pg_temp.mu(308131), pg_temp.mu(308102), 'ExponentPushToken[integrity-308]', 'ios');
insert into public.notifications (id, user_id, type, title, message)
values (pg_temp.mu(308132), pg_temp.mu(308102), 'info', 'Integrity', 'Integrity notice');
insert into public.push_deliveries (notification_id, push_token_id, user_id, channel)
values (pg_temp.mu(308132), pg_temp.mu(308131), pg_temp.mu(308102), 'orders')
on conflict (notification_id, push_token_id) do nothing;
insert into public.admin_user_notes (id, user_id, admin_id, content)
values (pg_temp.mu(308133), pg_temp.mu(308101), pg_temp.mu(308103), 'Integrity note');
insert into public.admin_audit_logs (id, admin_id, action_type, target_id)
values (pg_temp.mu(308134), pg_temp.mu(308103), 'INTEGRITY_PROBE', pg_temp.mu(308101));
insert into public.category_configurations (category_name, sell_fields, filter_fields)
values ('integrity_308', '[]'::jsonb, '[]'::jsonb);
insert into public.webhook_dlq (id, event_type, payload, error_message)
values (pg_temp.mu(308135), 'integrity.probe', '{}'::jsonb, 'integrity probe');
insert into internal.connect_account_actionability (stripe_account_id, is_actionable, stripe_created)
values ('acct_integrity_308', true, now());

-- profiles
select is_empty(
  $$select c from unnest(array['is_verified_seller', 'updated_at', 'average_rating',
      'total_reviews', 'total_sales']) as c
    left join pg_attribute a on a.attrelid = 'public.profiles'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'profiles flags, counters and updated_at are NOT NULL');

select throws_ok(
  $$update public.profiles set is_verified_seller = null where id = pg_temp.mu(308101)$$,
  '23502', null, 'a NULL profiles.is_verified_seller is rejected');

select throws_ok(
  $$update public.profiles set average_rating = 5.1 where id = pg_temp.mu(308101)$$,
  '23514', null, 'a profiles.average_rating above 5 is rejected');

select throws_ok(
  $$update public.profiles set total_reviews = -1 where id = pg_temp.mu(308101)$$,
  '23514', null, 'a negative profiles.total_reviews is rejected');

select throws_ok(
  $$update public.profiles set total_sales = -1 where id = pg_temp.mu(308101)$$,
  '23514', null, 'a negative profiles.total_sales is rejected');

-- products
select is_empty(
  $$select c from unnest(array['updated_at', 'views', 'aspect_ratio']) as c
    left join pg_attribute a on a.attrelid = 'public.products'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'products updated_at, views and aspect_ratio are NOT NULL');

select throws_ok(
  $$update public.products set updated_at = null where id = pg_temp.mu(308111)$$,
  '23502', null, 'a NULL products.updated_at is rejected');

select throws_ok(
  $$update public.products set views = -1 where id = pg_temp.mu(308111)$$,
  '23514', null, 'a negative products.views is rejected');

select throws_ok(
  $$update public.products set aspect_ratio = 0 where id = pg_temp.mu(308111)$$,
  '23514', null, 'a zero products.aspect_ratio is rejected');

select throws_ok(
  $$update public.products set origin_zip = '6600' where id = pg_temp.mu(308111)$$,
  '23514', null, 'a products.origin_zip that is not five digits is rejected');

-- addresses
select is_empty(
  $$select c from unnest(array['is_default', 'zip_code', 'country']) as c
    left join pg_attribute a on a.attrelid = 'public.addresses'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'addresses is_default, zip_code and country are NOT NULL');

select throws_ok(
  $$update public.addresses set is_default = null where id = pg_temp.mu(308130)$$,
  '23502', null, 'a NULL addresses.is_default is rejected');

select throws_ok(
  $$update public.addresses set zip_code = '0660A' where id = pg_temp.mu(308130)$$,
  '23514', null, 'an addresses.zip_code that is not five digits is rejected');

select throws_ok(
  $$update public.addresses set zip_code = '' where id = pg_temp.mu(308130)$$,
  '23514', null, 'an empty addresses.zip_code on a live address is rejected');

select throws_ok(
  $$update public.addresses set country = 'US' where id = pg_temp.mu(308130)$$,
  '23514', null, 'an addresses.country other than MX is rejected');

select lives_ok(
  $$update public.addresses set zip_code = '', deleted_at = now() where id = pg_temp.mu(308130)$$,
  'a deleted address may hold the empty zip_code that account closure scrubs it to');

-- notifications
select is_empty(
  $$select c from unnest(array['read', 'type']) as c
    left join pg_attribute a on a.attrelid = 'public.notifications'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'notifications read and type are NOT NULL');

select throws_ok(
  $$update public.notifications set read = null where id = pg_temp.mu(308132)$$,
  '23502', null, 'a NULL notifications.read is rejected');

select throws_ok(
  $$insert into public.notifications (user_id, title) values (pg_temp.mu(308102), 'No type')$$,
  '23502', null, 'a notification without a type is rejected');

-- admin_user_notes
select is_empty(
  $$select c from unnest(array['user_id', 'admin_id', 'created_at']) as c
    left join pg_attribute a on a.attrelid = 'public.admin_user_notes'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'admin_user_notes user_id, admin_id and created_at are NOT NULL');

select throws_ok(
  $$update public.admin_user_notes set admin_id = null where id = pg_temp.mu(308133)$$,
  '23502', null, 'an admin note without an admin is rejected');

-- admin_audit_logs
select is_empty(
  $$select c from unnest(array['admin_id', 'created_at']) as c
    left join pg_attribute a on a.attrelid = 'public.admin_audit_logs'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'admin_audit_logs admin_id and created_at are NOT NULL');

select throws_ok(
  $$update public.admin_audit_logs set admin_id = null where id = pg_temp.mu(308134)$$,
  '23502', null, 'an audit row without an admin is rejected');

-- push_deliveries
select throws_ok(
  $$update public.push_deliveries set attempts = -1 where notification_id = pg_temp.mu(308132)$$,
  '23514', null, 'a negative push_deliveries.attempts is rejected');

-- category_configurations
select is_empty(
  $$select c from unnest(array['updated_at']) as c
    left join pg_attribute a on a.attrelid = 'public.category_configurations'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'category_configurations.updated_at is NOT NULL');

select throws_ok(
  $$update public.category_configurations set updated_at = null where category_name = 'integrity_308'$$,
  '23502', null, 'a NULL category_configurations.updated_at is rejected');

-- webhook_dlq
select is_empty(
  $$select c from unnest(array['event_type', 'resolved', 'created_at']) as c
    left join pg_attribute a on a.attrelid = 'public.webhook_dlq'::regclass and a.attname = c
    where a.attnotnull is not true$$,
  'webhook_dlq event_type, resolved and created_at are NOT NULL');

select throws_ok(
  $$update public.webhook_dlq set resolved = null where id = pg_temp.mu(308135)$$,
  '23502', null, 'a NULL webhook_dlq.resolved is rejected');

-- internal.connect_account_actionability
select throws_ok(
  $$update internal.connect_account_actionability set current_mxn_default_count = -1
    where stripe_account_id = 'acct_integrity_308'$$,
  '23514', null, 'a negative connect_account_actionability.current_mxn_default_count is rejected');

-- S5: one default live address per user. Buyer 308102 already holds a deleted
-- address (308130); seller 308101 gets its own default.
insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label, is_default)
values (pg_temp.mu(308150), pg_temp.mu(308102), 'Integrity Buyer', '5512345678', 'Calle 2',
        'CDMX', 'CMX', '06600', 'Casa', true);

select throws_ok(
  $$insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label, is_default)
    values (pg_temp.mu(308151), pg_temp.mu(308102), 'Integrity Buyer', '5512345678', 'Calle 3',
            'CDMX', 'CMX', '06600', 'Oficina', true)$$,
  '23505', null, 'a second default live address for the same user is rejected');

select lives_ok(
  $$insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label, is_default)
    values (pg_temp.mu(308152), pg_temp.mu(308101), 'Integrity Seller', '5512345678', 'Calle 4',
            'CDMX', 'CMX', '06600', 'Casa', true)$$,
  'another user may hold their own default address');

select lives_ok(
  $$insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label, is_default, deleted_at)
    values (pg_temp.mu(308153), pg_temp.mu(308102), 'Integrity Buyer', '5512345678', 'Calle 5',
            'CDMX', 'CMX', '06600', 'Vieja', true, now())$$,
  'a deleted address may keep is_default next to the live default');

-- S5: one review per shipment. Buyer 308102 reviews shipment 308111 (listing
-- 308111) of seller 308101; shipment 308141 is a repeat purchase from the same seller.
select pg_temp.money_shipment(308140, 308141, 308101, 308102);
insert into public.reviews (reviewer_id, seller_id, product_id, rating, order_id, shipment_id)
values (pg_temp.mu(308102), pg_temp.mu(308101), pg_temp.mu(308111), 5, pg_temp.mu(308110), pg_temp.mu(308111));

select throws_ok(
  $$insert into public.reviews (reviewer_id, seller_id, rating, order_id, shipment_id)
    values (pg_temp.mu(308102), pg_temp.mu(308101), 4, pg_temp.mu(308110), pg_temp.mu(308111))$$,
  '23505', null, 'a second review by the same reviewer for the same shipment is rejected');

select lives_ok(
  $$insert into public.reviews (reviewer_id, seller_id, product_id, rating, order_id, shipment_id)
    values (pg_temp.mu(308102), pg_temp.mu(308101), pg_temp.mu(308111), 4, pg_temp.mu(308140), pg_temp.mu(308141))$$,
  'the same reviewer may review the same product bought again in another shipment');

select throws_ok(
  $$insert into public.reviews (reviewer_id, seller_id, rating, order_id, shipment_id)
    values (pg_temp.mu(308102), pg_temp.mu(308101), 3, pg_temp.mu(308140), null)$$,
  '23502', null, 'a review without a shipment is rejected');

select is(
  (select array_agg(conname::text order by conname) from pg_constraint
    where conrelid = 'public.reviews'::regclass and contype = 'u'),
  array['reviews_reviewer_id_shipment_id_key'],
  'reviews has one unique key, (reviewer_id, shipment_id)');

-- S5: webhook deliveries are idempotent per provider delivery.
select col_is_unique('internal', 'webhook_deliveries', array['provider', 'delivery_id'],
  'internal.webhook_deliveries is unique on (provider, delivery_id)');

select * from finish();
rollback;
