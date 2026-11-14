-- Client roles read orders, order items and disputes but never write them;
-- server code (service role, SECURITY DEFINER RPCs) does. A buyer reviews a
-- seller only for a completed shipment of that seller in the buyer's order.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(35);

-- Same economics formula as validate_product_publication_economics.
create function pg_temp.make_product(p_id uuid, p_seller uuid)
returns void language sql as $$
  insert into public.products (
    id, name, description, price_cents, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost_cents, origin_zip, package_preset,
    publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select p_id, 'Test GPU', 'Test listing', 100000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], 'SOLD'::public.product_status_enum, '{}'::jsonb, p_seller, 10000, '06600', 'gpu_1',
    10000::bigint + s.shipping_buffer_cents
      + ceil(100000::numeric * s.insurance_rate)::bigint,
    s.service_fee_pct,
    s.insurance_rate
  from public.system_settings s where s.id = 1
$$;

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('e1000000-0000-4000-8000-000000000001'::uuid, 'ctw_buyer@test.local', 'ctw_buyer'),
  ('e1000000-0000-4000-8000-000000000002'::uuid, 'ctw_seller_done@test.local', 'ctw_seller_done'),
  ('e1000000-0000-4000-8000-000000000003'::uuid, 'ctw_seller_open@test.local', 'ctw_seller_open'),
  ('e1000000-0000-4000-8000-000000000004'::uuid, 'ctw_stranger@test.local', 'ctw_stranger')
) as u(id, email, username);

-- Order 1: a completed shipment (seller_done) and a delivered one (seller_open).
-- Order 2: a delivered shipment of seller_done with an open dispute.
insert into public.orders (id, buyer_id, total_amount, shipping_address)
values
  ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000001', 2000, '{}'::jsonb),
  ('e1000000-0000-4000-8000-0000000b0002', 'e1000000-0000-4000-8000-000000000001', 1000, '{}'::jsonb);
insert into public.shipments (id, order_id, seller_id, status, completed_at, stripe_payment_intent_id)
values
  ('e1000000-0000-4000-8000-0000000c0001', 'e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000002', 'completed', now(), 'pi_test_ctw_1'),
  ('e1000000-0000-4000-8000-0000000c0002', 'e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000003', 'delivered', null, 'pi_test_ctw_2'),
  ('e1000000-0000-4000-8000-0000000c0003', 'e1000000-0000-4000-8000-0000000b0002', 'e1000000-0000-4000-8000-000000000002', 'delivered', null, 'pi_test_ctw_3');
select pg_temp.make_product('e1000000-0000-4000-8000-0000000a0001', 'e1000000-0000-4000-8000-000000000002');
select pg_temp.make_product('e1000000-0000-4000-8000-0000000a0002', 'e1000000-0000-4000-8000-000000000003');
select pg_temp.make_product('e1000000-0000-4000-8000-0000000a0003', 'e1000000-0000-4000-8000-000000000002');
insert into public.order_items (order_id, product_id, seller_id, price_at_purchase, net_payout, shipment_id)
values
  ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-0000000a0001', 'e1000000-0000-4000-8000-000000000002', 1000, 900, 'e1000000-0000-4000-8000-0000000c0001'),
  ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-0000000a0002', 'e1000000-0000-4000-8000-000000000003', 1000, 900, 'e1000000-0000-4000-8000-0000000c0002'),
  ('e1000000-0000-4000-8000-0000000b0002', 'e1000000-0000-4000-8000-0000000a0003', 'e1000000-0000-4000-8000-000000000002', 1000, 900, 'e1000000-0000-4000-8000-0000000c0003');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
insert into public.disputes (id, order_id, buyer_id, seller_id, reason, description, shipment_id)
values ('e1000000-0000-4000-8000-0000000d0001', 'e1000000-0000-4000-8000-0000000b0002',
  'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002',
  'damaged', 'Buyer dispute', 'e1000000-0000-4000-8000-0000000c0003');

