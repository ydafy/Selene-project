-- A listing keeps the publication economics it was published with (T10a, #120).
-- Only a price or shipping-cost change needs a snapshot fresh against the current
-- settings; every other update, status changes included, keeps the stored snapshot.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(31);

-- products.category references category_configurations; this file does not
-- depend on the seed's rows.
insert into public.category_configurations (category_name, sell_fields, filter_fields)
values ('GPU', '[]'::jsonb, '[]'::jsonb)
on conflict (category_name) do nothing;

-- Snapshot reserve for a price and shipping cost (cents) under the current settings.
create function pg_temp.fresh_reserve(p_price_cents bigint, p_shipping_cents bigint)
returns bigint language sql security definer as $$
  select p_shipping_cents + s.shipping_buffer_cents
    + ceil(p_price_cents::numeric * s.insurance_rate)::bigint
  from public.system_settings s where s.id = 1
$$;

create function pg_temp.make_listing(p_id uuid, p_seller uuid, p_status text, p_reserved_at timestamptz)
returns void language sql as $$
  insert into public.products (
    id, name, description, price_cents, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost_cents, origin_zip, package_preset, reserved_at,
    publication_shipping_reserve_cents, publication_commission_rate, publication_insurance_rate
  )
  select p_id, 'Test GPU', 'Test listing', 100000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status, '{}'::jsonb,
    p_seller, 10000, '06600', 'gpu_1', p_reserved_at,
    pg_temp.fresh_reserve(100000, 10000),
    s.service_fee_pct,
    s.insurance_rate
  from public.system_settings s where s.id = 1
$$;

-- A listing with an explicit snapshot, priced like make_listing.
create function pg_temp.make_listing_with(
  p_id uuid, p_reserve bigint, p_commission numeric, p_insurance numeric)
returns void language sql as $$
  insert into public.products (
    id, name, description, price_cents, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost_cents, origin_zip, package_preset,
    publication_shipping_reserve_cents, publication_commission_rate, publication_insurance_rate
  )
  values (p_id, 'Test GPU', 'Test listing', 100000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], 'pending_verification', '{}'::jsonb,
    'd0000000-0000-4000-8000-000000000002', 10000, '06600', 'gpu_1',
    p_reserve, p_commission, p_insurance)
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'economics_admin@test.local', 'economics_admin'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'economics@test.local', 'economics_seller'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'economics_held@test.local', 'economics_held')
) as u(id, email, username);
update public.profiles_private set role = 'admin'
where id = 'd0000000-0000-4000-8000-000000000001';

-- a1 hidden, a2 verified, a3 verified (owner edits), a4 pending_verification,
-- a5 reserved and expired, b1 verified of a seller about to be suspended.
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000002', 'hidden', null);
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-000000000002', 'verified', null);
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-000000000002', 'verified', null);
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a4', 'd0000000-0000-4000-8000-000000000002', 'pending_verification', null);
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000a5', 'd0000000-0000-4000-8000-000000000002', 'reserved', now() - interval '20 minutes');
select pg_temp.make_listing('d0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-000000000003', 'verified', null);

-- The seller of b1 is suspended, so b1 is held, before the fee change.
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select public.fn_admin_update_user_status(
  'd0000000-0000-4000-8000-000000000003', 'suspended', 'test');
reset role;

-- Every snapshot above is now stale.
update public.system_settings set shipping_buffer_cents = shipping_buffer_cents + 500 where id = 1;

-- Status-only transitions keep the stored snapshot --------------------------------
select lives_ok(
  $$update public.products set status = 'verified' where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'hidden -> verified with a stale snapshot is accepted');
select lives_ok(
  $$update public.products set status = 'reserved', reserved_at = now()
    where id = 'd0000000-0000-4000-8000-0000000000a2'$$,
  'verified -> reserved with a stale snapshot is accepted');
select lives_ok(
  $$update public.products set status = 'verified', verified_at = now()
    where id = 'd0000000-0000-4000-8000-0000000000a4'$$,
  'an admin approval with a stale snapshot is accepted');
select lives_ok(
  $$update public.products set name = 'Renamed GPU' where id = 'd0000000-0000-4000-8000-0000000000a2'$$,
  'an update that changes neither price nor shipping cost is accepted');
select lives_ok(
  $$update public.products set status = 'hidden' where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'taking a stale listing off sale is allowed');

-- The release paths complete with a stale snapshot -------------------------------
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select count(*) from public.fn_release_listings(
    array['d0000000-0000-4000-8000-0000000000a5']::uuid[], true, true)),
  1::bigint, 'the expired-only release frees an expired stale reservation');
reset role;
select is(
  (select status::text || ':' || (reserved_at is null)::text
   from public.products where id = 'd0000000-0000-4000-8000-0000000000a5'),
  'verified:true', 'the released stale listing is back on sale');
set local role service_role;
select is(
  (select count(*) from public.fn_release_listings(
    array['d0000000-0000-4000-8000-0000000000a2']::uuid[], false, false)),
  1::bigint, 'the release helper used by shipment cancellation returns a stale listing');
reset role;
select is(
  (select status::text from public.products where id = 'd0000000-0000-4000-8000-0000000000a2'),
  'verified', 'the stale listing released by the helper is verified');

select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(
  public.fn_admin_update_user_status(
    'd0000000-0000-4000-8000-000000000003', 'active', 'lifted'),
  true, 'an admin lifts the suspension of a seller with a stale listing');
reset role;
select is(
  (select status::text || ':' || coalesce(status_before_account_hold::text, '-')
   from public.products where id = 'd0000000-0000-4000-8000-0000000000b1'),
  'verified:-', 'the lift restores the stale held listing');

