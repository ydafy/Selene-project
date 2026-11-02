-- A seller edits a VERIFIED listing without review only in name, description,
-- condition and usage (S12, #141). Any other change must send it to review;
-- admins are not limited. Runs against the local database only:
-- `supabase start`, then `bun run test:db`.
begin;
select plan(23);

-- Snapshot reserve for a price and shipping cost (pesos) under the current settings.
create function pg_temp.fresh_reserve(p_price numeric, p_shipping numeric)
returns bigint language sql security definer as $$
  select round(p_shipping * 100)::bigint + s.shipping_buffer_cents
    + ceil(round(p_price * 100)::numeric * public.normalize_publication_rate(s.insurance_rate))::bigint
  from public.system_settings s where s.id = 1
$$;

create function pg_temp.make_listing(p_id uuid, p_seller uuid, p_status text)
returns void language sql as $$
  insert into public.products (
    id, name, description, price, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost, origin_zip, package_preset,
    publication_shipping_reserve_cents, publication_commission_rate, publication_insurance_rate
  )
  select p_id, 'Test GPU', 'Test listing', 1000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status_enum,
    '{"brand": "MSI"}'::jsonb, p_seller, 100, '06600', 'gpu_1',
    pg_temp.fresh_reserve(1000, 100),
    public.normalize_publication_rate(s.service_fee_pct),
    public.normalize_publication_rate(s.insurance_rate)
  from public.system_settings s where s.id = 1
$$;

-- Runs one statement and returns how many rows it touched.
create function pg_temp.rows_updated(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('e0000000-0000-4000-8000-000000000001'::uuid, 'verified_edit_admin@test.local', 'verified_edit_admin'),
  ('e0000000-0000-4000-8000-000000000002'::uuid, 'verified_edit_owner@test.local', 'verified_edit_owner'),
  ('e0000000-0000-4000-8000-000000000003'::uuid, 'verified_edit_other@test.local', 'verified_edit_other'),
  ('e0000000-0000-4000-8000-000000000004'::uuid, 'verified_edit_susp@test.local', 'verified_edit_susp')
) as u(id, email, username);
update public.profiles_private set role = 'admin'
where id = 'e0000000-0000-4000-8000-000000000001';

-- a1 text edit, a2 refused column edits, a3 admin, a4 stranger target, a5 review path,
-- b1 HIDDEN, b2 REJECTED, b3 PENDING_VERIFICATION, c1 held by the suspension,
-- c2 VERIFIED of a suspended seller.
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-000000000002', 'VERIFIED');
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000a2', 'e0000000-0000-4000-8000-000000000002', 'VERIFIED');
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000a3', 'e0000000-0000-4000-8000-000000000002', 'VERIFIED');
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000a4', 'e0000000-0000-4000-8000-000000000002', 'VERIFIED');
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000a5', 'e0000000-0000-4000-8000-000000000002', 'VERIFIED');
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-000000000002', 'HIDDEN');
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000b2', 'e0000000-0000-4000-8000-000000000002', 'REJECTED');
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000b3', 'e0000000-0000-4000-8000-000000000002', 'PENDING_VERIFICATION');
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000c1', 'e0000000-0000-4000-8000-000000000004', 'VERIFIED');

select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select public.fn_admin_update_user_status(
  'e0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'suspended', 'test');
reset role;
select pg_temp.make_listing('e0000000-0000-4000-8000-0000000000c2', 'e0000000-0000-4000-8000-000000000004', 'VERIFIED');

create temp table before_edit as
  select id, to_jsonb(p) as row_json from public.products p
  where id::text like 'e0000000-%';
grant select on before_edit to authenticated;

-- Server-side writers are not limited -----------------------------------------
select lives_ok(
  $$update public.products set images = array['https://example.test/server.png']
    where id = 'e0000000-0000-4000-8000-0000000000a3'$$,
  'the server role changes the images of a VERIFIED listing and keeps it VERIFIED');
update public.products set images = array['https://example.test/p.png']
where id = 'e0000000-0000-4000-8000-0000000000a3';

-- The owner edits the four text columns of a VERIFIED listing -------------------
select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(
  pg_temp.rows_updated($$update public.products
    set name = 'Renamed GPU', description = 'Better text', condition = 'new', usage = 'work'
    where id = 'e0000000-0000-4000-8000-0000000000a1'$$),
  1::bigint, 'the owner edit of the four text columns affects one row');
reset role;
select is(
  (select status::text || '|' || name || '|' || description || '|' || condition || '|' || usage
   from public.products where id = 'e0000000-0000-4000-8000-0000000000a1'),
  'VERIFIED|Renamed GPU|Better text|new|work',
  'the listing stays VERIFIED and stores the new text');

-- Any other change that keeps VERIFIED is refused ------------------------------
select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.products set images = array['https://example.test/other.png']
    where id = 'e0000000-0000-4000-8000-0000000000a2'$$,
  '42501', 'VERIFIED_EDIT_REQUIRES_REVIEW', 'images cannot change while VERIFIED');
select throws_ok(
  $$update public.products set specifications = '{"brand": "ASUS"}'::jsonb
    where id = 'e0000000-0000-4000-8000-0000000000a2'$$,
  '42501', 'VERIFIED_EDIT_REQUIRES_REVIEW', 'specifications cannot change while VERIFIED');
select throws_ok(
  $$update public.products set price = 1200,
      publication_shipping_reserve_cents = pg_temp.fresh_reserve(1200, 100)
    where id = 'e0000000-0000-4000-8000-0000000000a2'$$,
  '42501', 'VERIFIED_EDIT_REQUIRES_REVIEW', 'the price cannot change while VERIFIED, even with a fresh snapshot');
select throws_ok(
  $$update public.products set category = 'CPU'
    where id = 'e0000000-0000-4000-8000-0000000000a2'$$,
  '42501', 'VERIFIED_EDIT_REQUIRES_REVIEW', 'the category cannot change while VERIFIED');
select throws_ok(
  $$update public.products set shipping_cost = 150,
      publication_shipping_reserve_cents = pg_temp.fresh_reserve(1000, 150)
    where id = 'e0000000-0000-4000-8000-0000000000a2'$$,
  '42501', 'VERIFIED_EDIT_REQUIRES_REVIEW', 'the shipping cost cannot change while VERIFIED, even with a fresh snapshot');
reset role;
select is(
  (select to_jsonb(p) from public.products p where id = 'e0000000-0000-4000-8000-0000000000a2'),
  (select row_json from before_edit where id = 'e0000000-0000-4000-8000-0000000000a2'),
  'the refused edits left the listing unchanged');

-- A client cannot reach VERIFIED from another status ----------------------------
select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.products set status = 'VERIFIED' where id = 'e0000000-0000-4000-8000-0000000000b1'$$,
  '42501', null, 'the owner cannot move HIDDEN to VERIFIED');
