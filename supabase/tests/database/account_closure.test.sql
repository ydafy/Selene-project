-- fn_close_account: refusal changes nothing, closure anonymizes, and a stale
-- listing no longer blocks it (T5a, T9f, #69); the closure purges personal rows
-- and credentials but never touches the ledger (#277).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(51);
\ir ../fixtures/money.psql

-- Same economics formula as validate_product_publication_economics.
create function pg_temp.make_product(p_id uuid, p_seller uuid, p_status public.product_status_enum)
returns void language sql as $$
  insert into public.products (
    id, name, description, price, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost, origin_zip, package_preset,
    reserved_at, publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select p_id, 'Test GPU', 'Test listing', 1000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status, '{}'::jsonb, p_seller, 100, '06600', 'gpu_1',
    case when p_status = 'RESERVED' then now() end,
    round(100 * 100)::bigint + s.shipping_buffer_cents
      + ceil(round(1000 * 100)::numeric * internal.normalize_publication_rate(s.insurance_rate))::bigint,
    internal.normalize_publication_rate(s.service_fee_pct),
    internal.normalize_publication_rate(s.insurance_rate)
  from public.system_settings s where s.id = 1
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'blocked@test.local', 'closure_blocked'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'plain@test.local', 'closure_plain'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'stale@test.local', 'closure_stale'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, 'other@test.local', 'closure_other')
) as u(id, email, username);

-- 1 blocker: a reserved listing; 2 plain: a verified listing and a favorite.
select pg_temp.make_product('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000001', 'RESERVED');
select pg_temp.make_product('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-000000000002', 'VERIFIED');
insert into public.favorites (user_id, product_id)
values ('d0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-0000000000a2');

-- Only the service role may close an account ----------------------------------
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.fn_close_account('d0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated cannot execute fn_close_account');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$select public.fn_close_account('d0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon cannot execute fn_close_account');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

-- Refused while a blocker exists: nothing changes ------------------------------
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000001'::uuid))->>'status',
  'blocked', 'a reserved listing blocks the closure');
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000001'::uuid))->>'reason',
  'active_shipments', 'the blocked answer names the reason');
