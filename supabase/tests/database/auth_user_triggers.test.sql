-- auth.users keeps one update trigger for fn_on_auth_user_updated, guarded by an
-- email change (#154): a sign-in does not rewrite profiles_private, an email
-- change still mirrors into it. Runs against the local database only:
-- `supabase start`, then `bun run test:db`.
begin;
select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'd2000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'triggers@test.local', '', now(),
  '{}'::jsonb, '{"username": "trigger_user"}'::jsonb, now(), now(), '', '', '', ''
);
update public.profiles_private set updated_at = timestamptz '2026-01-01 00:00:00+00'
where id = 'd2000000-0000-4000-8000-000000000001';

select is(
  (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
     and p.proname = 'fn_on_auth_user_updated'),
  1::bigint, 'one trigger on auth.users runs fn_on_auth_user_updated');
select ok(
  (select pg_get_triggerdef(t.oid) ~ 'WHEN \(\(\(?old\.email\)?(::text)? IS DISTINCT FROM \(?new\.email'
   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
     and p.proname = 'fn_on_auth_user_updated'),
  'that trigger runs only when the email changes');

-- A sign-in (GoTrue updates last_sign_in_at) leaves profiles_private alone.
update auth.users set last_sign_in_at = now() where id = 'd2000000-0000-4000-8000-000000000001';
select is(
  (select updated_at from public.profiles_private where id = 'd2000000-0000-4000-8000-000000000001'),
  timestamptz '2026-01-01 00:00:00+00', 'a sign-in does not rewrite profiles_private');

-- An email change is still mirrored.
update auth.users set email = 'triggers_changed@test.local' where id = 'd2000000-0000-4000-8000-000000000001';
select is(
  (select email from public.profiles_private where id = 'd2000000-0000-4000-8000-000000000001'),
  'triggers_changed@test.local', 'an email change is mirrored into profiles_private');
select isnt(
  (select updated_at from public.profiles_private where id = 'd2000000-0000-4000-8000-000000000001'),
  timestamptz '2026-01-01 00:00:00+00', 'the email change moves profiles_private.updated_at');

select * from finish();
rollback;
