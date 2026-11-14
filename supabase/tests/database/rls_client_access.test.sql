-- Row-level security per client role (#310 T1): which rows a buyer, a
-- seller, an admin, a suspended admin, an unrelated user and anon see and
-- change in addresses, shipments, orders, order_items, products, profiles,
-- profiles_private and shipment_tracking_events. It pins the behavior the
-- policy merge (S3) must keep. Counts are restricted to this file's own ids.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(49);
\ir ../fixtures/money.psql

-- Users: 14001 seller A, 14002 buyer, 14003 admin, 14004 unrelated user,
-- 14005 suspended admin, 14006 seller B.
select pg_temp.money_user(n) from unnest(array[14001, 14002, 14004, 14006]) n;
select pg_temp.money_user(n, 'admin') from unnest(array[14003, 14005]) n;
update public.profiles_private set status = 'suspended' where id = pg_temp.mu(14005);

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.mu(p_n), 'role', 'authenticated')::text, true)
$$;

-- The last five digits of each id in p_ids, sorted: '{14101,14301}'.
create function pg_temp.short_ids(p_ids uuid[]) returns text language sql as $$
  select coalesce(array_agg(right(i::text, 5) order by i), '{}')::text from unnest(p_ids) i
$$;

-- Order 14201 of the buyer with shipment 14101 of seller A and shipment
-- 14102 of seller B (each holds the listing of the same number).
select pg_temp.money_shipment(14201, 14101, 14001, 14002, 'preparing');
select pg_temp.money_shipment(14201, 14102, 14006, 14002, 'preparing');

-- Listing 14301 of seller A, published and verified.
select pg_temp.money_product(14301, 14001);
update public.products set status = 'VERIFIED' where id = pg_temp.mu(14301);

-- Addresses 14401 seller A, 14402 buyer, 14403 seller B.
insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label)
select pg_temp.mu(a), pg_temp.mu(u), 'Test', '5555555555', 'Calle 1', 'CDMX', 'CDMX', '06600', 'Home'
from (values (14401, 14001), (14402, 14002), (14403, 14006)) v(a, u);

-- One tracking event per shipment.
insert into public.shipment_tracking_events (shipment_id, event_type, event_at, raw_status)
select pg_temp.mu(s), 'in_transit', '2026-11-01 10:00:00+00', 'RAW' || s
from unnest(array[14101, 14102]) s;

-- 1. Seller A -----------------------------------------------------------------------
select pg_temp.as_user(14001);
set local role authenticated;

select is(pg_temp.short_ids(array(select id from public.addresses
    where id in (pg_temp.mu(14401), pg_temp.mu(14402), pg_temp.mu(14403)))), '{14401}',
  'addresses: a user sees only their own address');
select throws_ok(
  format($$insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label)
    values (%L, %L, 'Test', '5555555555', 'Calle 1', 'CDMX', 'CDMX', '06600', 'Other')$$,
    pg_temp.mu(14405), pg_temp.mu(14002)),
  '42501', null, 'addresses: inserting an address for another user is refused');
select lives_ok(
  format($$insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label)
    values (%L, %L, 'Test', '5555555555', 'Calle 2', 'CDMX', 'CDMX', '06600', 'Work')$$,
    pg_temp.mu(14404), pg_temp.mu(14001)),
  'addresses: a user inserts their own address');
select lives_ok(
  format($$update public.addresses set label = 'Updated' where id = %L$$, pg_temp.mu(14401)),
  'addresses: a user updates their own address');
select lives_ok(
  format($$update public.addresses set label = 'Taken' where id = %L$$, pg_temp.mu(14402)),
  'addresses: updating another user''s address raises nothing (RLS filters it)');
select throws_ok(
  format($$delete from public.addresses where id = %L$$, pg_temp.mu(14401)),
  '42501', null, 'addresses: authenticated has no DELETE privilege');

select is(pg_temp.short_ids(array(select id from public.shipments
    where id in (pg_temp.mu(14101), pg_temp.mu(14102)))), '{14101}',
  'shipments: a seller sees only their own shipment of a shared order');
select is((select count(*)::integer from public.orders where id = pg_temp.mu(14201)), 1,
  'orders: a seller sees the order that holds their shipment');
