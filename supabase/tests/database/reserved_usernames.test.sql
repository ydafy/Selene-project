-- The "deleted_" username prefix belongs to closed accounts (T8g).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'reserved-a@test.local', '', now(),
  '{}'::jsonb, '{"username": "reserved_user_a"}'::jsonb, now(), now(), '', '', '', ''
);

-- A client cannot claim the reserved prefix -----------------------------------
select set_config('request.jwt.claims',
  '{"sub": "d0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$update public.profiles set username = 'deleted_abc123456789'
    where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'authenticated cannot set a deleted_ username');
select throws_ok(
  $$update public.profiles set username = 'Deleted_Mixed'
    where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'the reserved prefix check ignores case');
reset role;

select is(
  (select username from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  'reserved_user_a', 'the rejected updates left the username unchanged');

-- Signup ---------------------------------------------------------------------
select throws_ok(
  $$insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000002',
      'authenticated', 'authenticated', 'typed@test.local', '',
      '{"username": "deleted_typed01"}'::jsonb, '', '', '', ''
    )$$,
  '23514', null, 'signup with a typed deleted_ username is rejected');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000003',
  'authenticated', 'authenticated', 'deleted@test.local', '', '{}'::jsonb, '', '', '', ''
);
select matches(
  (select username from public.profiles where id = 'd0000000-0000-4000-8000-000000000003'),
  '^user_deleted',
  'signup derives a user_deleted username from a deleted@ email');
select doesnt_match(
  (select username from public.profiles where id = 'd0000000-0000-4000-8000-000000000003'),
  '^deleted',
  'the derived username does not start with the reserved prefix');

-- Closure may write it -------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (public.fn_close_account('d0000000-0000-4000-8000-000000000001'::uuid))->>'status',
  'closed', 'fn_close_account as service_role closes the account');
reset role;
select matches(
  (select username from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  '^deleted_[0-9a-f]{12}$',
  'the closure wrote the reserved deleted_ username');

select * from finish();
rollback;