-- Baseline as stored before any client attempt.
create temp table before_state on commit drop as
select
  (select count(*) from public.orders where buyer_id = 'e1000000-0000-4000-8000-000000000001') as orders,
  (select count(*) from public.order_items where order_id in ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-0000000b0002')) as items,
  (select count(*) from public.disputes where buyer_id = 'e1000000-0000-4000-8000-000000000001') as disputes,
  (select status::text from public.orders where id = 'e1000000-0000-4000-8000-0000000b0001') as order_status,
  (select total_amount from public.orders where id = 'e1000000-0000-4000-8000-0000000b0001') as order_total,
  (select status::text from public.disputes where id = 'e1000000-0000-4000-8000-0000000d0001') as dispute_status,
  (select price_at_purchase from public.order_items where product_id = 'e1000000-0000-4000-8000-0000000a0001') as item_price;

-- The buyer (authenticated) cannot write orders, order items or disputes.
select pg_temp.as_user('e1000000-0000-4000-8000-000000000001');
set local role authenticated;

select throws_ok(
  $$insert into public.orders (buyer_id, total_amount, shipping_address, status)
    values ('e1000000-0000-4000-8000-000000000001', 1, '{}'::jsonb, 'paid')$$,
  '42501', 'permission denied for table orders', 'authenticated cannot insert orders');
select throws_ok(
  $$update public.orders set total_amount = 1 where id = 'e1000000-0000-4000-8000-0000000b0001'$$,
  '42501', 'permission denied for table orders', 'authenticated cannot update orders');
select throws_ok(
  $$delete from public.orders where id = 'e1000000-0000-4000-8000-0000000b0001'$$,
  '42501', 'permission denied for table orders', 'authenticated cannot delete orders');
select throws_ok(
  $$insert into public.order_items (order_id, product_id, seller_id, price_at_purchase)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-0000000a0003', 'e1000000-0000-4000-8000-000000000002', 1)$$,
  '42501', 'permission denied for table order_items', 'authenticated cannot insert order items');
select throws_ok(
  $$update public.order_items set price_at_purchase = 1 where product_id = 'e1000000-0000-4000-8000-0000000a0001'$$,
  '42501', 'permission denied for table order_items', 'authenticated cannot update order items');
select throws_ok(
  $$delete from public.order_items where product_id = 'e1000000-0000-4000-8000-0000000a0001'$$,
  '42501', 'permission denied for table order_items', 'authenticated cannot delete order items');
select throws_ok(
  $$insert into public.disputes (order_id, buyer_id, seller_id, reason, description, shipment_id)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000003', 'damaged', 'Forged', 'e1000000-0000-4000-8000-0000000c0002')$$,
  '42501', 'permission denied for table disputes', 'authenticated cannot insert disputes');
select throws_ok(
  $$update public.disputes set status = 'resolved' where id = 'e1000000-0000-4000-8000-0000000d0001'$$,
  '42501', 'permission denied for table disputes', 'the dispute buyer cannot update it');
select throws_ok(
  $$delete from public.disputes where id = 'e1000000-0000-4000-8000-0000000d0001'$$,
  '42501', 'permission denied for table disputes', 'authenticated cannot delete disputes');

-- Reads keep working for the buyer.
select is((select count(*) from public.orders), 2::bigint, 'the buyer still reads their orders');
select is((select count(*) from public.order_items), 3::bigint, 'the buyer still reads their order items');
select is((select count(*) from public.disputes), 1::bigint, 'the buyer still reads their dispute');

-- The dispute seller cannot update it either.
select pg_temp.as_user('e1000000-0000-4000-8000-000000000002');
select throws_ok(
  $$update public.disputes set status = 'resolved' where id = 'e1000000-0000-4000-8000-0000000d0001'$$,
  '42501', 'permission denied for table disputes', 'the dispute seller cannot update it');
select is((select count(*) from public.disputes), 1::bigint, 'the dispute seller still reads it');
reset role;

-- anon cannot write them.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$insert into public.orders (buyer_id, total_amount, shipping_address)
    values ('e1000000-0000-4000-8000-000000000001', 1, '{}'::jsonb)$$,
  '42501', 'permission denied for table orders', 'anon cannot insert orders');
select throws_ok(
  $$insert into public.disputes (order_id, buyer_id, seller_id, reason, description)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000003', 'damaged', 'Forged')$$,
  '42501', 'permission denied for table disputes', 'anon cannot insert disputes');
select throws_ok(
  $$update public.order_items set price_at_purchase = 1$$,
  '42501', 'permission denied for table order_items', 'anon cannot update order items');
reset role;

-- Nothing the client roles tried reached the stored rows.
select is(
  (select row(orders, items, disputes, order_status, order_total, dispute_status, item_price)::text from before_state),
  (select row(
    (select count(*) from public.orders where buyer_id = 'e1000000-0000-4000-8000-000000000001'),
    (select count(*) from public.order_items where order_id in ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-0000000b0002')),
    (select count(*) from public.disputes where buyer_id = 'e1000000-0000-4000-8000-000000000001'),
    (select status::text from public.orders where id = 'e1000000-0000-4000-8000-0000000b0001'),
    (select total_amount from public.orders where id = 'e1000000-0000-4000-8000-0000000b0001'),
    (select status::text from public.disputes where id = 'e1000000-0000-4000-8000-0000000d0001'),
    (select price_at_purchase from public.order_items where product_id = 'e1000000-0000-4000-8000-0000000a0001'))::text),
  'orders, order items and disputes are unchanged after the client attempts');

-- Reviews: only for a completed shipment of that seller in the buyer's order.
select pg_temp.as_user('e1000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000004',
      'e1000000-0000-4000-8000-000000000001', 1, 'Not in this order')$$,
  '42501', null, 'the buyer cannot review a seller who has no shipment in the order');
