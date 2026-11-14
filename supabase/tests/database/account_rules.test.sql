-- Block-1 account rules (S4, T10b): a suspended seller cannot publish, edit or
-- receive reservations, but keeps their own purchases; lifting a suspension
-- restores only the listings the account hold hid, each to its prior status;
-- banned is final; clients cannot write profiles_private.role or status; the
-- status RPC refuses self changes and NULL, audits each change and clears
-- stale holds. Runs against the local database only:
-- `supabase start`, then `bun run test:db`.
begin;
select plan(53);

-- Snapshot values under the current settings (authenticated cannot read them).
create function pg_temp.fresh_reserve() returns bigint language sql security definer as $$
  select 10000::bigint + s.shipping_buffer_cents
    + ceil(100000::numeric * s.insurance_rate)::bigint
  from public.system_settings s where s.id = 1
$$;
create function pg_temp.commission_rate() returns numeric language sql security definer as $$
  select service_fee_pct from public.system_settings where id = 1
$$;
create function pg_temp.insurance_rate() returns numeric language sql security definer as $$
  select insurance_rate from public.system_settings where id = 1
$$;

-- The insert a seller's app sends for a new listing, valid in every other respect.
create function pg_temp.owner_insert(p_id uuid, p_seller uuid) returns text language sql as $$
  select format($f$
    insert into public.products (
      id, name, description, price_cents, category, condition, usage, images, status,
      specifications, seller_id, shipping_cost_cents, origin_zip, package_preset,
      publication_shipping_reserve_cents, publication_commission_rate, publication_insurance_rate
    ) values (
      %L, 'Test GPU', 'Test listing', 100000, 'GPU', 'used', 'gaming',
      array['https://example.test/p.png'], 'PENDING_VERIFICATION', '{}'::jsonb, %L, 10000,
      '06600', 'gpu_1', pg_temp.fresh_reserve(), pg_temp.commission_rate(), pg_temp.insurance_rate()
    )$f$, p_id, p_seller)
$$;

-- Runs a statement as the current role and returns the number of rows it changed.
create function pg_temp.changed(p_sql text) returns integer language plpgsql as $$
declare v_rows integer;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end
$$;

create function pg_temp.make_listing(p_id uuid, p_seller uuid, p_status text) returns void
language sql as $$
  insert into public.products (
    id, name, description, price_cents, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost_cents, origin_zip, package_preset,
    publication_shipping_reserve_cents, publication_commission_rate, publication_insurance_rate
  ) values (
    p_id, 'Test GPU', 'Test listing', 100000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status_enum, '{}'::jsonb,
    p_seller, 10000, '06600', 'gpu_1',
    pg_temp.fresh_reserve(), pg_temp.commission_rate(), pg_temp.insurance_rate()
  )
$$;

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

create function pg_temp.listing(p_id uuid) returns text language sql as $$
  select status::text || ':' || coalesce(status_before_account_hold::text, '-')
  from public.products where id = p_id
$$;

-- 01 admin, 02 seller to suspend and lift, 03 seller to ban, 04 buyer,
-- 05 active seller, 06 seller suspended outside the RPC, 07 client attempting escalation.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'rules_admin@test.local', 'rules_admin'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'rules_suspended@test.local', 'rules_suspended'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'rules_banned@test.local', 'rules_banned'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, 'rules_buyer@test.local', 'rules_buyer'),
  ('d0000000-0000-4000-8000-000000000005'::uuid, 'rules_active@test.local', 'rules_active'),
  ('d0000000-0000-4000-8000-000000000006'::uuid, 'rules_direct@test.local', 'rules_direct'),
  ('d0000000-0000-4000-8000-000000000007'::uuid, 'rules_client@test.local', 'rules_client')
) as u(id, email, username);
update public.profiles_private set role = 'admin'
where id = 'd0000000-0000-4000-8000-000000000001';

-- Seller 02: s1 VERIFIED, s2 PENDING_VERIFICATION, s3 IN_REVIEW, s4 REJECTED,
-- s5 HIDDEN by the seller. Seller 03: b1 VERIFIED. Seller 05: a1, a2 VERIFIED.
-- Seller 06: v1 VERIFIED. Client 07: c1 HIDDEN.
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000002', 'VERIFIED');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-000000000002', 'PENDING_VERIFICATION');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-000000000002', 'IN_REVIEW');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a4', 'd0000000-0000-4000-8000-000000000002', 'REJECTED');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a5', 'd0000000-0000-4000-8000-000000000002', 'HIDDEN');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-000000000003', 'VERIFIED');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-000000000005', 'VERIFIED');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000c2', 'd0000000-0000-4000-8000-000000000005', 'VERIFIED');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-000000000006', 'VERIFIED');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-000000000007', 'HIDDEN');

