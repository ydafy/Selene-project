-- A listing stores its price and shipping cost as integer cents, and the price
-- stays between $10 and $500,000 (odd/tasks/money-integer-cents.md S2-S4, T2).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(21);
\ir ../fixtures/money.psql

-- A VERIFIED listing of p_seller with a snapshot computed from the current
-- settings; p_reserve_delta shifts the reserve to test the trigger.
create function pg_temp.listing(
  p_n integer, p_seller integer, p_price_cents bigint, p_shipping_cents bigint,
  p_reserve_delta bigint default 0
) returns void language plpgsql as $$
begin
  execute $sql$
    insert into public.products (
      id, name, description, price_cents, category, condition, usage, images, status,
      specifications, seller_id, shipping_cost_cents, origin_zip, package_preset,
      publication_shipping_reserve_cents, publication_commission_rate,
      publication_insurance_rate
    )
    select pg_temp.mu($1), 'Test GPU', 'Test listing', $3, 'GPU', 'used', 'gaming',
      array['https://example.test/p.png'], 'VERIFIED'::public.product_status_enum,
      '{}'::jsonb, pg_temp.mu($2), $4, '06600', 'gpu_1',
      $4 + s.shipping_buffer_cents + ceil($3::numeric * s.insurance_rate)::bigint + $5,
      s.service_fee_pct,
      s.insurance_rate
    from public.system_settings s where s.id = 1
  $sql$ using p_n, p_seller, p_price_cents, p_shipping_cents, p_reserve_delta;
end $$;

select pg_temp.money_user(1);
select pg_temp.money_user(2);

-- Columns ------------------------------------------------------------------------
select col_type_is('public', 'products', 'price_cents', 'bigint', 'products.price_cents is bigint');
select col_not_null('public', 'products', 'price_cents', 'products.price_cents is NOT NULL');
select col_hasnt_default('public', 'products', 'price_cents', 'products.price_cents has no default');
select col_type_is('public', 'products', 'shipping_cost_cents', 'bigint', 'products.shipping_cost_cents is bigint');
select col_not_null('public', 'products', 'shipping_cost_cents', 'products.shipping_cost_cents is NOT NULL');
select hasnt_column('public', 'products', 'price', 'products has no pesos price column');
select hasnt_column('public', 'products', 'shipping_cost', 'products has no pesos shipping_cost column');

-- Price range: $10 to $500,000 ----------------------------------------------------
select throws_ok($$select pg_temp.listing(101, 1, 999, 15000)$$,
  '23514', null, 'a price of 999 cents is rejected');
select throws_ok($$select pg_temp.listing(102, 1, 0, 15000)$$,
  '23514', null, 'a price of 0 cents is rejected');
select throws_ok($$select pg_temp.listing(103, 1, 50000001, 15000)$$,
  '23514', null, 'a price of 50000001 cents is rejected');
select lives_ok($$select pg_temp.listing(104, 1, 1000, 15000)$$,
  'a price of 1000 cents is accepted');
select lives_ok($$select pg_temp.listing(105, 1, 50000000, 15000)$$,
  'a price of 50000000 cents is accepted');
select throws_ok($$select pg_temp.listing(106, 1, 123450, -1)$$,
  '23514', null, 'a negative shipping cost is rejected');

-- Publication reserve in cents ---------------------------------------------------
select lives_ok($$select pg_temp.listing(107, 1, 123450, 15000)$$,
  'a reserve of shipping + buffer + ceil(price_cents * insurance_rate) is accepted');
select throws_ok($$select pg_temp.listing(108, 1, 123450, 15000, 1)$$,
  'P0001', 'INVALID_OR_STALE_PUBLICATION_ECONOMICS', 'a reserve 1 cent above is rejected');
select throws_ok($$select pg_temp.listing(109, 1, 123450, 15000, -1)$$,
  'P0001', 'INVALID_OR_STALE_PUBLICATION_ECONOMICS', 'a reserve 1 cent below is rejected');

-- Views ----------------------------------------------------------------------------
select has_column('public', 'products_public', 'price_cents', 'products_public exposes price_cents');
select hasnt_column('public', 'products_public', 'price', 'products_public has no pesos price');
select has_column('public', 'admin_product_queue_view', 'price_cents', 'admin_product_queue_view exposes price_cents');
select has_column('public', 'admin_product_queue_view', 'shipping_cost_cents', 'admin_product_queue_view exposes shipping_cost_cents');

-- fn_reserve_products returns the cart total in cents ------------------------------
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select success::text || ':' || total_price_cents::text
   from public.fn_reserve_products(pg_temp.mu(2), array[pg_temp.mu(104), pg_temp.mu(107)])),
  'true:124450', 'fn_reserve_products returns total_price_cents, the sum of the reserved price_cents');
reset role;

select * from finish();
rollback;