select throws_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment, shipment_id, product_id)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000003',
      'e1000000-0000-4000-8000-000000000001', 1, 'Not completed',
      'e1000000-0000-4000-8000-0000000c0002', 'e1000000-0000-4000-8000-0000000a0002')$$,
  '42501', null, 'the buyer cannot review a shipment that is not completed');
select throws_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment)
    values ('e1000000-0000-4000-8000-0000000b0002', 'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001', 1, 'Seller shipment not completed in this order')$$,
  '42501', null, 'a completed shipment of the seller in another order does not allow a review on this one');
select throws_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment, shipment_id)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001', 1, 'Wrong shipment', 'e1000000-0000-4000-8000-0000000c0003')$$,
  '42501', null, 'the shipment of the review must be the completed shipment of that seller in the order');
select throws_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment, shipment_id, product_id)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001', 1, 'Product not in shipment',
      'e1000000-0000-4000-8000-0000000c0001', 'e1000000-0000-4000-8000-0000000a0003')$$,
  '42501', null, 'the product of the review must belong to the reviewed shipment');
select lives_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment, shipment_id, product_id)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001', 5, 'Great', 'e1000000-0000-4000-8000-0000000c0001',
      'e1000000-0000-4000-8000-0000000a0001')$$,
  'the buyer reviews the product of a completed shipment');
select throws_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001', 1, 'No shipment')$$,
  '42501', null, 'a review must name its shipment');
select throws_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment, product_id)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001', 1, 'Product without shipment', 'e1000000-0000-4000-8000-0000000a0001')$$,
  '42501', null, 'a product review must name its shipment');
select lives_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment, shipment_id)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001', 4, 'Good seller', 'e1000000-0000-4000-8000-0000000c0001')$$,
  'the buyer reviews a completed shipment without naming a product');
select throws_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment, shipment_id)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001', 1, 'Again', 'e1000000-0000-4000-8000-0000000c0001')$$,
  '23505', null, 'a second review of the same shipment without a product is rejected');
reset role;

-- A user who is not the buyer cannot review the order.
select pg_temp.as_user('e1000000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$insert into public.reviews (order_id, seller_id, reviewer_id, rating, comment, shipment_id)
    values ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000004', 1, 'Not my order', 'e1000000-0000-4000-8000-0000000c0001')$$,
  '42501', null, 'a user who is not the buyer cannot review the order');
reset role;

select is(
  (select count(*) from public.reviews where order_id in ('e1000000-0000-4000-8000-0000000b0001', 'e1000000-0000-4000-8000-0000000b0002')),
  2::bigint, 'only the allowed reviews were stored');
select is(
  (select string_agg(row(seller_id, shipment_id, product_id, rating)::text, ', ' order by rating desc) from public.reviews where order_id = 'e1000000-0000-4000-8000-0000000b0001'),
  row('e1000000-0000-4000-8000-000000000002'::uuid, 'e1000000-0000-4000-8000-0000000c0001'::uuid, 'e1000000-0000-4000-8000-0000000a0001'::uuid, 5)::text
    || ', ' || row('e1000000-0000-4000-8000-000000000002'::uuid, 'e1000000-0000-4000-8000-0000000c0001'::uuid, null::uuid, 4)::text,
  'the stored reviews are the completed shipment reviews');

-- Client roles hold only read privileges and read policies on these tables.
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('orders', 'order_items', 'disputes')
     and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT'),
  0::bigint, 'anon, authenticated and PUBLIC hold no write privilege on these tables');
select is(
  (select string_agg(policyname || ':' || cmd, ', ' order by policyname) from pg_policies
   where schemaname = 'public' and tablename in ('orders', 'order_items', 'disputes')),
  'disputes_select:SELECT, order_items_select_v4:SELECT, orders_select_v4:SELECT',
  'only the read policies remain on these tables');

-- Server code keeps writing: the service role inserts and updates orders.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select lives_ok(
  $$insert into public.orders (id, buyer_id, total_amount, shipping_address)
    values ('e1000000-0000-4000-8000-0000000b0003', 'e1000000-0000-4000-8000-000000000001', 1000, '{}'::jsonb)$$,
  'the service role inserts orders');
select lives_ok(
  $$update public.disputes set admin_notes = 'checked' where id = 'e1000000-0000-4000-8000-0000000d0001'$$,
  'the service role updates disputes');
reset role;

select * from finish();
rollback;
