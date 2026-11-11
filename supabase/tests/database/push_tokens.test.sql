-- Push token registry (#277 T13): the push_tokens CHECKs, fn_register_push_token
-- (upsert on the token, moves it to the caller, clears the disabled state,
-- refusals in body order) and fn_unregister_push_token (deletes the exact
-- token whoever calls it, anon included). fn_close_account deleting the
-- tokens is asserted in account_closure.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(32);
\ir ../fixtures/money.psql

-- 'ExponentPushToken[' plus p_len 'x' plus ']'.
create function pg_temp.long_token(p_len integer) returns text language sql as $$
  select 'ExponentPushToken[' || repeat('x', p_len) || ']'
$$;
create function pg_temp.token_row(p_token text) returns text language sql as $$
  select user_id::text || ':' || platform || ':' || coalesce(disabled_at::text, 'active') || ':'
    || coalesce(disabled_reason, '-') || ':' || (updated_at = now())::text
  from public.push_tokens where token = p_token
$$;
create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.mu(p_n), 'role', 'authenticated')::text, true)
$$;

select pg_temp.money_user(1301);
select pg_temp.money_user(1302);
select pg_temp.money_user(1303);
update public.profiles set deleted_at = now() where id = pg_temp.mu(1303);

-- 1. Table CHECKs (as the owner, bypassing the RPC) -------------------------
select throws_ok(
  $$insert into public.push_tokens (user_id, token, platform) values (pg_temp.mu(1301), 'ExponentPushToken[t13-web]', 'web')$$,
  '23514', null, 'push_tokens: platform must be ios or android');
select throws_ok(
  $$insert into public.push_tokens (user_id, token, platform) values (pg_temp.mu(1301), 'not-a-token', 'ios')$$,
  '23514', null, 'push_tokens: the token must look like an Expo push token');
select throws_ok(
  $$insert into public.push_tokens (user_id, token, platform) values (pg_temp.mu(1301), 'ExponentPushToken[t13 space]', 'ios')$$,
  '23514', null, 'push_tokens: no whitespace inside the brackets');
select throws_ok(
  $$insert into public.push_tokens (user_id, token, platform) values (pg_temp.mu(1301), pg_temp.long_token(237), 'ios')$$,
  '23514', null, 'push_tokens: a 256-character token is refused');
select lives_ok(
  $$insert into public.push_tokens (user_id, token, platform) values
    (pg_temp.mu(1301), 'ExpoPushToken[t13-short-prefix]', 'android'),
    (pg_temp.mu(1301), pg_temp.long_token(236), 'ios')$$,
  'push_tokens: the ExpoPushToken prefix and a 255-character token are accepted');
select throws_ok(
  $$insert into public.push_tokens (user_id, token, platform) values (pg_temp.mu(1302), 'ExpoPushToken[t13-short-prefix]', 'ios')$$,
  '23505', null, 'push_tokens: a token belongs to one row');

-- 2. fn_register_push_token -------------------------------------------------
select pg_temp.as_user(1301);
set local role authenticated;
select lives_ok($$select public.fn_register_push_token('ExponentPushToken[t13-a]', 'ios')$$,
  'register: the caller registers a token');
reset role;
select is(pg_temp.token_row('ExponentPushToken[t13-a]'),
  pg_temp.mu(1301)::text || ':ios:active:-:true', 'register: the row belongs to the caller and is active');

update public.push_tokens
set disabled_at = now() - interval '1 day', disabled_reason = 'DeviceNotRegistered',
  updated_at = now() - interval '1 day', platform = 'ios'
where token = 'ExponentPushToken[t13-a]';

select pg_temp.as_user(1302);
set local role authenticated;
select lives_ok($$select public.fn_register_push_token('ExponentPushToken[t13-a]', 'android')$$,
  'register: another user registers the same token');
reset role;
select is(pg_temp.token_row('ExponentPushToken[t13-a]'),
  pg_temp.mu(1302)::text || ':android:active:-:true',
  'register: the token moves to the caller, takes the new platform and is active again');
select is((select count(*) from public.push_tokens where token = 'ExponentPushToken[t13-a]'), 1::bigint,
  'register: the upsert keeps one row for the token');

select pg_temp.as_user(1302);
set local role authenticated;
select lives_ok($$select public.fn_register_push_token('ExponentPushToken[t13-a]', 'android')$$,
  'register: registering the same token again succeeds');
select lives_ok($$select public.fn_register_push_token(pg_temp.long_token(236), 'android')$$,
  'register: a 255-character token is accepted');
reset role;
select is((select user_id from public.push_tokens where token = pg_temp.long_token(236)), pg_temp.mu(1302),
  'register: the 255-character token moved to the caller');

