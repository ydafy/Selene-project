-- The release callers return a listing under the seller rule of T9e/T9e2:
-- an active seller's listing goes back to VERIFIED; a suspended seller's is
-- held (HIDDEN, status_before_account_hold = VERIFIED); reserved_at is cleared
-- either way. Covers fn_reserve_products (stale pre-release and partial
-- rollback), fn_cancel_shipment and the refund branch of
-- fn_finalize_checkout_recovery (auth-hardening S4; T10c.2). The stale cleanup,
-- fn_release_products and the direct helper call are in suspension_hold.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(50);

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- p_age NULL leaves reserved_at empty (a listing that is not reserved).
create function pg_temp.make_product(
  p_n integer, p_seller integer, p_status text, p_age interval default null
) returns void language sql as $$
  insert into public.products (
    id, name, description, price, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost, origin_zip, package_preset,
    reserved_at, publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select pg_temp.u(p_n), 'Test GPU', 'Test listing', 1000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status_enum,
    '{}'::jsonb, pg_temp.u(p_seller), 100, '06600', 'gpu_1',
    now() - p_age,
    round(100 * 100)::bigint + s.shipping_buffer_cents
      + ceil(round(1000 * 100)::numeric * public.normalize_publication_rate(s.insurance_rate))::bigint,
    public.normalize_publication_rate(s.service_fee_pct),
    public.normalize_publication_rate(s.insurance_rate)
  from public.system_settings s where s.id = 1
$$;

-- status:hold:reserved_at is empty
create function pg_temp.st(p_n integer) returns text language sql as $$
  select status::text || ':' || coalesce(status_before_account_hold::text, '-')
    || ':' || (reserved_at is null)::text
  from public.products where id = pg_temp.u(p_n)
$$;

-- Whole-row fingerprint of a listing, to prove a row outside the released set
-- did not change. Call it only as the table owner (before `set local role`).
create table pg_temp.sig (n integer primary key, v text);
create function pg_temp.sig_of(p_n integer) returns text language sql as $$
  select p.status::text || '|' || coalesce(p.status_before_account_hold::text, '-')
    || '|' || coalesce(p.reserved_at::text, '-') || '|' || p.updated_at::text
  from public.products p where p.id = pg_temp.u(p_n)
$$;
create function pg_temp.remember(p_ns integer[]) returns void language sql as $$
  insert into pg_temp.sig select n, pg_temp.sig_of(n) from unnest(p_ns) as n
$$;
create function pg_temp.unchanged(p_n integer) returns boolean language sql as $$
  select pg_temp.sig_of(p_n) = (select v from pg_temp.sig where n = p_n)
$$;

-- One order, one shipment per seller; the items are the given products.
create function pg_temp.make_shipment(
  p_order integer, p_shipment integer, p_seller integer, p_status public.order_status_enum, p_products integer[]
) returns void language plpgsql as $$
begin
  insert into public.orders (id, buyer_id, total_amount, shipping_address, status)
  values (pg_temp.u(p_order), pg_temp.u(3), 1000, '{}'::jsonb, p_status)
  on conflict (id) do nothing;
  insert into public.shipments (id, order_id, seller_id, status)
  values (pg_temp.u(p_shipment), pg_temp.u(p_order), pg_temp.u(p_seller), p_status);
  insert into public.order_items (order_id, product_id, seller_id, price_at_purchase, net_payout, shipment_id)
  select pg_temp.u(p_order), pg_temp.u(n), pg_temp.u(p_seller), 1000, 900, pg_temp.u(p_shipment)
  from unnest(p_products) as n;
end $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(u.n), 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  (1, 'rel_suspended@test.local', 'rel_suspended'),
  (2, 'rel_active@test.local', 'rel_active'),
  (3, 'rel_buyer@test.local', 'rel_buyer'),
  (4, 'rel_midcall@test.local', 'rel_midcall')
) as u(n, email, username);
-- User 1 is the suspended seller, 2 the active one, 3 the buyer, 4 an active
-- seller that a trigger suspends in the middle of a call.
update public.profiles_private set status = 'suspended' where id = pg_temp.u(1);

-- 1. fn_reserve_products, step 1: the stale pre-release ----------------------
select pg_temp.make_product(101, 1, 'RESERVED', interval '20 minutes');
select pg_temp.make_product(102, 2, 'RESERVED', interval '20 minutes');
select pg_temp.make_product(103, 2, 'RESERVED', interval '1 minute');
select pg_temp.make_product(104, 2, 'RESERVED', interval '20 minutes');
select pg_temp.make_product(105, 2, 'RESERVED', interval '1 minute');
select pg_temp.make_product(106, 1, 'RESERVED', interval '20 minutes');
select pg_temp.make_product(107, 2, 'RESERVED', interval '20 minutes');
select pg_temp.remember(array[103, 105]);

