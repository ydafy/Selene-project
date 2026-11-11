-- Username provisioning on signup (fn_on_auth_user_created and
-- fn_generate_profile_username): a typed username is validated and kept as
-- typed; otherwise one is derived from full_name, name or the email prefix,
-- cleaned to the profile charset, clamped to 20 and suffixed on a collision.
-- The reserved "deleted_" prefix is in reserved_usernames.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(16);
\ir ../fixtures/money.psql

-- The statement Auth runs on signup for user n.
create function pg_temp.signup_sql(p_n integer, p_email text, p_meta jsonb) returns text
language sql as $$
  select format($f$
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', %L, 'authenticated', 'authenticated',
      %L, '', now(), '{}'::jsonb, %L::jsonb, now(), now(), '', '', '', ''
    )$f$, pg_temp.mu(p_n), p_email, p_meta::text)
$$;

-- Signs user n up and returns the profile username, or the error it raised.
create function pg_temp.signup(p_n integer, p_email text, p_meta jsonb) returns text
language plpgsql as $$
begin
  execute pg_temp.signup_sql(p_n, p_email, p_meta);
  return (select username from public.profiles where id = pg_temp.mu(p_n));
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- A typed username -------------------------------------------------------------
select throws_ok(
  pg_temp.signup_sql(101, 'short@test.local', '{"username": "ab"}'),
  '23514', 'Username must be between 3 and 20 characters',
  'a typed username shorter than 3 characters is refused');
select throws_ok(
  pg_temp.signup_sql(102, 'long@test.local', '{"username": "abcdefghijklmnopqrstu"}'),
  '23514', 'Username must be between 3 and 20 characters',
  'a typed username longer than 20 characters is refused');
select is(pg_temp.signup(103, 'three@test.local', '{"username": "abc"}'), 'abc',
  'a typed username of 3 characters is accepted');
select is(pg_temp.signup(104, 'twenty@test.local', '{"username": "t2345678901234567890"}'),
  't2345678901234567890', 'a typed username of 20 characters is accepted');
select is(pg_temp.signup(105, 'typed@test.local', '{"username": "Typed.Name"}'), 'Typed.Name',
  'a typed username is stored as typed, not coerced');
select throws_ok(
  pg_temp.signup_sql(106, 'taken@test.local', '{"username": "abc"}'),
  '23505', 'Username "abc" is already taken',
  'a typed username that is taken is refused');
select is(
  (select count(*) from auth.users where id in (pg_temp.mu(101), pg_temp.mu(102), pg_temp.mu(106)))
    + (select count(*) from public.profiles where id in (pg_temp.mu(101), pg_temp.mu(102), pg_temp.mu(106))),
  0::bigint, 'a refused signup stores no auth user and no profile');

-- A derived username -------------------------------------------------------------
select is(
  pg_temp.signup(111, 'fullname@test.local', '{"full_name": "José Pérez", "name": "Ignored Name"}'),
  'joseperez', 'full_name comes first, accents folded and spaces removed');
select is(
  pg_temp.signup(112, 'name@test.local', '{"full_name": "   ", "name": "Ana.Maria_99"}'),
  'ana.maria_99', 'a blank full_name falls back to name');
select is(
  pg_temp.signup(113, 'Prefix.Only+tag@test.local', '{}'),
  'prefix.onlytag', 'with no name the email prefix is used');
select is(
  pg_temp.signup(114, 'charset@test.local', '{"name": "Ñandú-Bar C!d#_1.2"}'),
  'nandubarcd_1.2', 'only a-z, 0-9, underscore and dot are kept');
select is(
  pg_temp.signup(115, 'clamp@test.local', '{"name": "abcdefghijklmnopqrstuvwxyz"}'),
  'abcdefghijklmnopqrst', 'a derived username is clamped to 20 characters');
select is(
  pg_temp.signup(116, 'tiny@test.local', '{"name": "x"}'),
  'xuser', 'a base shorter than 3 characters gets "user" appended');

-- A collision gets a numeric suffix ---------------------------------------------
select pg_temp.signup(117, 'owner@test.local', '{"username": "collide_me"}');
select matches(
  pg_temp.signup(118, 'collide@test.local', '{"name": "collide_me"}'),
  '^collide_me_[0-9]{4}$', 'a taken derived username gets an underscore and four digits');
select matches(
  pg_temp.signup(119, 'clamp2@test.local', '{"name": "abcdefghijklmnopqrstuvwxyz"}'),
  '^abcdefghijklmno_[0-9]{4}$', 'the suffix fits inside 20 characters by trimming the base');

-- The private profile -------------------------------------------------------------
select is(
  (select role || ':' || status::text || ':' || email from public.profiles_private where id = pg_temp.mu(113)),
  'user:active:Prefix.Only+tag@test.local', 'signup creates profiles_private with role user, status active and the email');

select * from finish();
rollback;