select ok(exists(select 1 from public.order_items where shipment_id = pg_temp.mu(14101)),
  'order_items: a seller sees the item of their own shipment');
select is(pg_temp.short_ids(array(select id from public.products
    where id in (pg_temp.mu(14101), pg_temp.mu(14102), pg_temp.mu(14301)))), '{14101,14301}',
  'products: a seller sees their own listings, not another seller''s');
select lives_ok(
  format($$update public.products set name = 'Renamed by owner' where id = %L$$, pg_temp.mu(14301)),
  'products: a seller renames their own verified listing');
select is((select count(*)::integer from public.shipment_tracking_events
    where shipment_id in (pg_temp.mu(14101), pg_temp.mu(14102))), 1,
  'shipment_tracking_events: a seller sees the events of their own shipment only');

reset role;
select is((select label from public.addresses where id = pg_temp.mu(14402)), 'Home',
  'addresses: another user''s address is unchanged');
select is((select label from public.addresses where id = pg_temp.mu(14401)), 'Updated',
  'addresses: the own update is stored');
select is((select name from public.products where id = pg_temp.mu(14301)), 'Renamed by owner',
  'products: the owner''s rename is stored');

-- 2. Buyer --------------------------------------------------------------------------
select pg_temp.as_user(14002);
set local role authenticated;

select is(pg_temp.short_ids(array(select id from public.addresses
    where id in (pg_temp.mu(14401), pg_temp.mu(14402), pg_temp.mu(14403), pg_temp.mu(14404)))), '{14402}',
  'addresses: the buyer sees only their own address');
select is((select count(*)::integer from public.shipments
    where id in (pg_temp.mu(14101), pg_temp.mu(14102))), 2,
  'shipments: the buyer sees both shipments of their order');
select is((select count(*)::integer from public.orders where id = pg_temp.mu(14201)), 1,
  'orders: the buyer sees their order');
select is((select count(*)::integer from public.order_items where order_id = pg_temp.mu(14201)), 2,
  'order_items: the buyer sees both items of their order');
select is((select count(*)::integer from public.shipment_tracking_events
    where shipment_id in (pg_temp.mu(14101), pg_temp.mu(14102))), 2,
  'shipment_tracking_events: the buyer sees the events of both shipments');
select is((select count(*)::integer from public.profiles_private
    where id in (select pg_temp.mu(n) from generate_series(14001, 14006) n)), 1,
  'profiles_private: a user sees only their own row');

-- 3. Seller B -----------------------------------------------------------------------
select pg_temp.as_user(14006);
set local role authenticated;

select is(pg_temp.short_ids(array(select id from public.shipments
    where id in (pg_temp.mu(14101), pg_temp.mu(14102)))), '{14102}',
  'shipments: the second seller sees only their own shipment');
select is(pg_temp.short_ids(array(select id from public.products
    where id in (pg_temp.mu(14101), pg_temp.mu(14102), pg_temp.mu(14301)))), '{14102}',
  'products: the second seller does not see seller A''s listings');
select lives_ok(
  format($$update public.products set name = 'Renamed by seller B' where id = %L$$, pg_temp.mu(14301)),
  'products: updating another seller''s listing raises nothing (RLS filters it)');
select is((select count(*)::integer from public.shipment_tracking_events
    where shipment_id in (pg_temp.mu(14101), pg_temp.mu(14102))), 1,
  'shipment_tracking_events: the second seller sees the events of their own shipment only');

reset role;
select is((select name from public.products where id = pg_temp.mu(14301)), 'Renamed by owner',
  'products: another seller''s update leaves the listing unchanged');

-- 4. Unrelated user -----------------------------------------------------------------
select pg_temp.as_user(14004);
set local role authenticated;

select is((select count(*)::integer from public.addresses
    where id in (pg_temp.mu(14401), pg_temp.mu(14402), pg_temp.mu(14403), pg_temp.mu(14404))), 0,
  'addresses: an unrelated user sees no one else''s address');
select is((select count(*)::integer from public.shipments
    where id in (pg_temp.mu(14101), pg_temp.mu(14102))), 0,
  'shipments: an unrelated user sees none');
