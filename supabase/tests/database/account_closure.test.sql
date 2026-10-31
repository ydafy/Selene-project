-- fn_close_account: refusal changes nothing, closure anonymizes, and a stale
-- listing no longer blocks it (T5a, T9f, #69).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(24);

-- Same economics formula as validate_product_publication_economics.
create function pg_temp.make_product(p_id uuid, p_seller uuid, p_status public.product_status_enum)
returns void language sql as $$
  insert into public.products (
    id, name, description, price, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost, origin_zip, package_preset,
    reserved_at, publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select p_id, 'Test GPU', 'Test listing', 1000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status, '{}'::jsonb, p_seller, 100, '06600', 'gpu_1',
    case when p_status = 'RESERVED' then now() end,
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
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'blocked@test.local', 'closure_blocked'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'plain@test.local', 'closure_plain'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'stale@test.local', 'closure_stale'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, 'other@test.local', 'closure_other')
) as u(id, email, username);

-- 1 blocker: a reserved listing; 2 plain: a verified listing and a favorite.
select pg_temp.make_product('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000001', 'RESERVED');
select pg_temp.make_product('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-000000000002', 'VERIFIED');
insert into public.favorites (user_id, product_id)
values ('d0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-0000000000a2');

-- Only the service role may close an account ----------------------------------
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.fn_close_account('d0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated cannot execute fn_close_account');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$select public.fn_close_account('d0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon cannot execute fn_close_account');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

-- Refused while a blocker exists: nothing changes ------------------------------
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000001'::uuid))->>'status',
  'blocked', 'a reserved listing blocks the closure');
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000001'::uuid))->>'reason',
  'active_shipments', 'the blocked answer names the reason');
reset role;
select is(
  (select username from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  'closure_blocked', 'blocked: the username is unchanged');
select is(
  (select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  null, 'blocked: the profile is not soft-deleted');
select is(
  (select email from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000001'),
  'blocked@test.local', 'blocked: the private email is kept');
select is(
  (select status::text from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000001'),
  'active', 'blocked: the account status is unchanged');
select is(
  (select status::text from public.products where id = 'd0000000-0000-4000-8000-0000000000a1'),
  'RESERVED', 'blocked: the listing is unchanged');
select is(
  (select email from auth.users where id = 'd0000000-0000-4000-8000-000000000001'),
  'blocked@test.local', 'blocked: the auth email is kept');
select is(
  (select count(*) from public.account_closures where user_id = 'd0000000-0000-4000-8000-000000000001'),
  0::bigint, 'blocked: no closure is recorded');

-- Closes and anonymizes otherwise ----------------------------------------------
set local role service_role;
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000002'::uuid))->>'status',
  'closed', 'an account with no blocker closes');
reset role;
select matches(
  (select username from public.profiles where id = 'd0000000-0000-4000-8000-000000000002'),
  '^deleted_[0-9a-f]{12}$', 'closed: the username is anonymized');
select isnt(
  (select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000002'),
  null, 'closed: the profile is soft-deleted');
select is(
  (select email from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000002'),
  null, 'closed: the private email is removed');
select is(
  (select status::text from public.profiles_private where id = 'd0000000-0000-4000-8000-000000000002'),
  'banned', 'closed: the account stays banned');
select is(
  (select email from auth.users where id = 'd0000000-0000-4000-8000-000000000002'),
  null, 'closed: the auth email is removed');
select ok(
  (select banned_until > now() + interval '100 years' from auth.users where id = 'd0000000-0000-4000-8000-000000000002'),
  'closed: the auth user is banned for good');
select is(
  (select count(*) from public.favorites where user_id = 'd0000000-0000-4000-8000-000000000002'),
  0::bigint, 'closed: favorites are deleted');
select is(
  (select status::text || ':' || (deleted_at is not null)::text from public.products where id = 'd0000000-0000-4000-8000-0000000000a2'),
  'HIDDEN:true', 'closed: the listing is hidden and soft-deleted');
select is(
  (select count(*) from public.account_closures where user_id = 'd0000000-0000-4000-8000-000000000002'),
  1::bigint, 'closed: the closure is recorded');
set local role service_role;
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000002'::uuid))->>'status',
  'already_closed', 'a second call is idempotent');
reset role;

-- A listing whose publication economics went stale no longer blocks it (#69) ---
select pg_temp.make_product('d0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-000000000003', 'VERIFIED');
update public.system_settings set shipping_buffer_cents = shipping_buffer_cents + 500 where id = 1;
set local role service_role;
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000003'::uuid))->>'status',
  'closed', 'a stale listing does not abort the closure');
reset role;
select is(
  (select status::text || ':' || (deleted_at is not null)::text from public.products where id = 'd0000000-0000-4000-8000-0000000000a3'),
  'HIDDEN:true', 'the stale listing is hidden and soft-deleted');

select * from finish();
rollback;
