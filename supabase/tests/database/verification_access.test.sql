-- Verification files and the admin listing views.
-- Storage bucket `verification`: `<product_id>/<file>`. An admin or the seller
-- of the listing named by the first folder reads a file; only that seller
-- uploads one. Nobody updates or deletes through the client.
-- admin_product_queue_view and seller_trust_stats run with the caller's rights
-- and return rows only to admins, even to a seller who can read the listings.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(28);

\ir ../fixtures/money.psql

-- Users: 78001 seller A, 78002 seller B, 78003 stranger, 78004 admin.
select pg_temp.money_user(78001);
select pg_temp.money_user(78002);
select pg_temp.money_user(78003);
select pg_temp.money_user(78004, 'admin');

-- A listing named 'va-<n>' of p_seller in p_status, soft-deleted when p_deleted.
create function pg_temp.listing(p_n integer, p_seller integer, p_status text, p_deleted boolean default false)
returns uuid language sql as $$
  insert into public.products (
    id, name, description, price, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost, origin_zip, package_preset, deleted_at,
    publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select pg_temp.mu(p_n), 'va-' || p_n, 'Test listing', 1000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status_enum,
    '{}'::jsonb, pg_temp.mu(p_seller), 100, '06600', 'gpu_1',
    case when p_deleted then now() end,
    round(100 * 100)::bigint + s.shipping_buffer_cents
      + ceil(round(1000 * 100)::numeric * public.normalize_publication_rate(s.insurance_rate))::bigint,
    public.normalize_publication_rate(s.service_fee_pct),
    public.normalize_publication_rate(s.insurance_rate)
  from public.system_settings s where s.id = 1
  returning id
$$;

select pg_temp.listing(78101, 78001, 'PENDING_VERIFICATION');
select pg_temp.listing(78102, 78002, 'PENDING_VERIFICATION');
select pg_temp.listing(78103, 78001, 'PENDING_VERIFICATION', true);
select pg_temp.listing(78104, 78001, 'VERIFIED');
select pg_temp.listing(78105, 78001, 'REJECTED');
select pg_temp.listing(78106, 78001, 'SOLD');
select pg_temp.listing(78107, 78001, 'IN_REVIEW');

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.mu(p_n), 'role', 'authenticated')::text, true)
$$;

-- Uploads as the current role, the way the Storage API does: `<listing>/<file>`.
create function pg_temp.put(p_listing integer, p_file text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id)
  values ('verification', pg_temp.mu(p_listing)::text || '/' || p_file, auth.uid(), auth.uid()::text)
$$;

-- This file's verification objects visible to the current role, as '<listing n>/<file>'.
create function pg_temp.files() returns text language sql as $$
  select coalesce(string_agg(right(split_part(name, '/', 1), 5) || '/' || split_part(name, '/', 2), ','
    order by name), '')
  from storage.objects
  where bucket_id = 'verification' and name like 'f0000000-0000-4000-8000-0000000781%'
$$;

-- An admin's file already in listing 78101's folder (not uploaded by its seller).
insert into storage.objects (bucket_id, name)
values ('verification', pg_temp.mu(78101)::text || '/admin-note.pdf');

-- Uploads -------------------------------------------------------------------------
select pg_temp.as_user(78001);
set local role authenticated;
select lives_ok($$select pg_temp.put(78101, 'front.jpg')$$,
  'the seller uploads a verification file into their listing''s folder');
select throws_ok($$select pg_temp.put(78102, 'front.jpg')$$,
  '42501', null, 'a seller cannot upload into another seller''s listing folder');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('verification', 'not-a-listing/front.jpg', auth.uid(), auth.uid()::text)$$,
  '42501', null, 'a first folder that is not a listing is denied');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('verification', 'front.jpg', auth.uid(), auth.uid()::text)$$,
  '42501', null, 'a file outside any listing folder is denied');
select pg_temp.as_user(78002);
select lives_ok($$select pg_temp.put(78102, 'b.jpg')$$,
  'the other seller uploads into their own listing''s folder');
select throws_ok($$select pg_temp.put(78101, 'b.jpg')$$,
  '42501', null, 'the other seller cannot upload into the first seller''s listing folder');
select pg_temp.as_user(78003);
select throws_ok($$select pg_temp.put(78101, 'c.jpg')$$,
  '42501', null, 'a stranger cannot upload a verification file');