reset role;
select is(
  (select username from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  'closure_blocked', 'blocked: the username is unchanged');
select is(
  (select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  null, 'blocked: the profile is not soft-deleted');
select is(
  (select email from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000001'),
  'blocked@test.local', 'blocked: the private email is kept');
select is(
  (select status::text from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000001'),
  'active', 'blocked: the account status is unchanged');
select is(
  (select status::text from public.products where id = 'd0000000-0000-4000-8000-0000000000a1'),
  'RESERVED', 'blocked: the listing is unchanged');
select is(
  (select email from auth.users where id = 'd0000000-0000-4000-8000-000000000001'),
  'blocked@test.local', 'blocked: the auth email is kept');
select is(
  (select count(*) from public.account_closures where user_id = 'd0000000-0000-4000-8000-000000000001'),
  0::bigint, 'blocked: no closure is recorded');

-- Closes and anonymizes otherwise ----------------------------------------------
set local role service_role;
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000002'::uuid))->>'status',
  'closed', 'an account with no blocker closes');
reset role;
select matches(
  (select username from public.profiles where id = 'd0000000-0000-4000-8000-000000000002'),
  '^deleted_[0-9a-f]{12}$', 'closed: the username is anonymized');
select isnt(
  (select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000002'),
  null, 'closed: the profile is soft-deleted');
select is(
  (select email from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000002'),
  null, 'closed: the private email is removed');
select is(
  (select status::text from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000002'),
  'banned', 'closed: the account stays banned');
select is(
  (select email from auth.users where id = 'd0000000-0000-4000-8000-000000000002'),
  null, 'closed: the auth email is removed');
select ok(
  (select banned_until > now() + interval '100 years' from auth.users where id = 'd0000000-0000-4000-8000-000000000002'),
  'closed: the auth user is banned for good');
select is(
  (select count(*) from public.favorites where user_id = 'd0000000-0000-4000-8000-000000000002'),
  0::bigint, 'closed: favorites are deleted');
select is(
  (select status::text || ':' || (deleted_at is not null)::text from public.products where id = 'd0000000-0000-4000-8000-0000000000a2'),
  'HIDDEN:true', 'closed: the listing is hidden and soft-deleted');
select is(
  (select count(*) from public.account_closures where user_id = 'd0000000-0000-4000-8000-000000000002'),
  1::bigint, 'closed: the closure is recorded');
set local role service_role;
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000002'::uuid))->>'status',
  'already_closed', 'a second call is idempotent');
reset role;

-- A listing whose publication economics went stale no longer blocks it (#69) ---
select pg_temp.make_product('d0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-000000000003', 'VERIFIED');
update public.system_settings set shipping_buffer_cents = shipping_buffer_cents + 500 where id = 1;
set local role service_role;
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000003'::uuid))->>'status',
  'closed', 'a stale listing does not abort the closure');
reset role;
select is(
  (select status::text || ':' || (deleted_at is not null)::text from public.products where id = 'd0000000-0000-4000-8000-0000000000a3'),
  'HIDDEN:true', 'the stale listing is hidden and soft-deleted');

-- Purge: personal rows and credentials go, the ledger stays ---------------------
-- 41 closes; 42 is its counterparty (buyer of 51, seller of 53), 43 an admin,
-- 44 a bystander. Every row of 42 and 44 is a control that must survive.
select pg_temp.money_user(n) from generate_series(41, 44) as n;
update public.profiles_private set role = 'admin' where id = pg_temp.mu(43);
update public.profiles_private set stripe_customer_id = 'cus_t4_41' where id = pg_temp.mu(41);
update auth.users set phone = '5215500000041', encrypted_password = 'not-a-real-hash',
  raw_app_meta_data = '{"provider": "email"}'::jsonb
where id = pg_temp.mu(41);

select pg_temp.money_shipment(50, 51, 41, 42, 'completed', interval '5 days');
select pg_temp.money_shipment(52, 53, 42, 41, 'completed', interval '5 days');
select pg_temp.money_payout_run(60, 41, 43, array[51], 'paid', 'paid_observed');
update public.connect_payout_runs set paid_at = now() where id = pg_temp.mu(60);
select pg_temp.money_dispute(70, 53, 'resolved');
-- Opening the dispute moved order 52 to 'dispute'; the resolved dispute closes it.
update public.orders set status = 'completed' where id = pg_temp.mu(52);
insert into public.reviews (reviewer_id, seller_id, product_id, rating, comment, order_id, shipment_id) values
  (pg_temp.mu(41), pg_temp.mu(42), pg_temp.mu(53), 5, 'by the closing user', pg_temp.mu(52), pg_temp.mu(53)),
  (pg_temp.mu(42), pg_temp.mu(41), pg_temp.mu(51), 4, 'about the closing user', pg_temp.mu(50), pg_temp.mu(51));
insert into public.reports (reporter_id, target_id, target_type, reason)
values (pg_temp.mu(41), pg_temp.mu(42), 'user', 'test report');
insert into public.admin_audit_logs (admin_id, action_type, target_id, details)
values (pg_temp.mu(43), 'USER_STATUS_UPDATE', pg_temp.mu(41), '{"new_status": "active"}'::jsonb);

-- 81: an address shipment 51 ships from; 82: an unused address; 83: 42's address.
insert into public.addresses (id, user_id, full_name, phone, street_line1, street_line2, street_number,
  district, city, state, zip_code, latitude, longitude, is_default, instructions, label)
values
  (pg_temp.mu(81), pg_temp.mu(41), 'Closing Seller', '5500000041', 'Calle 1', 'Int 2', '10',
   'Centro', 'CDMX', 'CDMX', '06600', 19.4, -99.1, true, 'Ring twice', 'home'),
  (pg_temp.mu(82), pg_temp.mu(41), 'Closing Seller', '5500000041', 'Calle 2', null, null,
   null, 'CDMX', 'CDMX', '06600', null, null, false, null, 'work'),
  (pg_temp.mu(83), pg_temp.mu(42), 'Counterparty', '5500000042', 'Calle 3', null, null,
   null, 'CDMX', 'CDMX', '06600', null, null, true, null, 'home');
update public.shipments set origin_address_id = pg_temp.mu(81) where id = pg_temp.mu(51);

insert into public.payment_methods (user_id, stripe_payment_method_id, brand, last4, exp_month, exp_year) values
  (pg_temp.mu(41), 'pm_t4_41', 'visa', '4242', 12, 2030),
  (pg_temp.mu(42), 'pm_t4_42', 'visa', '4243', 12, 2030);
insert into public.blocked_users (blocker_id, blocked_id) values
  (pg_temp.mu(41), pg_temp.mu(42)), (pg_temp.mu(42), pg_temp.mu(41)), (pg_temp.mu(42), pg_temp.mu(44));
insert into public.notifications (user_id, title) values
  (pg_temp.mu(41), 'for the closing user'), (pg_temp.mu(42), 'for the counterparty');
insert into public.push_tokens (user_id, token, platform) values
  (pg_temp.mu(41), 'ExponentPushToken[t4-41]', 'ios'), (pg_temp.mu(42), 'ExponentPushToken[t4-42]', 'android');
insert into auth.identities (provider_id, user_id, identity_data, provider)
select pg_temp.mu(n)::text, pg_temp.mu(n), jsonb_build_object('sub', pg_temp.mu(n)), 'email'
from unnest(array[41, 42]) as n;
insert into auth.sessions (id, user_id)
select pg_temp.mu(n + 50), pg_temp.mu(n) from unnest(array[41, 42]) as n;
-- No session link, so only the token delete can remove them (not the session cascade).
insert into auth.refresh_tokens (instance_id, token, user_id, revoked)
select '00000000-0000-0000-0000-000000000000', 't4-refresh-' || n, pg_temp.mu(n)::text, false
from unnest(array[41, 42]) as n;

-- Ledger fingerprints before the closure: every row of each table, as text.
create function pg_temp.digest(p_table text) returns text language plpgsql as $$
declare v text;
begin
  execute format(
    'select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) from public.%I t',
    '|', '', p_table) into v;
  return v;
end $$;
create temp table ledger_before as
select t as tbl, pg_temp.digest(t) as digest
from unnest(array['orders', 'order_items', 'shipments', 'disputes', 'reviews', 'reports',
  'admin_audit_logs', 'connect_payout_runs', 'connect_payout_run_shipments']) as t;
create temp table notices_before as
select count(*) as n from public.notifications where user_id = pg_temp.mu(42);

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
create temp table closed_answer as select public.fn_close_account(pg_temp.mu(41)) as answer;
reset role;

select is(
  (select answer->>'status' from closed_answer), 'closed',
  'purge: a user with only finished, paid-out history closes');
select is(
  (select concat_ws(',', answer->>'stripe_customer_id', answer->>'stripe_customer_cleanup',
     coalesce(answer->>'stripe_account_id', 'null'), answer->>'stripe_account_cleanup', answer->>'storage_cleanup')
   from closed_answer),
  'cus_t4_41,pending,null,not_needed,pending',
  'purge: the answer hands over the Stripe ids and which cleanup steps are open');
select is(
  (select concat_ws(',', stripe_customer_id, stripe_customer_cleanup, coalesce(stripe_account_id, 'null'),
     stripe_account_cleanup, storage_cleanup, attempts::text)
   from public.account_closures where user_id = pg_temp.mu(41)),
  'cus_t4_41,pending,null,not_needed,pending,0',
  'purge: the closure row stores the same ids and cleanup states');
select is(
  (select coalesce(stripe_customer_id, 'null') from public.profiles_private where id = pg_temp.mu(41)),
  'null', 'purge: the private profile drops the Stripe customer id');
select is(
  (select string_agg(stripe_payment_method_id, ',' order by stripe_payment_method_id)
   from public.payment_methods where user_id in (pg_temp.mu(41), pg_temp.mu(42))),
  'pm_t4_42', 'purge: payment methods of the user are deleted, others kept');
select is(
  (select string_agg(right(blocker_id::text, 2) || '>' || right(blocked_id::text, 2), ',' order by blocker_id, blocked_id)
   from public.blocked_users
   where blocker_id in (pg_temp.mu(41), pg_temp.mu(42)) or blocked_id in (pg_temp.mu(41), pg_temp.mu(42))),
  '42>44', 'purge: blocks on either side of the user are deleted, others kept');
select is(
  (select count(*) from public.notifications where user_id = pg_temp.mu(41)),
  0::bigint, 'purge: notifications of the user are deleted');
select is(
  (select count(*) from public.notifications where user_id = pg_temp.mu(42)),
  (select n from notices_before), 'purge: notifications of other users are kept');
select is(
  (select string_agg(token, ',') from public.push_tokens where user_id in (pg_temp.mu(41), pg_temp.mu(42))),
  'ExponentPushToken[t4-42]', 'purge: push tokens of the user are deleted, others kept');
select is(
  (select count(*) from public.addresses where id = pg_temp.mu(82)),
  0::bigint, 'purge: an address no shipment uses is deleted');
select is(
  (select concat_ws('|', full_name, phone, street_line1, coalesce(street_line2, 'null'), coalesce(street_number, 'null'),
     coalesce(district, 'null'), city, state, zip_code, coalesce(latitude::text, 'null'), coalesce(longitude::text, 'null'),
     coalesce(instructions, 'null'), label, is_default::text, (deleted_at is not null)::text)
   from public.addresses where id = pg_temp.mu(81)),
  'Deleted|||null|null|null||||null|null|null|deleted|false|true',
  'purge: an address a shipment ships from is kept with its personal data scrubbed');
select is(
  (select concat_ws('|', full_name, phone, street_line1, label, is_default::text, (deleted_at is null)::text)
   from public.addresses where id = pg_temp.mu(83)),
  'Counterparty|5500000042|Calle 3|home|true|true', 'purge: addresses of other users are untouched');
select is(
  (select string_agg(provider_id, ',') from auth.identities where user_id in (pg_temp.mu(41), pg_temp.mu(42))),
  pg_temp.mu(42)::text, 'purge: auth identities of the user are deleted, others kept');
select is(
  (select string_agg(user_id::text, ',') from auth.sessions where user_id in (pg_temp.mu(41), pg_temp.mu(42))),
  pg_temp.mu(42)::text, 'purge: auth sessions of the user are deleted, others kept');
select is(
  (select string_agg(token, ',') from auth.refresh_tokens where token like 't4-refresh-%'),
  't4-refresh-42', 'purge: refresh tokens of the user are deleted, others kept');
select is(
  (select raw_user_meta_data::text || ' ' || raw_app_meta_data::text from auth.users where id = pg_temp.mu(41)),
  '{} {"account_closed": true}', 'purge: auth metadata is cleared down to the closed marker');
select is(
  (select coalesce(phone, 'null') || '|' || encrypted_password from auth.users where id = pg_temp.mu(41)),
  'null|', 'purge: the auth phone and password are removed');
select is(
  (select raw_user_meta_data->>'username' from auth.users where id = pg_temp.mu(42)),
  'money_42', 'purge: other auth users keep their metadata');
select is(
  (select pg_temp.digest('orders') = digest from ledger_before where tbl = 'orders'),
  true, 'ledger: orders are untouched');
select is(
  (select pg_temp.digest('order_items') = digest from ledger_before where tbl = 'order_items'),
  true, 'ledger: order items are untouched');
select is(
  (select pg_temp.digest('shipments') = digest from ledger_before where tbl = 'shipments'),
  true, 'ledger: shipments are untouched');
select is(
  (select pg_temp.digest('disputes') = digest from ledger_before where tbl = 'disputes'),
  true, 'ledger: disputes are untouched');
select is(
  (select pg_temp.digest('reviews') = digest from ledger_before where tbl = 'reviews'),
  true, 'ledger: reviews are untouched');
select is(
  (select pg_temp.digest('reports') = digest from ledger_before where tbl = 'reports'),
  true, 'ledger: reports are untouched');
select is(
  (select pg_temp.digest('admin_audit_logs') = digest from ledger_before where tbl = 'admin_audit_logs'),
  true, 'ledger: admin audit logs are untouched');
select is(
  (select pg_temp.digest('connect_payout_runs') = digest from ledger_before where tbl = 'connect_payout_runs'),
  true, 'ledger: payout runs are untouched');
select is(
  (select pg_temp.digest('connect_payout_run_shipments') = digest from ledger_before where tbl = 'connect_payout_run_shipments'),
  true, 'ledger: payout run shipments are untouched');

select * from finish();
rollback;
