-- Single-payment settlement (#276 T5): fn_create_shipments_from_single_payment
-- validates the allocation, creates the order shell before the allocation, then
-- writes one paid shipment per row with its order item and SOLD listing, and
-- notifies the buyer and every seller once. A replay is a duplicate; an
-- allocation failure keeps the shell with payment_processing for recovery and
-- returns a typed payload; a later call on that shell settles it. Also: the
-- retired grouped settlement, the settlement columns and indexes, and where
-- admin_connect_payout_release_view reads the transfer identifiers.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(38);
\ir ../fixtures/money.psql

-- Users: 5001 buyer, 5002 seller A, 5003 seller B, 5004 another buyer.
select pg_temp.money_user(n) from generate_series(5001, 5004) n;

-- An address of p_user.
create function pg_temp.address(p_n integer, p_user integer) returns uuid language sql as $$
  insert into public.addresses (id, user_id, full_name, phone, street_line1, city, state, zip_code, label)
  values (pg_temp.mu(p_n), pg_temp.mu(p_user), 'Test Buyer', '5555555555', 'Calle 1', 'CDMX', 'CDMX', '06600', 'Casa')
  returning id
$$;

-- A listing of p_seller at p_price_cents in status p_status (RESERVED by checkout).
create function pg_temp.listing(p_n integer, p_seller integer, p_price_cents bigint, p_status text default 'RESERVED')
returns uuid language plpgsql as $$
begin
  perform pg_temp.money_product(p_n, p_seller, p_price_cents);
  update public.products set status = p_status::public.product_status_enum, reserved_at = now()
  where id = pg_temp.mu(p_n);
  return pg_temp.mu(p_n);
end $$;

-- One allocation row, amounts in cents.
create function pg_temp.alloc_row(
  p_seller integer, p_shipment integer, p_products integer[],
  p_gross bigint, p_commission bigint, p_shipping bigint, p_net bigint
) returns jsonb language sql as $$
  select jsonb_build_object('seller_id', pg_temp.mu(p_seller), 'shipment_id', pg_temp.mu(p_shipment),
    'product_ids', coalesce((select jsonb_agg(pg_temp.mu(n)) from unnest(p_products) n), '[]'::jsonb),
    'gross_cents', p_gross, 'commission_cents', p_commission, 'shipping_cents', p_shipping, 'net_cents', p_net)
$$;

-- Settles p_pi for buyer p_buyer; p_order_key is order_id or order_group_id.
create function pg_temp.settle(
  p_pi text, p_charge text, p_amount bigint, p_group text,
  p_buyer integer, p_address integer, p_order integer, p_rows jsonb, p_order_key text default 'order_id'
) returns jsonb language sql as $$
  select public.fn_create_shipments_from_single_payment(p_pi, p_charge, p_amount, p_group,
    jsonb_build_object('buyer_id', pg_temp.mu(p_buyer), 'address_id', pg_temp.mu(p_address),
      p_order_key, pg_temp.mu(p_order), 'rows', p_rows))
$$;

-- The typed recovery payload of an allocation failure.
create function pg_temp.recovery(p_order integer, p_error text, p_code text) returns jsonb language sql as $$
  select jsonb_build_object('success', false, 'order_id', pg_temp.mu(p_order), 'status', 'payment_processing',
    'error', p_error, 'failure_code', p_code, 'runtime_version', 'single_modal_settlement_v2')
$$;

-- status|payment_processing|reason|total cents|fee cents|charge|group of an order.
create function pg_temp.order_row(p_order integer) returns text language sql as $$
  select o.status::text || '|' || o.payment_processing::text || '|' || coalesce(o.payment_processing_reason, '-')
    || '|' || o.total_amount_cents::text || '|' || o.service_fee_amount_cents::text
    || '|' || coalesce(o.stripe_charge_id, '-') || '|' || coalesce(o.stripe_transfer_group, '-')
  from public.orders o where o.id = pg_temp.mu(p_order)
$$;

select pg_temp.address(5101, 5001);
select pg_temp.address(5102, 5004);
select pg_temp.listing(5201, 5002, 100000);
select pg_temp.listing(5202, 5003, 250000);
select pg_temp.listing(5203, 5001, 50000);
select pg_temp.listing(5211, 5002, 100000);
select pg_temp.listing(5212, 5003, 100000, 'VERIFIED');
select pg_temp.listing(5221, 5002, 100000);
select pg_temp.listing(5222, 5002, 100000);
select pg_temp.listing(5231, 5003, 100000);
select pg_temp.listing(5241, 5002, 100000);
select pg_temp.listing(5251, 5002, 100000);
select pg_temp.listing(5261, 5002, 100000);
select pg_temp.listing(5271, 5002, 100000);
select pg_temp.listing(5272, 5003, 100000);

-- 1. Grants, security mode and signature ---------------------------------------------
select is(
  (select has_function_privilege('anon', p.oid, 'execute')::text || ':'
     || has_function_privilege('authenticated', p.oid, 'execute')::text || ':'
     || has_function_privilege('service_role', p.oid, 'execute')::text
   from pg_proc p where p.oid = 'public.fn_create_shipments_from_single_payment(text, text, bigint, text, jsonb)'::regprocedure),
  'false:false:true', 'settle: only service_role can execute fn_create_shipments_from_single_payment');
select is(
  (select pg_get_function_arguments(p.oid) || ' -> ' || pg_get_function_result(p.oid) || ' | '
     || p.prosecdef::text || ' | ' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.oid = 'public.fn_create_shipments_from_single_payment(text, text, bigint, text, jsonb)'::regprocedure),
  'p_stripe_payment_intent_id text, p_stripe_charge_id text, p_amount_received bigint, p_transfer_group text, p_allocation jsonb -> jsonb | true | search_path=public',
  'settle: the platform PaymentIntent signature, security definer with search_path public');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

-- 2. Validation raises before any write ---------------------------------------------
select throws_ok(
  $$select public.fn_create_shipments_from_single_payment('pi_t5_v1', 'ch_v', 100, 'tg_v',
    jsonb_build_object('address_id', pg_temp.mu(5101), 'order_id', pg_temp.mu(5490), 'rows', '[]'::jsonb))$$,
  'P0001', 'BUYER_ID_REQUIRED', 'settle: an allocation without buyer_id raises BUYER_ID_REQUIRED');
select throws_ok(
  $$select public.fn_create_shipments_from_single_payment('pi_t5_v2', 'ch_v', 100, 'tg_v',
    jsonb_build_object('buyer_id', pg_temp.mu(5001), 'address_id', '', 'order_id', pg_temp.mu(5490), 'rows', '[]'::jsonb))$$,
  'P0001', 'ADDRESS_ID_REQUIRED', 'settle: an empty address_id raises ADDRESS_ID_REQUIRED');
select throws_ok(
  $$select public.fn_create_shipments_from_single_payment('pi_t5_v3', 'ch_v', 100, 'tg_v',
    jsonb_build_object('buyer_id', pg_temp.mu(5001), 'address_id', pg_temp.mu(5101), 'order_id', '', 'rows', '[]'::jsonb))$$,
  'P0001', 'ORDER_ID_REQUIRED', 'settle: neither order_id nor order_group_id raises ORDER_ID_REQUIRED');
select throws_ok(
  $$select pg_temp.settle('pi_t5_v4', 'ch_v', 100, 'tg_v', 5001, 5102, 5490, '[]'::jsonb)$$,
  'P0001', 'ADDRESS_NOT_FOUND_OR_UNAUTHORIZED', 'settle: an address of another user raises ADDRESS_NOT_FOUND_OR_UNAUTHORIZED');
select is((select count(*) from public.orders where stripe_payment_intent_id like 'pi_t5_v%'), 0::bigint,
  'settle: a validation error creates no order');

-- 3. A two-seller settlement ----------------------------------------------------------
-- Seller A: 1,000.00 gross, 100.00 commission, 150.00 shipping, 750.00 net.
-- Seller B: 2,500.00 gross, 250.00 commission, 200.00 shipping, 2,050.00 net.
-- The buyer paid 3,600.00 (the products plus Seguro Selene).
create temp table t5_rows on commit drop as select jsonb_build_array(
  pg_temp.alloc_row(5002, 5301, array[5201], 100000, 10000, 15000, 75000),
  pg_temp.alloc_row(5003, 5302, array[5202], 250000, 25000, 20000, 205000)) as r;
select is(pg_temp.settle('pi_t5_1', 'ch_t5_1', 360000, 'tg_t5_1', 5001, 5101, 5401, (select r from t5_rows)),
  jsonb_build_object('success', true, 'order_id', pg_temp.mu(5401), 'status', 'created'),
  'settle: a valid allocation returns created with the order id');
select is(pg_temp.order_row(5401), 'paid|false|-|360000|35000|ch_t5_1|tg_t5_1',
  'settle: the order is paid with the received total, the commission sum as service fee, the charge and the transfer group');
select is(
  (select o.buyer_id = pg_temp.mu(5001) and o.shipping_address = to_jsonb(a.*)
   from public.orders o, public.addresses a where o.id = pg_temp.mu(5401) and a.id = pg_temp.mu(5101)),
  true, 'settle: the order belongs to the buyer and snapshots the whole address row');
select is(
  (select string_agg(right(s.id::text, 4) || ':' || right(s.seller_id::text, 4) || ':' || s.status::text || ':'
     || s.stripe_payment_intent_id || ':' || s.shipping_cost::text, ',' order by s.id)
   from public.shipments s where s.order_id = pg_temp.mu(5401)),
  '5301:5002:paid:pi_t5_1:15000,5302:5003:paid:pi_t5_1:20000',
  'settle: one paid shipment per row with the row id, seller, PaymentIntent and shipping cost in cents');
select is(
  (select string_agg(right(oi.product_id::text, 4) || ':' || right(oi.shipment_id::text, 4) || ':' || right(oi.seller_id::text, 4)
     || ':' || oi.price_at_purchase_cents::text || ':' || oi.commission_amount_cents::text
     || ':' || oi.shipping_amount_cents::text || ':' || oi.net_payout_cents::text || ':' || oi.shipping_payer, ',' order by oi.product_id)
   from public.order_items oi where oi.order_id = pg_temp.mu(5401)),
  '5201:5301:5002:100000:10000:15000:75000:seller,5202:5302:5003:250000:25000:20000:205000:seller',
  'settle: each order item carries the row commission, shipping and net in cents, and the seller pays shipping');
select is(
  (select string_agg(status::text, ',' order by id) from public.products where id in (pg_temp.mu(5201), pg_temp.mu(5202))),
  'SOLD,SOLD', 'settle: the reserved listings are SOLD');
select is(
  (select string_agg(right(n.user_id::text, 4) || ':' || n.event_kind || ':' || n.source_event_key || ':'
     || (n.event_payload ->> 'recipient_role') || ':' || (n.event_payload ->> 'order_id') || ':' || n.type || ':'
     || n.title || ':' || n.message || ':' || n.action_path, ',' order by n.user_id)
   from public.notifications n where n.source_event_key = 'order.payment_confirmed:' || pg_temp.mu(5401)),
  format('5001:order.payment_confirmed:order.payment_confirmed:%1$s:buyer:%1$s:success:Compra confirmada:Tu pago fue confirmado.:/profile/orders/%1$s,'
    || '5002:order.payment_confirmed:order.payment_confirmed:%1$s:seller:%1$s:success:Nueva venta confirmada:Recibiste una nueva venta.:/profile/orders/%1$s,'
    || '5003:order.payment_confirmed:order.payment_confirmed:%1$s:seller:%1$s:success:Nueva venta confirmada:Recibiste una nueva venta.:/profile/orders/%1$s',
    pg_temp.mu(5401)),
  'settle: the buyer and each seller get one payment-confirmed notice for the order');

-- 4. Idempotency ---------------------------------------------------------------------
reset role;
-- Whole-row text of the order, its shipments, its items and its notices.
create function pg_temp.order_state(p_order integer) returns text language sql as $$
  select (select o::text from public.orders o where o.id = pg_temp.mu(p_order)) || '#'
    || (select string_agg(s::text, ',' order by s.id) from public.shipments s where s.order_id = pg_temp.mu(p_order)) || '#'
    || (select string_agg(i::text, ',' order by i.id) from public.order_items i where i.order_id = pg_temp.mu(p_order)) || '#'
    || (select string_agg(n::text, ',' order by n.id) from public.notifications n
        where n.source_event_key = 'order.payment_confirmed:' || pg_temp.mu(p_order))
$$;
create temp table t5_sig on commit drop as select pg_temp.order_state(5401) as v;
set local role service_role;
select is(pg_temp.settle('pi_t5_1', 'ch_t5_other', 999, 'tg_t5_other', 5001, 5101, 5499, (select r from t5_rows)),
  jsonb_build_object('success', true, 'order_id', pg_temp.mu(5401), 'status', 'duplicate'),
  'settle: a replay of the PaymentIntent returns duplicate with the first order id');
reset role;
select is(pg_temp.order_state(5401) || '#' || exists (select 1 from public.orders where id = pg_temp.mu(5499))::text,
  (select v from t5_sig) || '#false',
  'settle: the replay rewrites nothing and sends no notice, even with another charge, amount, group or order id');
set local role service_role;
select throws_ok(
  $$select pg_temp.settle('pi_t5_1', 'ch_t5_x', 100, 'tg_t5_x', 5004, 5102, 5498, '[]'::jsonb)$$,
  '23505', null, 'settle: the same PaymentIntent for another buyer is refused by the unique PaymentIntent index');

-- A buyer who also sells in the order is notified once, as the buyer.
create temp table t5_self on commit drop as select pg_temp.settle('pi_t5_3', 'ch_t5_3', 50000, 'tg_t5_3', 5001, 5101, 5403,
  jsonb_build_array(pg_temp.alloc_row(5001, 5303, array[5203], 50000, 5000, 5000, 40000))) as r;
select is(
  (select r ->> 'status' from t5_self) || '|'
  || (select string_agg(right(user_id::text, 4) || ':' || (event_payload ->> 'recipient_role'), ',')
      from public.notifications where source_event_key = 'order.payment_confirmed:' || pg_temp.mu(5403)),
  'created|5001:buyer', 'settle: a buyer who is also the seller of the order gets one notice, as the buyer');

-- 5. Allocation failures keep a recoverable shell ---------------------------------------
-- Order 5402 (named by order_group_id): row 1 is valid, row 2's listing is not reserved.
create temp table t5_rec on commit drop as select jsonb_build_array(
  pg_temp.alloc_row(5002, 5311, array[5211], 100000, 10000, 15000, 75000),
  pg_temp.alloc_row(5003, 5312, array[5212], 100000, 10000, 15000, 75000)) as r;
select is(pg_temp.settle('pi_t5_2', 'ch_t5_2', 200000, 'tg_t5_2', 5001, 5101, 5402, (select r from t5_rec), 'order_group_id'),
  pg_temp.recovery(5402, 'PRODUCT_NOT_RESERVED', 'PRODUCT_NOT_RESERVED'),
  'recovery: a listing that is not reserved returns the typed payload, not an error');
select is(pg_temp.order_row(5402), 'pending|true|PRODUCT_NOT_RESERVED|200000|0|ch_t5_2|tg_t5_2',
  'recovery: the shell, named by order_group_id, stays pending with payment_processing, the reason, total, charge and group');
reset role;
select is(
  (select count(*) from public.shipments where order_id = pg_temp.mu(5402))::text || ':'
    || (select count(*) from public.order_items where order_id = pg_temp.mu(5402))::text || ':'
    || (select string_agg(status::text, ',' order by id) from public.products where id in (pg_temp.mu(5211), pg_temp.mu(5212))) || ':'
    || (select count(*) from public.notifications where source_event_key = 'order.payment_confirmed:' || pg_temp.mu(5402))::text,
  '0:0:RESERVED,VERIFIED:0',
  'recovery: the valid first row is rolled back too: no shipment, no item, no notice, its listing still RESERVED');
set local role service_role;

select is(pg_temp.settle('pi_t5_4', 'ch_t5_4', 200000, 'tg_t5_4', 5001, 5101, 5404,
    jsonb_build_array(pg_temp.alloc_row(5002, 5321, array[5221, 5222], 200000, 20000, 15000, 165000))),
  pg_temp.recovery(5404, 'ONE_PRODUCT_PER_SHIPMENT_REQUIRED', 'ONE_PRODUCT_PER_SHIPMENT_REQUIRED'),
  'recovery: two listings in one row fail with ONE_PRODUCT_PER_SHIPMENT_REQUIRED');
select is(pg_temp.settle('pi_t5_5', 'ch_t5_5', 100000, 'tg_t5_5', 5001, 5101, 5405,
    jsonb_build_array(pg_temp.alloc_row(5002, 5331, array[5231], 100000, 10000, 15000, 75000))),
  pg_temp.recovery(5405, 'PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED', 'PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED'),
  'recovery: a listing of another seller fails with PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED');
select is(pg_temp.settle('pi_t5_6', 'ch_t5_6', 100000, 'tg_t5_6', 5001, 5101, 5406,
    jsonb_build_array(pg_temp.alloc_row(5002, 5341, array[]::integer[], 100000, 10000, 15000, 75000))),
  pg_temp.recovery(5406, 'PRODUCT_IDS_REQUIRED', 'SETTLEMENT_TRANSIENT_FAILURE'),
  'recovery: a row without listings fails, and an error outside the named codes is SETTLEMENT_TRANSIENT_FAILURE');
select is(pg_temp.settle('pi_t5_7', 'ch_t5_7', 100000, 'tg_t5_7', 5001, 5101, 5407,
    jsonb_build_array(jsonb_set(pg_temp.alloc_row(5002, 5351, array[5251], 100000, 10000, 15000, 75000),
      '{commission_cents}', '"abc"'))),
  pg_temp.recovery(5407, 'invalid input syntax for type bigint: "abc"', 'SETTLEMENT_TRANSIENT_FAILURE'),
  'recovery: malformed commission data is caught inside the recovery boundary');
reset role;
create function pg_temp.raise_invalid() returns trigger language plpgsql as $$
begin
  raise exception 'INVALID_TEST_ALLOCATION';
end $$;
create trigger t5_invalid before insert on public.shipments
  for each row when (new.id = 'f0000000-0000-4000-8000-000000005361'::uuid)
  execute function pg_temp.raise_invalid();
set local role service_role;
select is(pg_temp.settle('pi_t5_8', 'ch_t5_8', 100000, 'tg_t5_8', 5001, 5101, 5408,
    jsonb_build_array(pg_temp.alloc_row(5002, 5361, array[5261], 100000, 10000, 15000, 75000))),
  pg_temp.recovery(5408, 'INVALID_TEST_ALLOCATION', 'INVALID_TEST_ALLOCATION'),
  'recovery: an INVALID_ error keeps its own failure code');
reset role;
drop trigger t5_invalid on public.shipments;
set local role service_role;
-- Two rows with one shipment id: the second row writes no shipment, so the count check refuses.
select is(pg_temp.settle('pi_t5_9', 'ch_t5_9', 200000, 'tg_t5_9', 5001, 5101, 5409,
    jsonb_build_array(pg_temp.alloc_row(5002, 5371, array[5271], 100000, 10000, 15000, 75000),
      pg_temp.alloc_row(5003, 5371, array[5272], 100000, 10000, 15000, 75000))),
  pg_temp.recovery(5409, 'INCOMPLETE_PAID_ALLOCATION', 'SETTLEMENT_TRANSIENT_FAILURE'),
  'recovery: fewer paid shipments than rows fails with INCOMPLETE_PAID_ALLOCATION');
reset role;
select is(
  (select count(*) from public.shipments where order_id = pg_temp.mu(5409))::text || ':'
    || (select string_agg(status::text, ',' order by id) from public.products where id in (pg_temp.mu(5271), pg_temp.mu(5272))),
  '0:RESERVED,RESERVED', 'recovery: the incomplete allocation is rolled back, its listings stay RESERVED');

-- 6. A later call settles the shell ------------------------------------------------------
update public.products set status = 'RESERVED' where id = pg_temp.mu(5212);
set local role service_role;
select is(pg_temp.settle('pi_t5_2', 'ch_t5_2b', 200000, 'tg_t5_2b', 5001, 5101, 5402, (select r from t5_rec)),
  jsonb_build_object('success', true, 'order_id', pg_temp.mu(5402), 'status', 'created'),
  'recovery: a later call on the shell settles the same order');
reset role;
select is(pg_temp.order_row(5402), 'paid|false|-|200000|20000|ch_t5_2b|tg_t5_2b',
  'recovery: the settled shell clears payment_processing and its reason and keeps the new charge and group');
select is(
  (select string_agg(right(s.id::text, 4) || ':' || s.status::text, ',' order by s.id) from public.shipments s where s.order_id = pg_temp.mu(5402))
    || '|' || (select count(*) from public.order_items where order_id = pg_temp.mu(5402))::text
    || '|' || (select count(*) from public.notifications where source_event_key = 'order.payment_confirmed:' || pg_temp.mu(5402))::text,
  '5311:paid,5312:paid|2|3', 'recovery: the settled shell has both paid shipments, both items and the three notices');

-- 7. The retired grouped settlement -------------------------------------------------------
select is(
  (select has_function_privilege('anon', p.oid, 'execute')::text || ':'
     || has_function_privilege('authenticated', p.oid, 'execute')::text || ':'
     || has_function_privilege('service_role', p.oid, 'execute')::text
   from pg_proc p where p.oid = 'public.fn_create_shipment_from_payment(text, bigint, jsonb)'::regprocedure),
  'false:false:true', 'retired: only service_role can execute fn_create_shipment_from_payment');
set local role service_role;
select throws_ok(
  $$select public.fn_create_shipment_from_payment('pi_t5_legacy', 100000,
    jsonb_build_object('buyer_id', pg_temp.mu(5001), 'seller_id', pg_temp.mu(5002), 'product_ids', '[]'))$$,
  'P0001', 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED', 'retired: the grouped settlement always raises, so it writes nothing');
reset role;

-- 8. Settlement columns and indexes --------------------------------------------------------
select is(
  (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'),
     ',' order by table_name, column_name)
   from information_schema.columns
   where table_schema = 'public' and (table_name, column_name) in (('orders', 'stripe_charge_id'),
     ('orders', 'stripe_transfer_group'), ('orders', 'payment_processing'), ('orders', 'payment_processing_reason'),
     ('shipments', 'stripe_transfer_id'))),
  'orders.payment_processing:boolean:NO:false,orders.payment_processing_reason:text:YES:-,orders.stripe_charge_id:text:YES:-,'
    || 'orders.stripe_transfer_group:text:YES:-,shipments.stripe_transfer_id:text:YES:-',
  'columns: the settlement columns, with payment_processing NOT NULL DEFAULT false');
select is(
  (select string_agg(indexname || ':' || regexp_replace(indexdef, '^.* USING ', ''), ',' order by indexname)
   from pg_indexes where schemaname = 'public' and indexname in (
     'idx_orders_stripe_transfer_group_unique', 'idx_orders_payment_processing', 'idx_orders_stripe_charge_id',
     'idx_shipments_stripe_transfer_id')),
  'idx_orders_payment_processing:btree (payment_processing) WHERE (payment_processing = true),'
    || 'idx_orders_stripe_charge_id:btree (stripe_charge_id) WHERE (stripe_charge_id IS NOT NULL),'
    || 'idx_orders_stripe_transfer_group_unique:btree (stripe_transfer_group) WHERE (stripe_transfer_group IS NOT NULL),'
    || 'idx_shipments_stripe_transfer_id:btree (stripe_transfer_id) WHERE (stripe_transfer_id IS NOT NULL)',
  'indexes: the settlement lookup and recovery indexes are partial');
select throws_ok(
  $$insert into public.orders (buyer_id, total_amount_cents, shipping_address, status, stripe_transfer_group)
    values (pg_temp.mu(5004), 1, '{}'::jsonb, 'pending', 'tg_t5_1')$$,
  '23505', null, 'columns: two orders cannot share a transfer group');
select is(
  (select count(*) from unnest(enum_range(null::public.order_status_enum)) v where v::text = 'payment_processing'),
  0::bigint, 'columns: payment_processing is a flag, not an order status');

-- 9. The release view reads each transfer identifier at its own level ------------------------
update public.shipments set stripe_transfer_id = 'tr_t5_' || right(id::text, 4)
where id in (pg_temp.mu(5301), pg_temp.mu(5302));
select is(
  (select string_agg(right(v.shipment_id::text, 4) || ':' || v.transfer_group || ':' || v.stripe_transfer_id, ',' order by v.shipment_id)
   from public.admin_connect_payout_release_view v where v.order_id = pg_temp.mu(5401)),
  '5301:tg_t5_1:tr_t5_5301,5302:tg_t5_1:tr_t5_5302',
  'view: transfer_group comes from the order and stripe_transfer_id from each shipment');

select * from finish();
rollback;