-- Refusals, in body order; none of them writes a row.
create temp table t13_before as select id, user_id, token, platform, disabled_at, updated_at from public.push_tokens;

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.fn_register_push_token('ExponentPushToken[t13-nosub]', 'ios')$$,
  'P0001', 'UNAUTHORIZED', 'register: no user in the session raises UNAUTHORIZED');
reset role;

select pg_temp.as_user(1303);
set local role authenticated;
select throws_ok($$select public.fn_register_push_token('ExponentPushToken[t13-closed]', 'ios')$$,
  'P0001', 'ACCOUNT_CLOSED', 'register: a closed account raises ACCOUNT_CLOSED');
select throws_ok($$select public.fn_register_push_token('bad', 'web')$$,
  'P0001', 'ACCOUNT_CLOSED', 'register: ACCOUNT_CLOSED comes before the token and platform checks');
reset role;

select pg_temp.as_user(1301);
set local role authenticated;
select throws_ok($$select public.fn_register_push_token('not-a-token', 'ios')$$,
  'P0001', 'INVALID_PUSH_TOKEN', 'register: a malformed token raises INVALID_PUSH_TOKEN');
select throws_ok($$select public.fn_register_push_token(null, 'ios')$$,
  'P0001', 'INVALID_PUSH_TOKEN', 'register: a NULL token raises INVALID_PUSH_TOKEN');
select throws_ok($$select public.fn_register_push_token(pg_temp.long_token(237), 'ios')$$,
  'P0001', 'INVALID_PUSH_TOKEN', 'register: a 256-character token raises INVALID_PUSH_TOKEN');
select throws_ok($$select public.fn_register_push_token('bad', 'web')$$,
  'P0001', 'INVALID_PUSH_TOKEN', 'register: the token is checked before the platform');
select throws_ok($$select public.fn_register_push_token('ExponentPushToken[t13-web]', 'web')$$,
  'P0001', 'INVALID_PUSH_PLATFORM', 'register: an unknown platform raises INVALID_PUSH_PLATFORM');
select throws_ok($$select public.fn_register_push_token('ExponentPushToken[t13-web]', null)$$,
  'P0001', 'INVALID_PUSH_PLATFORM', 'register: a NULL platform raises INVALID_PUSH_PLATFORM');
reset role;

select is(
  (select count(*) from (
    (select id, user_id, token, platform, disabled_at, updated_at from public.push_tokens
     except all select * from t13_before)
    union all
    (select * from t13_before
     except all select id, user_id, token, platform, disabled_at, updated_at from public.push_tokens)) d),
  0::bigint, 'register: the refusals wrote nothing');

-- 3. fn_unregister_push_token -----------------------------------------------
insert into public.push_tokens (user_id, token, platform) values
  (pg_temp.mu(1302), 'ExponentPushToken[t13-b1]', 'ios'),
  (pg_temp.mu(1302), 'ExponentPushToken[t13-b2]', 'android');

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select lives_ok($$select public.fn_unregister_push_token('ExponentPushToken[t13-b1]')$$,
  'unregister: anon can unregister a token by its value');
reset role;
select is((select count(*) from public.push_tokens where token = 'ExponentPushToken[t13-b1]'), 0::bigint,
  'unregister: anon deleted the exact token');

select pg_temp.as_user(1301);
set local role authenticated;
select lives_ok($$select public.fn_unregister_push_token('ExponentPushToken[t13-b2]')$$,
  'unregister: a user can unregister a token of another user');
reset role;
select is((select count(*) from public.push_tokens where token = 'ExponentPushToken[t13-b2]'), 0::bigint,
  'unregister: the other user''s token is deleted');

drop table t13_before;
create temp table t13_before as select id, user_id, token, platform, disabled_at, updated_at from public.push_tokens;

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select public.fn_unregister_push_token('ExponentPushToken[t13 b]')$$,
  'P0001', 'INVALID_PUSH_TOKEN', 'unregister: a malformed token raises INVALID_PUSH_TOKEN');
select throws_ok($$select public.fn_unregister_push_token(null)$$,
  'P0001', 'INVALID_PUSH_TOKEN', 'unregister: a NULL token raises INVALID_PUSH_TOKEN');
select lives_ok($$select public.fn_unregister_push_token('ExponentPushToken[t13-missing]')$$,
  'unregister: a missing token is a no-op');
reset role;
select is(
  (select count(*) from (
    (select id, user_id, token, platform, disabled_at, updated_at from public.push_tokens
     except all select * from t13_before)
    union all
    (select * from t13_before
     except all select id, user_id, token, platform, disabled_at, updated_at from public.push_tokens)) d),
  0::bigint, 'unregister: the refusals and the missing token changed no row');

select * from finish();
rollback;