-- The snapshot itself stays immutable without a price change ---------------------
select throws_ok(
  $$update public.products set publication_shipping_reserve_cents = pg_temp.fresh_reserve(100000, 10000)
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'PUBLICATION_ECONOMICS_IMMUTABLE',
  'the snapshot cannot be refreshed without a price or shipping change');

-- A price or shipping-cost change is a new deal ----------------------------------
select throws_ok(
  $$update public.products set price_cents = 120000 where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'INVALID_OR_STALE_PUBLICATION_ECONOMICS',
  'a new price with the old snapshot is rejected');
select throws_ok(
  $$update public.products set shipping_cost_cents = 15000 where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'INVALID_OR_STALE_PUBLICATION_ECONOMICS',
  'a new shipping cost with the old snapshot is rejected');
select throws_ok(
  $$update public.products set price_cents = 120000, status = 'hidden'
    where id = 'd0000000-0000-4000-8000-0000000000a2'$$,
  'P0001', 'INVALID_OR_STALE_PUBLICATION_ECONOMICS',
  'hiding the listing does not skip the check of a new price');
select throws_ok(
  $$update public.products set price_cents = 120000,
      publication_shipping_reserve_cents = pg_temp.fresh_reserve(100000, 10000)
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'INVALID_OR_STALE_PUBLICATION_ECONOMICS',
  'a snapshot computed for the old price is rejected');
select throws_ok(
  $$update public.products set price_cents = 120000, publication_shipping_reserve_cents = null,
      publication_commission_rate = null, publication_insurance_rate = null
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  '23502', null,
  'a price change cannot clear the snapshot');
select throws_ok(
  $$update public.products set price_cents = 120000, publication_commission_rate = null,
      publication_shipping_reserve_cents = pg_temp.fresh_reserve(120000, 10000)
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  '23502', null,
  'a price change with a partial snapshot is rejected');

-- Every listing holds a snapshot: no value of it can be cleared (S2a, #637) -------
select throws_ok(
  $$update public.products set publication_shipping_reserve_cents = null
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  '23502', null, 'the shipping reserve cannot be cleared');
select throws_ok(
  $$update public.products set publication_commission_rate = null
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  '23502', null, 'the commission rate cannot be cleared');
select throws_ok(
  $$update public.products set publication_insurance_rate = null
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  '23502', null, 'the insurance rate cannot be cleared');
select is(
  (select price_cents::text || ':' || publication_shipping_reserve_cents::text || ':'
     || publication_commission_rate::text || ':' || publication_insurance_rate::text
   from public.products where id = 'd0000000-0000-4000-8000-0000000000a1'),
  (select '100000:' || (pg_temp.fresh_reserve(100000, 10000) - 500)::text || ':'
     || s.service_fee_pct::text || ':' || s.insurance_rate::text
   from public.system_settings s where s.id = 1),
  'the rejected updates left price and snapshot unchanged');

-- A new listing without a full snapshot is rejected -----------------------------
select throws_ok(
  $$select pg_temp.make_listing_with('d0000000-0000-4000-8000-0000000000c1',
      null, s.service_fee_pct, s.insurance_rate)
    from public.system_settings s where s.id = 1$$,
  '23502', null, 'a listing without a shipping reserve is rejected');
select throws_ok(
  $$select pg_temp.make_listing_with('d0000000-0000-4000-8000-0000000000c1',
      pg_temp.fresh_reserve(100000, 10000), null, s.insurance_rate)
    from public.system_settings s where s.id = 1$$,
  '23502', null, 'a listing without a commission rate is rejected');
select throws_ok(
  $$select pg_temp.make_listing_with('d0000000-0000-4000-8000-0000000000c1',
      pg_temp.fresh_reserve(100000, 10000), s.service_fee_pct, null)
    from public.system_settings s where s.id = 1$$,
  '23502', null, 'a listing without an insurance rate is rejected');
select is(
  (select count(*) from public.products where id = 'd0000000-0000-4000-8000-0000000000c1'),
  0::bigint, 'no rejected listing was stored');

-- The owner re-prices through RLS with a fresh snapshot and the listing goes to review.
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.products set price_cents = 120000, shipping_cost_cents = 15000,
      publication_shipping_reserve_cents = pg_temp.fresh_reserve(120000, 15000) - 500,
      status = 'pending_verification'
    where id = 'd0000000-0000-4000-8000-0000000000a3'$$,
  'P0001', 'INVALID_OR_STALE_PUBLICATION_ECONOMICS',
  'the owner cannot re-price with a snapshot from the old settings');
select lives_ok(
  $$update public.products set price_cents = 120000, shipping_cost_cents = 15000,
      publication_shipping_reserve_cents = pg_temp.fresh_reserve(120000, 15000),
      status = 'pending_verification'
    where id = 'd0000000-0000-4000-8000-0000000000a3'$$,
  'the owner re-prices with a snapshot fresh against the current settings');
select throws_ok(
  $$update public.products set publication_commission_rate = 0
    where id = 'd0000000-0000-4000-8000-0000000000a3'$$,
  'P0001', 'PUBLICATION_ECONOMICS_IMMUTABLE',
  'the owner cannot rewrite the snapshot without a price change');
reset role;
select is(
  (select status::text || ':' || price_cents::text || ':' || shipping_cost_cents::text || ':'
     || (publication_shipping_reserve_cents = pg_temp.fresh_reserve(120000, 15000))::text
   from public.products where id = 'd0000000-0000-4000-8000-0000000000a3'),
  'pending_verification:120000:15000:true',
  'the re-priced listing stores the new price and the fresh snapshot');
select lives_ok(
  $$update public.products set status = 'verified', verified_at = now()
    where id = 'd0000000-0000-4000-8000-0000000000a3'$$,
  'the re-priced listing is approved');

select * from finish();
rollback;