-- Controls: an active seller publishes and edits through the same statements --
select pg_temp.as_user('d0000000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  pg_temp.owner_insert('d0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-000000000002'),
  'an active seller publishes a listing');
select is(
  pg_temp.changed($$update public.products set description = 'edited while active'
    where id = 'd0000000-0000-4000-8000-0000000000a5'$$),
  1, 'an active seller edits their own listing');
reset role;

-- Suspension -------------------------------------------------------------------
select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
    'suspended', 'test'),
  true, 'smoke: an admin suspends the seller');
reset role;
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a1'), 'HIDDEN:VERIFIED',
  'the suspension holds a VERIFIED listing');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a2'), 'HIDDEN:PENDING_VERIFICATION',
  'the suspension holds a PENDING_VERIFICATION listing');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a3'), 'HIDDEN:IN_REVIEW',
  'the suspension holds an IN_REVIEW listing');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a4'), 'REJECTED:-',
  'the suspension leaves a REJECTED listing alone');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a5'), 'HIDDEN:-',
  'a listing the seller hid is not marked as held');

-- A suspended seller cannot publish or edit ------------------------------------
select pg_temp.as_user('d0000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  pg_temp.owner_insert('d0000000-0000-4000-8000-0000000000f2', 'd0000000-0000-4000-8000-000000000002'),
  '42501', null, 'a suspended seller cannot publish a listing');
select is(
  pg_temp.changed($$update public.products set description = 'edited while suspended'
    where id = 'd0000000-0000-4000-8000-0000000000a5'$$),
  0, 'a suspended seller cannot edit a listing they hid');
select is(
  pg_temp.changed($$update public.products
    set status = 'PENDING_VERIFICATION', status_before_account_hold = null
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$),
  0, 'a suspended seller cannot take a listing out of the hold');
reset role;
select is(
  (select count(*) from public.products where id = 'd0000000-0000-4000-8000-0000000000f2'),
  0::bigint, 'the refused listing was not stored');
select is(
  (select description from public.products where id = 'd0000000-0000-4000-8000-0000000000a5'),
  'edited while active', 'the refused edit left the listing unchanged');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a1'), 'HIDDEN:VERIFIED',
  'the held listing is still held');

-- A suspended seller cannot receive reservations; their purchases stay ---------
-- Seller 06 is suspended without the RPC, so its listing is still VERIFIED and
-- only the gate in fn_reserve_products stands between it and a sale.
update public.profiles_private set status = 'suspended'
where id = 'd0000000-0000-4000-8000-000000000006';
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') from public.fn_reserve_products(
    'd0000000-0000-4000-8000-000000000004', array['d0000000-0000-4000-8000-0000000000d1']::uuid[])),
  'false:SOME_PRODUCTS_UNAVAILABLE', 'a VERIFIED listing of a suspended seller cannot be reserved');
select is(
  (select success::text || ':' || coalesce(error_message, '-') from public.fn_reserve_products(
    'd0000000-0000-4000-8000-000000000004', array[
      'd0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-0000000000d1'
    ]::uuid[])),
  'false:SOME_PRODUCTS_UNAVAILABLE', 'a cart mixing an active and a suspended seller is refused');
reset role;
select is(
  (select string_agg(status::text || ':' || (reserved_at is null)::text, ',' order by id)
   from public.products where id in ('d0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-0000000000d1')),
  'VERIFIED:true,VERIFIED:true', 'the refused carts left both listings for sale');
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') from public.fn_reserve_products(
    'd0000000-0000-4000-8000-000000000002', array['d0000000-0000-4000-8000-0000000000c1']::uuid[])),
  'true:-', 'a suspended buyer still reserves from an active seller');
reset role;
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000c1'), 'RESERVED:-',
  'the suspended buyer reservation holds the listing');

-- Lifting the suspension restores only the held listings, each to its status ----
select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.fn_admin_update_user_status(
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'active', 'lifted');
reset role;
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a1'), 'VERIFIED:-',
  'the lift returns a held VERIFIED listing to VERIFIED');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a2'), 'PENDING_VERIFICATION:-',
  'the lift returns a held PENDING_VERIFICATION listing to review, not to sale');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a3'), 'IN_REVIEW:-',
  'the lift returns a held IN_REVIEW listing to IN_REVIEW');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a4'), 'REJECTED:-',
  'the lift leaves a REJECTED listing rejected');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000a5'), 'HIDDEN:-',
  'the lift leaves a listing the seller hid hidden');