-- A cart with only the suspended seller's expired reservation: the pre-release
-- holds it, it is no longer reservable, and the call refuses the cart.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') || ':' || total_price::text
   from public.fn_reserve_products('e0000000-0000-4000-8000-000000000003',
     array['e0000000-0000-4000-8000-000000000101']::uuid[])),
  'false:SOME_PRODUCTS_UNAVAILABLE:0', 'reserve: a cart with only a suspended seller expired reservation is refused');
reset role;
select is(pg_temp.st(101), 'HIDDEN:VERIFIED:true',
  'reserve: the pre-release holds the suspended seller listing and clears reserved_at');

-- A cart with only the active seller's expired reservation: back to sale, then
-- reserved by this call.
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') || ':' || total_price::text
   from public.fn_reserve_products('e0000000-0000-4000-8000-000000000003',
     array['e0000000-0000-4000-8000-000000000102']::uuid[])),
  'true:-:1000', 'reserve: a cart with only an active seller expired reservation succeeds');
reset role;
select is(pg_temp.st(102), 'RESERVED:-:false',
  'reserve: the active seller listing was released to sale and reserved again by this call');

-- Active seller: expired listing plus a fresh reservation held by someone else.
-- The expired one is released, reserved, then rolled back; the fresh one is untouched.
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') || ':' || total_price::text
   from public.fn_reserve_products('e0000000-0000-4000-8000-000000000003',
     array['e0000000-0000-4000-8000-000000000104', 'e0000000-0000-4000-8000-000000000105']::uuid[])),
  'false:SOME_PRODUCTS_UNAVAILABLE:0', 'reserve: a cart with a fresh reservation of another buyer is refused');
reset role;
select is(pg_temp.st(104), 'VERIFIED:-:true',
  'reserve: the expired active seller listing ends back on sale with reserved_at cleared');
select ok(pg_temp.unchanged(105), 'reserve: the fresh reservation outside the released set is unchanged');
select ok(pg_temp.unchanged(103), 'reserve: a fresh reservation outside the cart is unchanged');

-- Suspended and active expired reservations in one cart.
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') || ':' || total_price::text
   from public.fn_reserve_products('e0000000-0000-4000-8000-000000000003',
     array['e0000000-0000-4000-8000-000000000106', 'e0000000-0000-4000-8000-000000000107']::uuid[])),
  'false:SOME_PRODUCTS_UNAVAILABLE:0', 'reserve: a mixed cart of suspended and active expired reservations is refused');
reset role;
select is(pg_temp.st(106), 'HIDDEN:VERIFIED:true', 'reserve: the mixed cart holds the suspended seller listing');
select is(pg_temp.st(107), 'VERIFIED:-:true', 'reserve: the mixed cart leaves the active seller listing on sale');

-- 2. fn_reserve_products, step 4: partial rollback -----------------------------
select pg_temp.make_product(201, 2, 'VERIFIED');
select pg_temp.make_product(202, 2, 'HIDDEN');
select pg_temp.make_product(203, 1, 'VERIFIED');
select pg_temp.make_product(204, 2, 'VERIFIED');
select pg_temp.make_product(205, 4, 'VERIFIED');
select pg_temp.make_product(206, 2, 'HIDDEN');
select pg_temp.remember(array[202, 203, 206]);

-- Reservable (active seller) plus unreservable (hidden): the reservation is undone.
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') || ':' || total_price::text
   from public.fn_reserve_products('e0000000-0000-4000-8000-000000000003',
     array['e0000000-0000-4000-8000-000000000201', 'e0000000-0000-4000-8000-000000000202']::uuid[])),
  'false:SOME_PRODUCTS_UNAVAILABLE:0', 'rollback: a cart with a hidden listing is refused');
reset role;
select is(pg_temp.st(201), 'VERIFIED:-:true',
  'rollback: the tentatively reserved active seller listing is back to VERIFIED with reserved_at cleared');
select ok(pg_temp.unchanged(202), 'rollback: the hidden listing is unchanged');

-- Reservable (active seller) plus VERIFIED listing of a suspended seller.
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') || ':' || total_price::text
   from public.fn_reserve_products('e0000000-0000-4000-8000-000000000003',
     array['e0000000-0000-4000-8000-000000000203', 'e0000000-0000-4000-8000-000000000204']::uuid[])),
  'false:SOME_PRODUCTS_UNAVAILABLE:0', 'rollback: a cart with a suspended seller listing is refused');
reset role;
select is(pg_temp.st(204), 'VERIFIED:-:true',
  'rollback: the active seller listing is back to VERIFIED, not held');