select pg_temp.as_user(78004);
select throws_ok($$select pg_temp.put(78101, 'd.jpg')$$,
  '42501', null, 'an admin cannot upload a verification file');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  format($$insert into storage.objects (bucket_id, name) values ('verification', %L)$$,
    pg_temp.mu(78101)::text || '/anon.jpg'),
  '42501', null, 'anon cannot upload a verification file');
reset role;
select is(pg_temp.files(), '78101/admin-note.pdf,78101/front.jpg,78102/b.jpg',
  'only the sellers'' uploads into their own listings are stored');

-- Reads ---------------------------------------------------------------------------
select pg_temp.as_user(78001);
set local role authenticated;
select is(pg_temp.files(), '78101/admin-note.pdf,78101/front.jpg',
  'the seller reads every file in their listing''s folder, whoever stored it');
select pg_temp.as_user(78002);
select is(pg_temp.files(), '78102/b.jpg', 'the other seller reads only their listing''s files');
select pg_temp.as_user(78003);
select is(pg_temp.files(), '', 'a stranger reads no verification file');
select pg_temp.as_user(78004);
select is(pg_temp.files(), '78101/admin-note.pdf,78101/front.jpg,78102/b.jpg',
  'an admin reads every verification file');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select is(pg_temp.files(), '', 'anon reads no verification file');
reset role;

-- No client update or delete --------------------------------------------------------
select pg_temp.as_user(78001);
set local role authenticated;
update storage.objects set metadata = '{"v": 2}'::jsonb
where bucket_id = 'verification' and name = pg_temp.mu(78101)::text || '/front.jpg';
reset role;
select is(
  (select metadata from storage.objects where bucket_id = 'verification'
     and name = pg_temp.mu(78101)::text || '/front.jpg'),
  null::jsonb,
  'the seller''s update changed nothing');
set local storage.allow_delete_query = 'true';
select pg_temp.as_user(78001);
set local role authenticated;
delete from storage.objects where bucket_id = 'verification'
  and name like 'f0000000-0000-4000-8000-0000000781%';
reset role;
set local storage.allow_delete_query = 'false';
select is(pg_temp.files(), '78101/admin-note.pdf,78101/front.jpg,78102/b.jpg',
  'the seller''s delete removed no verification file');

-- admin_product_queue_view ----------------------------------------------------------
create function pg_temp.queue() returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '') from public.admin_product_queue_view
  where seller_id in (pg_temp.mu(78001), pg_temp.mu(78002))
$$;
select is(
  (select reloptions::text from pg_class where oid = 'public.admin_product_queue_view'::regclass),
  '{security_invoker=true}',
  'admin_product_queue_view runs with the caller''s rights');
select pg_temp.as_user(78004);
set local role authenticated;
select is(pg_temp.queue(), 'va-78101,va-78102',
  'an admin sees the non-deleted listings pending verification');
select pg_temp.as_user(78001);
select is(
  (select count(*) from public.products where id = pg_temp.mu(78101)), 1::bigint,
  'the seller can read their pending listing from the table');
select is(pg_temp.queue(), '', 'the seller sees no row in the admin queue, not even their own listing');
select pg_temp.as_user(78003);
select is(pg_temp.queue(), '', 'a stranger sees no row in the admin queue');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select pg_temp.queue()$$, '42501', null, 'anon cannot read the admin queue');
reset role;

-- seller_trust_stats ------------------------------------------------------------------
create function pg_temp.trust() returns text language sql as $$
  select coalesce(string_agg(
    right(seller_id::text, 5) || ':' || total_listings || ',' || verified_count || ',' || in_review_count
      || ',' || rejected_count || ',' || sold_count || ',' || processed_count,
    ' ' order by seller_id), '')
  from public.seller_trust_stats
  where seller_id in (pg_temp.mu(78001), pg_temp.mu(78002))
$$;
select is(
  (select reloptions::text from pg_class where oid = 'public.seller_trust_stats'::regclass),
  '{security_invoker=true}',
  'seller_trust_stats runs with the caller''s rights');
select pg_temp.as_user(78004);
set local role authenticated;
select is(pg_temp.trust(), '78001:5,1,1,1,1,3 78002:1,0,0,0,0,0',
  'an admin reads each seller''s counts of non-deleted listings (total, verified, in review, rejected, sold, processed)');
select pg_temp.as_user(78001);
select is(pg_temp.trust(), '', 'a seller reads no trust stats, not even their own');
select pg_temp.as_user(78003);
select is(pg_temp.trust(), '', 'a stranger reads no trust stats');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select pg_temp.trust()$$, '42501', null, 'anon cannot read the trust stats');
reset role;

select * from finish();
rollback;