select pg_temp.as_user('d0000000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  pg_temp.owner_insert('d0000000-0000-4000-8000-0000000000f3', 'd0000000-0000-4000-8000-000000000002'),
  'after the lift the seller publishes again');
reset role;

-- Banned is final --------------------------------------------------------------
select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.fn_admin_update_user_status(
  'd0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'suspended', 'review');
select public.fn_admin_update_user_status(
  'd0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'banned', 'fraud');
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'active', 'undo')$$,
  'P0001', 'BANNED_IS_FINAL', 'a ban cannot be lifted to active');
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'suspended', 'undo')$$,
  'P0001', 'BANNED_IS_FINAL', 'a ban cannot be reduced to a suspension');
reset role;
select is(
  (select status::text from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000003'),
  'banned', 'the account stays banned');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000b1'), 'HIDDEN:VERIFIED',
  'the banned seller listing stays held');
select pg_temp.as_user('d0000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  pg_temp.owner_insert('d0000000-0000-4000-8000-0000000000f4', 'd0000000-0000-4000-8000-000000000003'),
  '42501', null, 'a banned seller cannot publish a listing');
select is(
  pg_temp.changed($$update public.products
    set status = 'PENDING_VERIFICATION', status_before_account_hold = null
    where id = 'd0000000-0000-4000-8000-0000000000b1'$$),
  0, 'a banned seller cannot take a listing out of the hold');
reset role;
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') from public.fn_reserve_products(
    'd0000000-0000-4000-8000-000000000003', array['d0000000-0000-4000-8000-0000000000c2']::uuid[])),
  'false:ACCOUNT_RESTRICTED', 'a banned buyer cannot reserve');
reset role;
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000c2'), 'VERIFIED:-',
  'the banned buyer attempt left the listing for sale');

-- Clients cannot write role or status ------------------------------------------
select pg_temp.as_user('d0000000-0000-4000-8000-000000000007');
set local role authenticated;
select throws_ok(
  $$update public.profiles_private set role = 'admin', status = 'banned'
    where id = 'd0000000-0000-4000-8000-000000000004'$$,
  '42501', null, 'a client cannot write another user role or status');
select throws_ok(
  $$update public.products set status_before_account_hold = 'VERIFIED'
    where id = 'd0000000-0000-4000-8000-0000000000e1'$$,
  '42501', null, 'a client cannot pre-set the account hold on their own listing');
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 'suspended', 'x')$$,
  'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'a client cannot call the status RPC, even naming an admin as actor');

-- Role claims in the JWT do not make an admin; the role lives in profiles_private.
select set_config('request.jwt.claims', json_build_object(
  'sub', 'd0000000-0000-4000-8000-000000000007', 'role', 'authenticated', 'user_role', 'admin',
  'app_metadata', json_build_object('role', 'admin'),
  'user_metadata', json_build_object('role', 'admin'))::text, true);
select is(public.is_admin(), false, 'admin claims in the JWT do not make the client an admin');
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000007', 'suspended', 'x')$$,
  'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'admin claims in the JWT do not unlock the status RPC');
reset role;

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 'suspended', 'x')$$,
  '42501', null, 'anon cannot execute the status RPC');
reset role;

-- Signup and profile metadata (client-controlled through Auth) are ignored.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000008',
  'authenticated', 'authenticated', 'rules_signup@test.local', '', now(),
  '{"role": "admin", "status": "banned"}'::jsonb,
  '{"username": "rules_signup", "role": "admin", "status": "suspended"}'::jsonb,
  now(), now(), '', '', '', ''
);
select is(
  (select role || ':' || status::text from public.profiles_private
   where id = 'd0000000-0000-4000-8000-000000000008'),
  'user:active', 'signup metadata cannot set role or status');
update auth.users
set raw_user_meta_data = raw_user_meta_data || '{"role": "admin", "status": "active"}'::jsonb,
    email = 'rules_client_changed@test.local'
where id = 'd0000000-0000-4000-8000-000000000007';
select is(
  (select role || ':' || status::text from public.profiles_private
   where id = 'd0000000-0000-4000-8000-000000000007'),
  'user:active', 'a metadata update through Auth cannot set role or status');