select is((select count(*)::integer from public.orders where id = pg_temp.mu(14201)), 0,
  'orders: an unrelated user sees none');
select is((select count(*)::integer from public.order_items where order_id = pg_temp.mu(14201)), 0,
  'order_items: an unrelated user sees none');
select is((select count(*)::integer from public.products
    where id in (pg_temp.mu(14101), pg_temp.mu(14102), pg_temp.mu(14301))), 0,
  'products: an unrelated user sees no row of the base table');
select is((select count(*)::integer from public.profiles
    where id in (select pg_temp.mu(n) from generate_series(14001, 14006) n)), 6,
  'profiles: an unrelated user sees every public profile');
select is((select count(*)::integer from public.shipment_tracking_events
    where shipment_id in (pg_temp.mu(14101), pg_temp.mu(14102))), 0,
  'shipment_tracking_events: an unrelated user sees none');

-- 5. Admin --------------------------------------------------------------------------
select pg_temp.as_user(14003);
set local role authenticated;

select is((select count(*)::integer from public.addresses
    where id in (pg_temp.mu(14401), pg_temp.mu(14402), pg_temp.mu(14403), pg_temp.mu(14404))), 4,
  'addresses: an admin sees every address');
select is((select count(*)::integer from public.shipments
    where id in (pg_temp.mu(14101), pg_temp.mu(14102))), 2,
  'shipments: an admin sees both shipments');
select is((select count(*)::integer from public.orders where id = pg_temp.mu(14201)), 1,
  'orders: an admin sees the order');
select is((select count(*)::integer from public.order_items where order_id = pg_temp.mu(14201)), 2,
  'order_items: an admin sees both items');
select is((select count(*)::integer from public.products
    where id in (pg_temp.mu(14101), pg_temp.mu(14102), pg_temp.mu(14301))), 3,
  'products: an admin sees every listing');
select lives_ok(
  format($$update public.products set name = 'Renamed by admin' where id = %L$$, pg_temp.mu(14301)),
  'products: an admin renames a seller''s verified listing');
select is((select count(*)::integer from public.profiles_private
    where id in (select pg_temp.mu(n) from generate_series(14001, 14006) n)), 6,
  'profiles_private: an admin sees every row');
select is((select count(*)::integer from public.shipment_tracking_events
    where shipment_id in (pg_temp.mu(14101), pg_temp.mu(14102))), 2,
  'shipment_tracking_events: an admin sees the events of both shipments');

reset role;
select is((select name from public.products where id = pg_temp.mu(14301)), 'Renamed by admin',
  'products: the admin''s rename is stored');

-- 6. Suspended admin ----------------------------------------------------------------
select pg_temp.as_user(14005);
set local role authenticated;

select is((select count(*)::integer from public.addresses
    where id in (pg_temp.mu(14401), pg_temp.mu(14402), pg_temp.mu(14403), pg_temp.mu(14404))), 0,
  'addresses: a suspended admin sees no one else''s address');
select is((select count(*)::integer from public.shipments
    where id in (pg_temp.mu(14101), pg_temp.mu(14102))), 0,
  'shipments: a suspended admin sees none');
select is((select count(*)::integer from public.products
    where id in (pg_temp.mu(14101), pg_temp.mu(14102), pg_temp.mu(14301))), 0,
  'products: a suspended admin sees no listing');
select lives_ok(
  format($$update public.products set name = 'Renamed by suspended admin' where id = %L$$, pg_temp.mu(14301)),
  'products: a suspended admin''s update raises nothing (RLS filters it)');
select is((select count(*)::integer from public.profiles_private
    where id in (select pg_temp.mu(n) from generate_series(14001, 14006) n)), 1,
  'profiles_private: a suspended admin sees only their own row');

reset role;
select is((select name from public.products where id = pg_temp.mu(14301)), 'Renamed by admin',
  'products: a suspended admin''s update leaves the listing unchanged');

-- 7. Anon ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

select is((select count(*)::integer from public.profiles
    where id in (select pg_temp.mu(n) from generate_series(14001, 14006) n)), 6,
  'profiles: anon sees every public profile');

reset role;

select * from finish();
rollback;
