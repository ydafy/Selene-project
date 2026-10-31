-- A suspended seller's listings are held, not returned to sale, when a
-- reservation ends; lifting the suspension restores them (T9e, T9e2, #70).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(19);

create function pg_temp.make_reserved(p_id uuid, p_seller uuid, p_age interval)
returns void language sql as $$
  insert into public.products (
    id, name, description, price, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost, origin_zip, package_preset,
    reserved_at, publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select p_id, 'Test GPU', 'Test listing', 1000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], 'RESERVED', '{}'::jsonb, p_seller, 100, '06600', 'gpu_1',
    now() - p_age,
    round(100 * 100)::bigint + s.shipping_buffer_cents
      + ceil(round(1000 * 100)::numeric * public.normalize_publication_rate(s.insurance_rate))::bigint,
    public.normalize_publication_rate(s.service_fee_pct),
    public.normalize_publication_rate(s.insurance_rate)
  from public.system_settings s where s.id = 1
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'admin@test.local', 'hold_admin'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'suspended@test.local', 'hold_suspended'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'active@test.local', 'hold_active')
) as u(id, email, username);
update public.profiles_private set role = 'admin'
where id = 'd0000000-0000-4000-8000-000000000001';

-- Suspended seller: one expired and one fresh reservation; active seller: the same.
select pg_temp.make_reserved('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000002', interval '20 minutes');
select pg_temp.make_reserved('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-000000000002', interval '1 minute');
select pg_temp.make_reserved('d0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-000000000003', interval '20 minutes');
select pg_temp.make_reserved('d0000000-0000-4000-8000-0000000000b2', 'd0000000-0000-4000-8000-000000000003', interval '1 minute');

-- An admin suspends seller 2; the reservations are untouched by the suspension.
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(
  public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
    'suspended', 'test'),
  true, 'an admin suspends the seller');
reset role;
select is(
  (select count(*) from public.products
   where seller_id = 'd0000000-0000-4000-8000-000000000002' and status = 'RESERVED'),
  2::bigint, 'the suspension leaves the reservations in place');

-- The release functions are service-only ---------------------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$select * from public.fn_release_listings(array['d0000000-0000-4000-8000-0000000000a1']::uuid[], false, false)$$,
  '42501', null, 'anon cannot execute fn_release_listings');
select throws_ok(
  $$select * from public.fn_release_products(array['d0000000-0000-4000-8000-0000000000a1']::uuid[])$$,
  '42501', null, 'anon cannot execute fn_release_products');
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.fn_release_listings(array['d0000000-0000-4000-8000-0000000000a1']::uuid[], false, false)$$,
  '42501', null, 'authenticated cannot execute fn_release_listings');
select throws_ok(
  $$select * from public.fn_release_stale_reservations()$$,
  '42501', null, 'authenticated cannot execute fn_release_stale_reservations');
reset role;

-- Stale cleanup holds the suspended seller's listing, releases the active one's -
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select count(*) from public.fn_release_stale_reservations()),
  2::bigint, 'the stale cleanup releases the two expired reservations');
reset role;
select is(
  (select status::text || ':' || coalesce(status_before_account_hold::text, '-') || ':' || (reserved_at is null)::text
   from public.products where id = 'd0000000-0000-4000-8000-0000000000a1'),
  'HIDDEN:VERIFIED:true', 'stale cleanup holds the suspended seller listing');
select is(
  (select status::text || ':' || coalesce(status_before_account_hold::text, '-') || ':' || (reserved_at is null)::text
   from public.products where id = 'd0000000-0000-4000-8000-0000000000b1'),
  'VERIFIED:-:true', 'stale cleanup returns the active seller listing to sale');
select is(
  (select status::text from public.products where id = 'd0000000-0000-4000-8000-0000000000a2'),
  'RESERVED', 'a fresh reservation is not released by the stale cleanup');

-- Explicit release (checkout ended) applies the same rule ----------------------
set local role service_role;
select is(
  (select success from public.fn_release_products(array[
    'd0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000b2'
  ]::uuid[])),
  true, 'fn_release_products succeeds');
reset role;
select is(
  (select status::text || ':' || coalesce(status_before_account_hold::text, '-')
   from public.products where id = 'd0000000-0000-4000-8000-0000000000a2'),
  'HIDDEN:VERIFIED', 'fn_release_products holds the suspended seller listing');
select is(
  (select status::text || ':' || coalesce(status_before_account_hold::text, '-')
   from public.products where id = 'd0000000-0000-4000-8000-0000000000b2'),
  'VERIFIED:-', 'fn_release_products returns the active seller listing to sale');

-- A banned seller's listing stays held too (NULL status reads as active) -------
select pg_temp.make_reserved('d0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-000000000003', interval '20 minutes');
update public.profiles_private set status = 'banned' where id = 'd0000000-0000-4000-8000-000000000003';
set local role service_role;
select is((select count(*) from public.fn_release_stale_reservations()), 1::bigint,
  'the stale cleanup releases the banned seller reservation');
reset role;
select is(
  (select status::text || ':' || coalesce(status_before_account_hold::text, '-')
   from public.products where id = 'd0000000-0000-4000-8000-0000000000c1'),
  'HIDDEN:VERIFIED', 'a banned seller listing is held');
update public.profiles_private set status = 'active' where id = 'd0000000-0000-4000-8000-000000000003';

-- Lifting the suspension restores the held listings ---------------------------
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(
  public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
    'active', 'lifted'),
  true, 'an admin lifts the suspension');
reset role;
select is(
  (select count(*) from public.products
   where seller_id = 'd0000000-0000-4000-8000-000000000002'
     and status = 'VERIFIED' and status_before_account_hold is null),
  2::bigint, 'lifting the suspension restores both held listings to VERIFIED');
select is(
  (select count(*) from public.products
   where seller_id = 'd0000000-0000-4000-8000-000000000002' and status = 'HIDDEN'),
  0::bigint, 'no listing stays hidden by the hold');

-- Unrelated HIDDEN listings are not restored ------------------------------------
select pg_temp.make_reserved('d0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-000000000002', interval '1 minute');
update public.products set status = 'HIDDEN', reserved_at = null
where id = 'd0000000-0000-4000-8000-0000000000d1';
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select public.fn_admin_update_user_status(
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'suspended', 'again');
select public.fn_admin_update_user_status(
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'active', 'again lifted');
reset role;
select is(
  (select status::text from public.products where id = 'd0000000-0000-4000-8000-0000000000d1'),
  'HIDDEN', 'a listing hidden for another reason stays hidden after the suspension is lifted');

select * from finish();
rollback;