select ok(pg_temp.unchanged(203), 'rollback: the suspended seller VERIFIED listing was never reserved and is unchanged');
select is(
  (select count(*) from public.products
   where id in (pg_temp.u(201), pg_temp.u(202), pg_temp.u(203), pg_temp.u(204)) and status = 'RESERVED'),
  0::bigint, 'rollback: nothing from these carts stays RESERVED');

-- A suspension that lands between the reservation and the rollback. A trigger
-- suspends the seller as soon as listing 205 is reserved, which stands in for a
-- concurrent admin action (a real race needs two sessions and cannot be built
-- inside one pgTAP transaction).
create function pg_temp.suspend_midcall() returns trigger language plpgsql as $$
begin
  update public.profiles_private set status = 'suspended' where id = new.seller_id;
  return null;
end $$;
create trigger rel_midcall_suspend after update on public.products
  for each row when (new.id = 'e0000000-0000-4000-8000-000000000205'::uuid and new.status = 'RESERVED' and old.status = 'VERIFIED')
  execute function pg_temp.suspend_midcall();
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-') || ':' || total_price::text
   from public.fn_reserve_products('e0000000-0000-4000-8000-000000000003',
     array['e0000000-0000-4000-8000-000000000205', 'e0000000-0000-4000-8000-000000000206']::uuid[])),
  'false:SOME_PRODUCTS_UNAVAILABLE:0', 'rollback: a cart whose seller is suspended mid-call is refused');
reset role;
select is((select status from public.profiles_private where id = pg_temp.u(4)), 'suspended',
  'rollback: fixture, the trigger suspended the seller after the reservation');
select is(pg_temp.st(205), 'HIDDEN:VERIFIED:true',
  'rollback: the listing of a seller suspended mid-call is held, not returned to sale');
select ok(pg_temp.unchanged(206), 'rollback: the other hidden listing is unchanged');
drop trigger rel_midcall_suspend on public.products;

-- 3. fn_cancel_shipment ----------------------------------------------------------
-- One multi-seller order: shipment 601 (active seller, listing 301) and shipment
-- 602 (suspended seller, listing 302). Order 502 is a bystander: shipment 603
-- (active seller, listing 304) and 604 (suspended seller, listing 303).
select pg_temp.make_product(301, 2, 'SOLD');
select pg_temp.make_product(302, 1, 'SOLD');
select pg_temp.make_product(303, 1, 'SOLD');
select pg_temp.make_product(304, 2, 'SOLD');
select pg_temp.make_shipment(501, 601, 2, 'paid', array[301]);
select pg_temp.make_shipment(501, 602, 1, 'paid', array[302]);
select pg_temp.make_shipment(502, 603, 2, 'paid', array[304]);
select pg_temp.make_shipment(502, 604, 1, 'paid', array[303]);
-- The Stripe refund is recorded as succeeded before the cancellation.
insert into public.shipment_cancellation_operations (
  shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at,
  external_started_at, refund_id, refund_status, refund_status_updated_at
)
select pg_temp.u(s), pg_temp.u(501), 'buyer', pg_temp.u(3), 'test cancellation',
  gen_random_uuid(), now(), now(), 're_test_' || s, 'succeeded', now()
from unnest(array[601, 602]) as s;
select pg_temp.remember(array[303, 304]);

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$select * from public.fn_cancel_shipment('e0000000-0000-4000-8000-000000000601', 'buyer', 'test', null)$$,
  '42501', null, 'anon cannot execute fn_cancel_shipment');
select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.fn_cancel_shipment('e0000000-0000-4000-8000-000000000601', 'buyer', 'test', null)$$,
  '42501', null, 'authenticated cannot execute fn_cancel_shipment');
reset role;
select is(
  (select count(*) from public.shipments where order_id = pg_temp.u(501) and status = 'paid'),
  2::bigint, 'the refused calls cancelled nothing');

-- The active seller's shipment: its listing returns to sale.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-')
   from public.fn_cancel_shipment('e0000000-0000-4000-8000-000000000601', 'buyer', 'test', null)),
  'true:-', 'cancel: the active seller shipment is cancelled');
reset role;
select is((select status::text from public.shipments where id = pg_temp.u(601)), 'cancelled',
  'cancel: shipment 601 is cancelled');
select is(pg_temp.st(301), 'VERIFIED:-:true', 'cancel: the active seller listing returns to VERIFIED');
select is((select status::text from public.shipments where id = pg_temp.u(602)), 'paid',
  'cancel: the other seller shipment of the order is untouched');
select is(pg_temp.st(302), 'SOLD:-:true',
  'cancel: the suspended seller listing is still SOLD');

