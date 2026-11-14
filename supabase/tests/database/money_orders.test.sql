-- Orders and order items store money as integer cents; the settlement writes
-- cents with no pesos conversion, and the payout release view reads them
-- directly (odd/tasks/money-integer-cents.md S2, S4, S5, S8, T3).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(26);
\ir ../fixtures/money.psql

-- Users: 1 buyer, 2 seller.
select pg_temp.money_user(1);
select pg_temp.money_user(2);

insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label)
values (pg_temp.mu(31), pg_temp.mu(1), 'Test Buyer', '5555555555', 'Calle 1', 'CDMX', 'CDMX', '06600', 'Casa');

-- Three RESERVED listings of seller 2 whose prices do not split evenly.
select pg_temp.money_product(n, 2, p)
from (values (11, 33333::bigint), (12, 33333::bigint), (13, 33335::bigint)) v(n, p);
update public.products set status = 'RESERVED', reserved_at = now()
where id in (pg_temp.mu(11), pg_temp.mu(12), pg_temp.mu(13));

-- Columns ------------------------------------------------------------------------
select col_type_is('public', 'orders', 'total_amount_cents', 'bigint', 'orders.total_amount_cents is bigint');
select col_not_null('public', 'orders', 'total_amount_cents', 'orders.total_amount_cents is NOT NULL');
select col_hasnt_default('public', 'orders', 'total_amount_cents', 'orders.total_amount_cents has no default');
select col_type_is('public', 'order_items', 'price_at_purchase_cents', 'bigint', 'order_items.price_at_purchase_cents is bigint');
select col_not_null('public', 'order_items', 'price_at_purchase_cents', 'order_items.price_at_purchase_cents is NOT NULL');
select col_hasnt_default('public', 'order_items', 'price_at_purchase_cents', 'order_items.price_at_purchase_cents has no default');
select is(
  (select string_agg(c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || c.column_default,
     ',' order by c.table_name, c.column_name)
   from information_schema.columns c
   where c.table_schema = 'public'
     and (c.table_name, c.column_name) in (('orders', 'service_fee_amount_cents'),
       ('order_items', 'commission_amount_cents'), ('order_items', 'shipping_amount_cents'),
       ('order_items', 'net_payout_cents'))),
  'order_items.commission_amount_cents:bigint:NO:0,order_items.net_payout_cents:bigint:NO:0,'
    || 'order_items.shipping_amount_cents:bigint:NO:0,orders.service_fee_amount_cents:bigint:NO:0',
  'the four fee and payout cents columns are bigint NOT NULL DEFAULT 0');
select is(
  (select coalesce(string_agg(c.table_name || '.' || c.column_name, ',' order by c.table_name, c.column_name), '-')
   from information_schema.columns c
   where c.table_schema = 'public'
     and (c.table_name, c.column_name) in (('orders', 'total_amount'), ('orders', 'service_fee_amount'),
       ('order_items', 'price_at_purchase'), ('order_items', 'commission_amount'),
       ('order_items', 'shipping_amount'), ('order_items', 'net_payout'),
       ('order_items', 'insurance_amount'), ('order_items', 'sat_tax_withholding'))),
  '-', 'no pesos column remains, and insurance_amount and sat_tax_withholding are dropped');
select is(
  (select string_agg(conname, ',' order by conname) from pg_constraint
   where contype = 'c' and conrelid in ('public.orders'::regclass, 'public.order_items'::regclass)
     and conname like '%\_cents\_check'),
  'order_items_commission_amount_cents_check,order_items_net_payout_cents_check,'
    || 'order_items_price_at_purchase_cents_check,order_items_shipping_amount_cents_check,'
    || 'orders_service_fee_amount_cents_check,orders_total_amount_cents_check',
  'each cents column has its named non-negative check');

-- Views ----------------------------------------------------------------------------
select has_column('public', 'admin_disputes_monitor_view', 'total_amount_cents', 'admin_disputes_monitor_view exposes total_amount_cents');
select hasnt_column('public', 'admin_disputes_monitor_view', 'total_amount', 'admin_disputes_monitor_view has no pesos total');

-- Settlement writes integer cents --------------------------------------------------
-- One seller, three shipments. Gross 1,000.01; commission 60.00; shipping 450.00.
-- The buyer paid 1,034.57 (the products plus Seguro Selene).
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
create temp table mo_rows on commit drop as select jsonb_agg(jsonb_build_object(
    'seller_id', pg_temp.mu(2), 'shipment_id', pg_temp.mu(v.ship), 'product_ids', jsonb_build_array(pg_temp.mu(v.prod)),
    'gross_cents', v.g, 'commission_cents', v.c, 'shipping_cents', v.s, 'net_cents', v.g - v.c - v.s) order by v.ship) as r
  from (values (21, 11, 33333, 2000, 15001), (22, 12, 33333, 1999, 15000), (23, 13, 33335, 2001, 14999)) v(ship, prod, g, c, s);
select is(
  public.fn_create_shipments_from_single_payment('pi_mo_1', 'ch_mo_1', 103457, 'tg_mo_1',
    jsonb_build_object('buyer_id', pg_temp.mu(1), 'address_id', pg_temp.mu(31), 'order_id', pg_temp.mu(41),
      'rows', (select r from mo_rows))) ->> 'status',
  'created', 'settle: a three-shipment allocation of one seller settles');
