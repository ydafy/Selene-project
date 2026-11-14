-- fn_unlock_product: an active admin releases a listing's review lock when it
-- is theirs or older than 10 minutes, writes a PRODUCT_UNLOCK audit row and
-- returns true; a fresh lock held by another admin, an unlocked listing or a
-- missing one returns false and changes nothing. No session, a non-admin, and
-- a suspended or banned admin are refused. Also the 10-minute reservation TTL
-- of the expired-only fn_release_listings that fn_reserve_products runs, and
-- the (status, reserved_at) partial index. Runs against the
-- local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(26);

\ir ../fixtures/money.psql

-- Users: 5201 admin, 5202 seller, 5203 second admin, 5204 plain user,
-- 5205 suspended admin, 5206 banned admin.
select pg_temp.money_user(5201, 'admin');
select pg_temp.money_user(5202);
select pg_temp.money_user(5203, 'admin');
select pg_temp.money_user(5204);
select pg_temp.money_user(5205, 'admin');
select pg_temp.money_user(5206, 'admin');
update public.profiles_private set status = 'suspended' where id = pg_temp.mu(5205);
update public.profiles_private set status = 'banned' where id = pg_temp.mu(5206);

-- A listing of seller 5202 in p_status, locked by p_locked_by p_lock_age ago
-- (NULL leaves it unlocked), reserved p_reserved_age ago (NULL: not reserved).
create function pg_temp.listing(
  p_n integer, p_status text, p_locked_by integer, p_lock_age interval,
  p_reserved_age interval default null
) returns uuid language sql as $$
  insert into public.products (
    id, name, description, price_cents, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost_cents, origin_zip, package_preset,
    locked_by, locked_at, reserved_at,
    publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select pg_temp.mu(p_n), 'Test GPU', 'Test listing', 100000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status_enum,
    '{}'::jsonb, pg_temp.mu(5202), 10000, '06600', 'gpu_1',
    case when p_locked_by is null then null else pg_temp.mu(p_locked_by) end,
    case when p_locked_by is null then null else now() - p_lock_age end,
    now() - p_reserved_age,
    10000::bigint + s.shipping_buffer_cents
      + ceil(100000::numeric * s.insurance_rate)::bigint,
    s.service_fee_pct,
    s.insurance_rate
  from public.system_settings s where s.id = 1
  returning id
$$;

-- status|locked_by|locked_at|updated_at|audit rows of a listing.
create function pg_temp.sig_of(p_n integer) returns text language sql as $$
  select p.status::text || '|' || coalesce(p.locked_by::text, '-') || '|'
    || coalesce(p.locked_at::text, '-') || '|' || coalesce(p.updated_at::text, '-')
    || '|audits:' || (select count(*) from public.admin_audit_logs a where a.target_id = p.id)
  from public.products p where p.id = pg_temp.mu(p_n)
$$;
create table pg_temp.sig (n integer primary key, v text);
create function pg_temp.remember(p_ns integer[]) returns void language sql as $$
  insert into pg_temp.sig select n, pg_temp.sig_of(n) from unnest(p_ns) as n
$$;
create function pg_temp.unchanged(p_n integer) returns boolean language sql as $$
  select pg_temp.sig_of(p_n) = (select v from pg_temp.sig where n = p_n)
$$;
-- status|locked_by|locked_at, then each audit row as admin|action|timestamp is now().
create function pg_temp.after_unlock(p_n integer) returns text language sql as $$
  select p.status::text || '|' || coalesce(p.locked_by::text, '-') || '|'
    || coalesce(p.locked_at::text, '-') || '|' || coalesce((
      select string_agg(a.admin_id::text || '|' || a.action_type || '|'
        || ((a.details->>'timestamp')::timestamptz = now())::text, ' ; ')
      from public.admin_audit_logs a where a.target_id = p.id), '-')
  from public.products p where p.id = pg_temp.mu(p_n)
$$;
create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub": "%s", "role": "authenticated"}', pg_temp.mu(p_n)), true)
$$;

select pg_temp.listing(5221, 'IN_REVIEW', 5204, interval '1 minute');
select pg_temp.listing(5222, 'IN_REVIEW', 5205, interval '1 minute');
select pg_temp.listing(5223, 'IN_REVIEW', 5206, interval '1 minute');
select pg_temp.listing(5224, 'IN_REVIEW', 5201, interval '1 minute');
select pg_temp.listing(5225, 'IN_REVIEW', 5203, interval '10 minutes');
select pg_temp.listing(5226, 'IN_REVIEW', 5203, interval '10 minutes 1 second');
select pg_temp.listing(5227, 'IN_REVIEW', 5203, interval '1 minute');
select pg_temp.listing(5228, 'IN_REVIEW', null, null);
select pg_temp.remember(array[5221, 5222, 5223, 5225, 5227, 5228]);

-- Refusals ---------------------------------------------------------------------
-- Each refused caller holds the lock, so without the check the call would go through.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok(format($$select public.fn_unlock_product(%L)$$, pg_temp.mu(5221)),
  'P0001', 'UNAUTHORIZED_NO_SESSION', 'a call without a session is refused');
reset role;
select pg_temp.as_user(5204);
set local role authenticated;
select throws_ok(format($$select public.fn_unlock_product(%L)$$, pg_temp.mu(5221)),
  'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'a non-admin is refused, even on their own lock');
reset role;
select ok(pg_temp.unchanged(5221), 'the no-session and non-admin calls leave the lock and write no audit row');

select pg_temp.as_user(5205);
set local role authenticated;
select throws_ok(format($$select public.fn_unlock_product(%L)$$, pg_temp.mu(5222)),
  'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'a suspended admin is refused, even on their own lock');
reset role;
select ok(pg_temp.unchanged(5222), 'a suspended admin''s call changes nothing');

select pg_temp.as_user(5206);
set local role authenticated;
select throws_ok(format($$select public.fn_unlock_product(%L)$$, pg_temp.mu(5223)),
  'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'a banned admin is refused, even on their own lock');
reset role;
select ok(pg_temp.unchanged(5223), 'a banned admin''s call changes nothing');

-- An active admin --------------------------------------------------------------
select pg_temp.as_user(5201);
set local role authenticated;
select is(public.fn_unlock_product(pg_temp.mu(5224)), true, 'the admin releases their own fresh lock');
reset role;
select is(pg_temp.after_unlock(5224), 'IN_REVIEW|-|-|' || pg_temp.mu(5201)::text || '|PRODUCT_UNLOCK|true',
  'releasing their own lock clears it, keeps the status and writes one PRODUCT_UNLOCK audit row');

set local role authenticated;
select is(public.fn_unlock_product(pg_temp.mu(5225)), false,
  'another admin''s lock exactly 10 minutes old is not released');
reset role;
select ok(pg_temp.unchanged(5225), 'a lock exactly 10 minutes old stays, with no audit row');

set local role authenticated;
select is(public.fn_unlock_product(pg_temp.mu(5226)), true,
  'another admin''s lock older than 10 minutes is released');
reset role;
select is(pg_temp.after_unlock(5226), 'IN_REVIEW|-|-|' || pg_temp.mu(5201)::text || '|PRODUCT_UNLOCK|true',
  'releasing an expired lock clears it and audits the admin who released it');

set local role authenticated;
select is(public.fn_unlock_product(pg_temp.mu(5227)), false, 'another admin''s fresh lock is not released');
reset role;
select ok(pg_temp.unchanged(5227), 'another admin''s fresh lock stays, with no audit row');

set local role authenticated;
select is(public.fn_unlock_product(pg_temp.mu(5228)), false, 'an unlocked listing returns false');
reset role;
select ok(pg_temp.unchanged(5228), 'an unlocked listing gets no audit row');

set local role authenticated;
select is(public.fn_unlock_product(pg_temp.mu(5299)), false, 'a missing listing returns false');
reset role;
select is((select count(*) from public.admin_audit_logs where target_id = pg_temp.mu(5299)), 0::bigint,
  'a missing listing gets no audit row');

-- fn_release_listings, expired only: the 10-minute reservation TTL ------------
select pg_temp.listing(5241, 'RESERVED', null, null, interval '10 minutes');
select pg_temp.listing(5242, 'RESERVED', null, null, interval '10 minutes 1 second');
select pg_temp.listing(5243, 'RESERVED', null, null, interval '20 minutes');
select pg_temp.listing(5244, 'VERIFIED', null, null, interval '20 minutes');
select pg_temp.remember(array[5241, 5243]);

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select array_agg(r) from public.fn_release_listings(
    array[pg_temp.mu(5241), pg_temp.mu(5242)], true, true) as r),
  array[pg_temp.mu(5242)],
  'the expired-only release frees only the reservation older than 10 minutes');
reset role;
select is(
  (select status::text || '|' || coalesce(reserved_at::text, '-') from public.products where id = pg_temp.mu(5242)),
  'VERIFIED|-', 'the released reservation is back on sale with reserved_at cleared');
select ok(pg_temp.unchanged(5241), 'a reservation exactly 10 minutes old stays reserved');
select ok(pg_temp.unchanged(5243), 'a stale reservation outside the requested ids stays reserved');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select count(*) from public.fn_release_listings(array[pg_temp.mu(5244)], true, true)),
  0::bigint, 'a VERIFIED listing with an old reserved_at is never released');
reset role;

-- The cleanup's partial index --------------------------------------------------
select has_index('public', 'products', 'idx_products_reserved_status_reserved_at',
  array['status', 'reserved_at'], 'products has the (status, reserved_at) index for the stale cleanup');
select is(
  (select pg_get_expr(i.indpred, i.indrelid) from pg_index i
   where i.indexrelid = 'public.idx_products_reserved_status_reserved_at'::regclass),
  '(status = ''RESERVED''::product_status_enum)',
  'the index covers RESERVED listings only');

select * from finish();
rollback;
