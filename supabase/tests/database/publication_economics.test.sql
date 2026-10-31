-- The publication-economics trigger only guards listings that are on sale (T9f, #69).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'economics@test.local', '', now(),
  '{}'::jsonb, '{"username": "economics_seller"}'::jsonb, now(), now(), '', '', '', ''
);

-- Two VERIFIED listings, both priced under the current settings.
insert into public.products (
  id, name, description, price, category, condition, usage, images, status,
  specifications, seller_id, shipping_cost, origin_zip, package_preset,
  publication_shipping_reserve_cents, publication_commission_rate, publication_insurance_rate
)
select p.id, 'Test GPU', 'Test listing', 1000, 'GPU', 'used', 'gaming',
  array['https://example.test/p.png'], 'VERIFIED', '{}'::jsonb,
  'd0000000-0000-4000-8000-000000000001', 100, '06600', 'gpu_1',
  round(100 * 100)::bigint + s.shipping_buffer_cents
    + ceil(round(1000 * 100)::numeric * public.normalize_publication_rate(s.insurance_rate))::bigint,
  public.normalize_publication_rate(s.service_fee_pct),
  public.normalize_publication_rate(s.insurance_rate)
from public.system_settings s
cross join (values
  ('d0000000-0000-4000-8000-0000000000a1'::uuid),
  ('d0000000-0000-4000-8000-0000000000a2'::uuid)
) as p(id)
where s.id = 1;

-- Hide one listing, then make both snapshots stale.
update public.products set status = 'HIDDEN' where id = 'd0000000-0000-4000-8000-0000000000a1';
update public.system_settings set shipping_buffer_cents = shipping_buffer_cents + 500 where id = 1;

select lives_ok(
  $$update public.products set status = 'HIDDEN' where id = 'd0000000-0000-4000-8000-0000000000a2'$$,
  'taking a stale listing off sale is allowed');
select lives_ok(
  $$update public.products set deleted_at = now() where id = 'd0000000-0000-4000-8000-0000000000a2'$$,
  'soft-deleting a stale listing is allowed');

select throws_ok(
  $$update public.products set status = 'VERIFIED' where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'INVALID_OR_STALE_PUBLICATION_ECONOMICS',
  'HIDDEN -> VERIFIED with a stale snapshot is rejected');
select throws_ok(
  $$update public.products set status = 'RESERVED', reserved_at = now()
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'INVALID_OR_STALE_PUBLICATION_ECONOMICS',
  'HIDDEN -> RESERVED with a stale snapshot is rejected');
select throws_ok(
  $$update public.products set publication_shipping_reserve_cents = 1
    where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'PUBLICATION_ECONOMICS_IMMUTABLE',
  'the snapshot cannot be rewritten to match');
select is(
  (select status::text from public.products where id = 'd0000000-0000-4000-8000-0000000000a1'),
  'HIDDEN', 'the rejected updates left the listing hidden');

-- With the settings back, the same transition is accepted.
update public.system_settings set shipping_buffer_cents = shipping_buffer_cents - 500 where id = 1;
select lives_ok(
  $$update public.products set status = 'VERIFIED' where id = 'd0000000-0000-4000-8000-0000000000a1'$$,
  'HIDDEN -> VERIFIED with a fresh snapshot is accepted');

select * from finish();
rollback;