reset role;
select is(
  (select o.total_amount_cents::text || ':' || o.service_fee_amount_cents::text from public.orders o where o.id = pg_temp.mu(41)),
  '103457:6000', 'settle: total_amount_cents is p_amount_received and service_fee_amount_cents is the commission sum');
select is(
  (select string_agg(right(oi.product_id::text, 2) || ':' || right(oi.shipment_id::text, 2) || ':' || oi.price_at_purchase_cents
     || ':' || oi.commission_amount_cents || ':' || oi.shipping_amount_cents || ':' || oi.net_payout_cents, ',' order by oi.product_id)
   from public.order_items oi where oi.order_id = pg_temp.mu(41)),
  '11:21:33333:2000:15001:16332,12:22:33333:1999:15000:16334,13:23:33335:2001:14999:16335',
  'settle: each order item stores its price, commission, shipping and net payout as integer cents');
select is(
  (select count(*) from public.shipments s
   join (select shipment_id, sum(commission_amount_cents) c, sum(shipping_amount_cents) sh, sum(net_payout_cents) n,
           sum(price_at_purchase_cents) p
         from public.order_items where order_id = pg_temp.mu(41) group by shipment_id) i on i.shipment_id = s.id
   join lateral (select (x ->> 'gross_cents')::bigint g, (x ->> 'commission_cents')::bigint c,
                   (x ->> 'shipping_cents')::bigint sh, (x ->> 'net_cents')::bigint n
                 from jsonb_array_elements((select r from mo_rows)) x
                 where (x ->> 'shipment_id')::uuid = s.id) a on true
   where s.order_id = pg_temp.mu(41)
     and i.c = a.c and i.sh = a.sh and i.n = a.n and i.sh = s.shipping_cost and i.p = a.g),
  3::bigint, 'settle: per shipment, the item cents sum exactly to the allocated commission, shipping and net payout');
select is(
  (select sum(commission_amount_cents)::bigint from public.order_items where order_id = pg_temp.mu(41)),
  (select service_fee_amount_cents from public.orders where id = pg_temp.mu(41)),
  'settle: the item commissions sum exactly to the order service fee');

-- Negative cents are rejected ----------------------------------------------------
select throws_ok($$update public.orders set total_amount_cents = -1 where id = pg_temp.mu(41)$$,
  '23514', null, 'a negative orders.total_amount_cents is rejected');
select throws_ok($$update public.orders set service_fee_amount_cents = -1 where id = pg_temp.mu(41)$$,
  '23514', null, 'a negative orders.service_fee_amount_cents is rejected');
select throws_ok($$update public.order_items set price_at_purchase_cents = -1 where product_id = pg_temp.mu(11)$$,
  '23514', null, 'a negative order_items.price_at_purchase_cents is rejected');
select throws_ok($$update public.order_items set commission_amount_cents = -1 where product_id = pg_temp.mu(11)$$,
  '23514', null, 'a negative order_items.commission_amount_cents is rejected');
select throws_ok($$update public.order_items set shipping_amount_cents = -1 where product_id = pg_temp.mu(11)$$,
  '23514', null, 'a negative order_items.shipping_amount_cents is rejected');
select throws_ok($$update public.order_items set net_payout_cents = -1 where product_id = pg_temp.mu(11)$$,
  '23514', null, 'a negative order_items.net_payout_cents is rejected');

-- admin_connect_payout_release_view ----------------------------------------------
-- With a transfer group (single-modal checkout), release_amount_cents is the plain
-- sum of net_payout_cents; without one (legacy order), the shipment's cents
-- shipping_cost is subtracted. Both floor at 0.
select is(
  (select string_agg(right(shipment_id::text, 2) || ':' || release_amount_cents, ',' order by shipment_id)
   from public.admin_connect_payout_release_view where order_id = pg_temp.mu(41)),
  '21:16332,22:16334,23:16335', 'release view: a transfer-group shipment releases sum(net_payout_cents)');

select pg_temp.money_product(14, 2, 100000);
insert into public.orders (id, buyer_id, total_amount_cents, shipping_address, status, stripe_payment_intent_id)
values (pg_temp.mu(42), pg_temp.mu(1), 100000, '{}'::jsonb, 'completed', 'pi_mo_legacy');
insert into public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id, shipping_cost)
values (pg_temp.mu(24), pg_temp.mu(42), pg_temp.mu(2), 'completed', 'pi_mo_legacy', 15000);
insert into public.order_items (order_id, product_id, seller_id, price_at_purchase_cents, net_payout_cents, shipment_id)
values (pg_temp.mu(42), pg_temp.mu(14), pg_temp.mu(2), 100000, 90001, pg_temp.mu(24));
select is(
  (select release_amount_cents from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(24)),
  75001, 'release view: a legacy shipment releases sum(net_payout_cents) - shipping_cost');
update public.shipments set shipping_cost = 95000 where id = pg_temp.mu(24);
select is(
  (select release_amount_cents from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(24)),
  0, 'release view: a legacy shipment whose shipping cost exceeds the payout releases 0');
select col_type_is('public', 'admin_connect_payout_release_view', 'release_amount_cents', 'integer',
  'release view: release_amount_cents keeps its integer type');

select * from finish();
rollback;
