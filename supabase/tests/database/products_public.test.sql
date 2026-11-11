-- products_public: the public catalogue view. It exposes an allow-listed set of
-- columns, only for non-deleted listings in VERIFIED, SOLD,
-- PENDING_VERIFICATION and IN_REVIEW, and runs with its owner's rights behind
-- a security barrier. The products table itself has no public read policy: a
-- non-owner non-admin reads no row, while the owner and an admin still do.
-- get_profile_stats counts sales through the view. Runs against the local
-- database only: `supabase start`, then `bun run test:db`.
begin;
select plan(30);

\ir ../fixtures/money.psql

-- Users: 77001 seller, 77002 stranger, 77003 admin.
select pg_temp.money_user(77001);
select pg_temp.money_user(77002);
select pg_temp.money_user(77003, 'admin');

-- A listing of seller 77001 named 'pp-<n>' in p_status, soft-deleted when p_deleted.
create function pg_temp.listing(p_n integer, p_status text, p_deleted boolean default false)
returns uuid language sql as $$
  insert into public.products (
    id, name, description, price, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost, origin_zip, package_preset, deleted_at,
    publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select pg_temp.mu(p_n), 'pp-' || p_n, 'Test listing', 1000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status_enum,
    '{}'::jsonb, pg_temp.mu(77001), 100, '06600', 'gpu_1',
    case when p_deleted then now() end,
    round(100 * 100)::bigint + s.shipping_buffer_cents
      + ceil(round(1000 * 100)::numeric * public.normalize_publication_rate(s.insurance_rate))::bigint,
    public.normalize_publication_rate(s.service_fee_pct),
    public.normalize_publication_rate(s.insurance_rate)
  from public.system_settings s where s.id = 1
  returning id
$$;

select pg_temp.listing(77101, 'PENDING_VERIFICATION');
select pg_temp.listing(77102, 'IN_REVIEW');
select pg_temp.listing(77103, 'VERIFIED');
select pg_temp.listing(77104, 'SOLD');
select pg_temp.listing(77105, 'REJECTED');
select pg_temp.listing(77106, 'HIDDEN');
select pg_temp.listing(77107, 'RESERVED');
select pg_temp.listing(77108, 'IN_DISPUTE');
select pg_temp.listing(77109, 'VERIFIED', true);
select pg_temp.listing(77110, 'SOLD', true);
select pg_temp.listing(77111, 'PENDING_VERIFICATION', true);
select pg_temp.listing(77112, 'IN_REVIEW', true);

-- Names of this file's listings visible in a relation to the current role.
create function pg_temp.visible(p_rel text) returns text language plpgsql as $$
declare v text;
begin
  execute format(
    'select coalesce(string_agg(name, '','' order by name), '''') from %s where seller_id = %L',
    p_rel, pg_temp.mu(77001)) into v;
  return v;
end $$;

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.mu(p_n), 'role', 'authenticated')::text, true)
$$;

-- A cheap function that records every name it is asked about (security barrier probe).
create table pg_temp.leaked (name text);
grant insert, select on pg_temp.leaked to anon, authenticated;
create function pg_temp.leak(p_name text) returns boolean language plpgsql cost 0.0000001 as $$
begin
  insert into pg_temp.leaked values (p_name);
  return true;
end $$;

-- View shape ---------------------------------------------------------------------
select is(
  (select string_agg(column_name::text, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'products_public'),
  'id,seller_id,name,description,price,category,condition,usage,images,specifications,aspect_ratio,status,views,created_at,fts',
  'products_public exposes exactly the allow-listed columns, in order');
select is(
  (select reloptions::text from pg_class where oid = 'public.products_public'::regclass),
  '{security_barrier=true}',
  'products_public is a security barrier view and not security_invoker');

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  format('select %I from public.products_public', c),
  '42703', null, 'anon cannot select the hidden column ' || c || ' from products_public')
from unnest(array[
  'origin_zip', 'verification_data', 'rejection_reason', 'locked_by', 'locked_at',
  'publication_commission_rate', 'publication_insurance_rate',
  'publication_shipping_reserve_cents', 'status_before_account_hold', 'shipping_cost',
  'package_preset', 'shipping_payer', 'reserved_at', 'deleted_at'
]) as c;

-- View rows per role -------------------------------------------------------------
select is(pg_temp.visible('public.products_public'), 'pp-77101,pp-77102,pp-77103,pp-77104',
  'anon sees only non-deleted listings in PENDING_VERIFICATION, IN_REVIEW, VERIFIED and SOLD');
reset role;
select pg_temp.as_user(77002);
set local role authenticated;
select is(pg_temp.visible('public.products_public'), 'pp-77101,pp-77102,pp-77103,pp-77104',
  'a stranger sees the same public listings through the view');
reset role;
select pg_temp.as_user(77001);
set local role authenticated;
select is(pg_temp.visible('public.products_public'), 'pp-77101,pp-77102,pp-77103,pp-77104',
  'the owner sees only the public listings through the view, not the hidden or deleted ones');
reset role;
select pg_temp.as_user(77003);
set local role authenticated;
select is(pg_temp.visible('public.products_public'), 'pp-77101,pp-77102,pp-77103,pp-77104',
  'an admin sees only the public listings through the view');
reset role;

-- A filter on the view never sees a hidden row before the view's own predicate.
select pg_temp.as_user(77002);
set local role authenticated;
select is(
  (select count(*) from public.products_public p
   where p.seller_id = pg_temp.mu(77001) and pg_temp.leak(p.name)),
  4::bigint,
  'a caller-supplied filter on the view returns the four public listings');
reset role;
select is(
  (select coalesce(string_agg(distinct name, ',' order by name), '') from pg_temp.leaked
   where name like 'pp-%'),
  'pp-77101,pp-77102,pp-77103,pp-77104',
  'a caller-supplied function on the view only ever sees public rows');

-- The products table: no public read ---------------------------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select pg_temp.visible('public.products')$$, '42501', null,
  'anon has no privilege on the products table (#305)');
reset role;
select pg_temp.as_user(77002);
set local role authenticated;
select is(pg_temp.visible('public.products'), '',
  'a non-owner non-admin reads no products table row, not even a VERIFIED one');
reset role;
select pg_temp.as_user(77001);
set local role authenticated;
select is(pg_temp.visible('public.products'),
  'pp-77101,pp-77102,pp-77103,pp-77104,pp-77105,pp-77106,pp-77107,pp-77108,pp-77109,pp-77110,pp-77111,pp-77112',
  'the owner reads every own listing from the table, hidden and deleted ones included');
reset role;
select pg_temp.as_user(77003);
set local role authenticated;
select is(pg_temp.visible('public.products'),
  'pp-77101,pp-77102,pp-77103,pp-77104,pp-77105,pp-77106,pp-77107,pp-77108,pp-77109,pp-77110,pp-77111,pp-77112',
  'an admin reads every listing from the table');
reset role;

-- get_profile_stats counts SOLD listings through the view ------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select is(
  public.get_profile_stats(pg_temp.mu(77001))::jsonb,
  '{"sales_count": 1, "rating_average": 0, "reviews_count": 0}'::jsonb,
  'for anon, get_profile_stats counts the one non-deleted SOLD listing');
reset role;
select pg_temp.as_user(77001);
set local role authenticated;
select is(
  public.get_profile_stats(pg_temp.mu(77001))::jsonb,
  '{"sales_count": 1, "rating_average": 0, "reviews_count": 0}'::jsonb,
  'for the owner, get_profile_stats leaves out the soft-deleted SOLD listing');
reset role;
select pg_temp.as_user(77002);
set local role authenticated;
select is(
  public.get_profile_stats(pg_temp.mu(77001))::jsonb,
  '{"sales_count": 1, "rating_average": 0, "reviews_count": 0}'::jsonb,
  'for a stranger, get_profile_stats counts the same sales');
reset role;
select is(
  public.get_profile_stats(pg_temp.mu(77002))::jsonb,
  '{"sales_count": 0, "rating_average": 0, "reviews_count": 0}'::jsonb,
  'get_profile_stats counts no sales for a seller with no SOLD listing');

select * from finish();
rollback;