-- Nothing the clients attempted changed an account -------------------------------
select is(
  (select string_agg(id::text || '=' || role || ':' || status::text, ',' order by id)
   from public.profiles_private where id in (
     'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000007')),
  'd0000000-0000-4000-8000-000000000004=user:active,d0000000-0000-4000-8000-000000000007=user:active',
  'the buyer and the client keep role user and status active');
select is(
  (select count(*) from public.admin_audit_logs
   where target_id in ('d0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000007')),
  0::bigint, 'no status change was audited for the targets of the refused calls');
select is(pg_temp.listing('d0000000-0000-4000-8000-0000000000e1'), 'HIDDEN:-',
  'the client listing has no account hold');

-- Status RPC guards, stale holds and the audit row (#277) -------------------------
-- 09 a seller to suspend and lift with an admin edit in between, 10 a suspended
-- admin. Listings: aa and ab of seller 09, both VERIFIED.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000009'::uuid, 'rules_stale@test.local', 'rules_stale'),
  ('d0000000-0000-4000-8000-000000000010'::uuid, 'rules_admin2@test.local', 'rules_admin2')
) as u(id, email, username);
update public.profiles_private set role = 'admin', status = 'suspended'
where id = 'd0000000-0000-4000-8000-000000000010';
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000aa', 'd0000000-0000-4000-8000-000000000009', 'VERIFIED');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000ab', 'd0000000-0000-4000-8000-000000000009', 'VERIFIED');

select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'suspended', 'self')$$,
  'P0001', 'CANNOT_CHANGE_OWN_STATUS', 'an admin cannot change their own status');
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001', null, 'null status')$$,
  'P0001', 'INVALID_ACCOUNT_STATUS', 'a NULL status is refused');
select is(
  public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-0000000000ff', 'd0000000-0000-4000-8000-000000000001', 'suspended', 'nobody'),
  false, 'an unknown user returns false');
reset role;
select is(
  (select string_agg(id::text || '=' || coalesce(status::text, 'null'), ',' order by id)
   from public.profiles_private where id in (
     'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005')),
  'd0000000-0000-4000-8000-000000000001=active,d0000000-0000-4000-8000-000000000005=active',
  'the refused calls left the admin and the target active');
select is(
  (select count(*) from public.admin_audit_logs where target_id in (
     'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005',
     'd0000000-0000-4000-8000-0000000000ff')),
  0::bigint, 'the refused calls and the unknown user wrote no audit row');

-- A suspended admin has no admin authority.
select pg_temp.as_user('d0000000-0000-4000-8000-000000000010');
set local role authenticated;
select throws_ok(
  $$select public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000010', 'suspended', 'x')$$,
  'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'a suspended admin cannot change a status');
reset role;

-- Suspend 09 naming another user as actor; the JWT admin is recorded instead.
select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.fn_admin_update_user_status(
  'd0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000005', 'suspended', 'hold');
reset role;
-- During the suspension an admin moves aa out of HIDDEN; its hold goes stale.
update public.products set status = 'REJECTED' where id = 'd0000000-0000-4000-8000-0000000000aa';
select pg_temp.as_user('d0000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.fn_admin_update_user_status(
  'd0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000005', 'active', 'lift');
reset role;
select is(
  pg_temp.listing('d0000000-0000-4000-8000-0000000000aa') || ',' || pg_temp.listing('d0000000-0000-4000-8000-0000000000ab'),
  'REJECTED:-,VERIFIED:-',
  'the lift clears the stale hold of a listing an admin moved out of HIDDEN and restores the other');
select is(
  (select string_agg(right(admin_id::text, 2) || ':' || action_type || ':' || (details->>'previous_status')
     || '>' || (details->>'new_status') || ':' || (details->>'reason'), ',' order by details->>'previous_status')
   from public.admin_audit_logs where target_id = 'd0000000-0000-4000-8000-000000000009'),
  '01:USER_STATUS_UPDATE:active>suspended:hold,01:USER_STATUS_UPDATE:suspended>active:lift',
  'each change is audited with the JWT admin, previous status, new status and reason');
select is(
  (select status::text || ':' || status_reason || ':' || status_updated_by from public.profiles_private
   where id = 'd0000000-0000-4000-8000-000000000009'),
  'active:lift:d0000000-0000-4000-8000-000000000001',
  'the account records the reason and the JWT admin, not the admin id passed in');

select * from finish();
rollback;