-- The suspended seller's shipment: its listings are held.
set local role service_role;
select is(
  (select success::text || ':' || coalesce(error_message, '-')
   from public.fn_cancel_shipment('e0000000-0000-4000-8000-000000000602', 'buyer', 'test', null)),
  'true:-', 'cancel: the suspended seller shipment is cancelled');
reset role;
select is((select status::text from public.shipments where id = pg_temp.u(602)), 'cancelled',
  'cancel: shipment 602 is cancelled');
select is(pg_temp.st(302), 'HIDDEN:VERIFIED:true', 'cancel: the suspended seller listing is held');
select is(pg_temp.st(301), 'VERIFIED:-:true', 'cancel: the active seller listing stays on sale');
select ok(pg_temp.unchanged(304), 'cancel: a listing of another order is unchanged');
select ok(pg_temp.unchanged(303), 'cancel: a suspended seller listing of another order is not held');
select is((select status::text from public.shipments where id = pg_temp.u(603)), 'paid',
  'cancel: the shipment of another order is untouched');

-- 4. fn_finalize_checkout_recovery, refund path ---------------------------------
-- 701: active seller (401 reserved, 402 hidden). 702: suspended seller (403).
-- 703: both sellers (404 active, 405 suspended). 406: reserved, in no order.
select pg_temp.make_product(401, 2, 'RESERVED', interval '1 minute');
select pg_temp.make_product(402, 2, 'HIDDEN');
select pg_temp.make_product(403, 1, 'RESERVED', interval '1 minute');
select pg_temp.make_product(404, 2, 'RESERVED', interval '1 minute');
select pg_temp.make_product(405, 1, 'RESERVED', interval '1 minute');
select pg_temp.make_product(406, 2, 'RESERVED', interval '1 minute');
insert into public.orders (
  id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id,
  payment_processing, payment_processing_reason, compensation_state
)
select pg_temp.u(o.n), pg_temp.u(3), 1000, '{}'::jsonb, 'pending', 'pi_release_' || o.n,
  true, 'test', 'refund_pending'
from (values (701), (702), (703)) as o(n);
insert into public.order_items (order_id, product_id, seller_id, price_at_purchase, net_payout)
select pg_temp.u(i.o), pg_temp.u(i.p), pg_temp.u(i.s), 1000, 900
from (values (701, 401, 2), (701, 402, 2), (702, 403, 1), (703, 404, 2), (703, 405, 1)) as i(o, p, s);
select pg_temp.remember(array[402, 406]);

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$select public.fn_finalize_checkout_recovery('pi_release_701', 're_release_701')$$,
  '42501', null, 'anon cannot execute fn_finalize_checkout_recovery');
select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.fn_finalize_checkout_recovery('pi_release_701', 're_release_701')$$,
  '42501', null, 'authenticated cannot execute fn_finalize_checkout_recovery');
reset role;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select public.fn_finalize_checkout_recovery('pi_release_701', 're_release_701')->>'status'),
  'refunded', 'refund: the order of an active seller is finalized');
reset role;
select is(pg_temp.st(401), 'VERIFIED:-:true', 'refund: the active seller reserved listing returns to VERIFIED');
select ok(pg_temp.unchanged(402), 'refund: a non-reserved listing of the same order is unchanged');
select is(
  (select status::text || ':' || compensation_state || ':' || stripe_refund_id from public.orders where id = pg_temp.u(701)),
  'refunded:refunded:re_release_701', 'refund: the order is marked refunded with the refund id');

set local role service_role;
select is(
  (select public.fn_finalize_checkout_recovery('pi_release_702', 're_release_702')->>'status'),
  'refunded', 'refund: the order of a suspended seller is finalized');
reset role;
select is(pg_temp.st(403), 'HIDDEN:VERIFIED:true', 'refund: the suspended seller reserved listing is held');
select is(
  (select status::text || ':' || compensation_state || ':' || stripe_refund_id from public.orders where id = pg_temp.u(702)),
  'refunded:refunded:re_release_702', 'refund: the order of the suspended seller is still refunded');

set local role service_role;
select is(
  (select public.fn_finalize_checkout_recovery('pi_release_703', 're_release_703')->>'status'),
  'refunded', 'refund: the order of two sellers is finalized');
reset role;
select is(pg_temp.st(404), 'VERIFIED:-:true', 'refund: the active seller listing of a two-seller order returns to VERIFIED');
select is(pg_temp.st(405), 'HIDDEN:VERIFIED:true', 'refund: the suspended seller listing of a two-seller order is held');
select ok(pg_temp.unchanged(406), 'refund: a reserved listing in no order is unchanged');

select * from finish();
rollback;