select throws_ok(
  $$update public.products set status = 'VERIFIED' where id = 'e0000000-0000-4000-8000-0000000000b2'$$,
  '42501', null, 'the owner cannot move REJECTED to VERIFIED');
select throws_ok(
  $$update public.products set status = 'VERIFIED' where id = 'e0000000-0000-4000-8000-0000000000b3'$$,
  '42501', null, 'the owner cannot move PENDING_VERIFICATION to VERIFIED');
reset role;
select is(
  (select jsonb_agg(to_jsonb(p) order by p.id) from public.products p
   where id in ('e0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000b2', 'e0000000-0000-4000-8000-0000000000b3')),
  (select jsonb_agg(row_json order by id) from before_edit
   where id in ('e0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000b2', 'e0000000-0000-4000-8000-0000000000b3')),
  'the refused status changes left the listings unchanged');

-- The review path is unchanged ---------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(
  pg_temp.rows_updated($$update public.products
    set images = array['https://example.test/new.png'], status = 'PENDING_VERIFICATION'
    where id = 'e0000000-0000-4000-8000-0000000000a5'$$),
  1::bigint, 'the owner sends a listing with new images to review');
reset role;
select is(
  (select status::text || '|' || images[1] from public.products
   where id = 'e0000000-0000-4000-8000-0000000000a5'),
  'PENDING_VERIFICATION|https://example.test/new.png',
  'the listing is in review with the new images');

-- A suspended owner cannot edit ---------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
select is(
  pg_temp.rows_updated($$update public.products set name = 'Edited while suspended'
    where id = 'e0000000-0000-4000-8000-0000000000c1'$$),
  0::bigint, 'a suspended owner cannot edit the text of a listing held by the suspension');
select is(
  pg_temp.rows_updated($$update public.products set status = 'VERIFIED'
    where id = 'e0000000-0000-4000-8000-0000000000c1'$$),
  0::bigint, 'a suspended owner cannot put a held listing back on sale');
select is(
  pg_temp.rows_updated($$update public.products set name = 'Edited while suspended'
    where id = 'e0000000-0000-4000-8000-0000000000c2'$$),
  0::bigint, 'a suspended owner cannot edit the text of a VERIFIED listing');
reset role;
select is(
  (select jsonb_agg(to_jsonb(p) order by p.id) from public.products p
   where id in ('e0000000-0000-4000-8000-0000000000c1', 'e0000000-0000-4000-8000-0000000000c2')),
  (select jsonb_agg(row_json order by id) from before_edit
   where id in ('e0000000-0000-4000-8000-0000000000c1', 'e0000000-0000-4000-8000-0000000000c2')),
  'the suspended owner listings are unchanged');

-- An admin is not limited ---------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(
  pg_temp.rows_updated($$update public.products set images = array['https://example.test/admin.png']
    where id = 'e0000000-0000-4000-8000-0000000000a3'$$),
  1::bigint, 'an admin changes the images of a VERIFIED listing');
reset role;
select is(
  (select status::text || '|' || images[1] from public.products
   where id = 'e0000000-0000-4000-8000-0000000000a3'),
  'VERIFIED|https://example.test/admin.png',
  'the listing stays VERIFIED with the admin change');

-- Another user cannot edit it ------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "e0000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(
  pg_temp.rows_updated($$update public.products set name = 'Hijacked'
    where id = 'e0000000-0000-4000-8000-0000000000a4'$$),
  0::bigint, 'another user cannot edit the listing');
reset role;
select is(
  (select to_jsonb(p) from public.products p where id = 'e0000000-0000-4000-8000-0000000000a4'),
  (select row_json from before_edit where id = 'e0000000-0000-4000-8000-0000000000a4'),
  'the listing of another seller is unchanged');

select * from finish();
rollback;
