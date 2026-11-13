-- Account closure cleanup queue: fn_claim_account_closures hands the retry
-- worker the closures with an open cleanup step, and fn_record_closure_attempt
-- stamps the outcome of one attempt. account_closures stays server-only.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(27);
\ir ../fixtures/money.psql

-- One closure row per user n, written as the table owner. p_age sets updated_at
-- to now() minus it (now() is fixed for the whole transaction).
create function pg_temp.closure(
  p_n integer, p_customer text, p_account text, p_storage text,
  p_attempts integer, p_age interval
) returns void language sql as $$
  insert into internal.account_closures (
    user_id, stripe_customer_cleanup, stripe_account_cleanup, storage_cleanup,
    attempts, updated_at
  ) values (pg_temp.mu(p_n), p_customer, p_account, p_storage, p_attempts, now() - p_age)
$$;

-- attempts:age-in-minutes:last_error of closure n, read as the owner.
create function pg_temp.state(p_n integer) returns text language sql as $$
  select attempts || ':' || round(extract(epoch from now() - updated_at) / 60)::text
    || ':' || coalesce(last_error, '-')
  from internal.account_closures where user_id = pg_temp.mu(p_n)
$$;

-- The claimed user numbers, sorted. The claim picks the oldest rows but
-- returns them in UPDATE order, which SQL does not define.
create function pg_temp.claimed(p_limit integer, p_idle interval, p_max integer)
returns text language sql as $$
  select coalesce(string_agg(right(c.user_id::text, 2), ',' order by c.user_id), '')
  from public.fn_claim_account_closures(p_limit, p_idle, p_max) as c
$$;

select pg_temp.money_user(n) from generate_series(1, 9) as n;

-- The claims below see the whole table, so closures left by a Bruno run or an
-- aborted test would join their batches (#492). Remove them for this
-- transaction only; the rollback at the end restores them.
delete from internal.account_closures;

-- Claimable with idle 30 minutes and max 5 attempts: 07 (4 h, attempts 4, a
-- failed account step), 01 (3 h, all pending), 02 (2 h, a failed customer
-- step), 03 (1 h, only storage pending), 08 (exactly 30 minutes).
-- Not claimable: 04 (every step closed), 05 (at the attempt limit),
-- 06 (touched 10 minutes ago), 09 (a failed step but updated just now).
select pg_temp.closure(1, 'pending', 'pending', 'pending', 0, interval '3 hours');
select pg_temp.closure(2, 'failed', 'done', 'done', 1, interval '2 hours');
select pg_temp.closure(3, 'not_needed', 'done', 'pending', 0, interval '1 hour');
select pg_temp.closure(4, 'done', 'not_needed', 'done', 0, interval '5 hours');
select pg_temp.closure(5, 'pending', 'pending', 'pending', 5, interval '5 hours');
select pg_temp.closure(6, 'pending', 'pending', 'pending', 4, interval '10 minutes');
select pg_temp.closure(7, 'done', 'failed', 'done', 4, interval '4 hours');
select pg_temp.closure(8, 'pending', 'not_needed', 'done', 2, interval '30 minutes');
select pg_temp.closure(9, 'failed', 'done', 'done', 0, interval '0 minutes');

-- Clients read nothing: RLS on, no policy, no client access ------------------
select is(
  (select relrowsecurity from pg_class where oid = 'internal.account_closures'::regclass),
  true, 'account_closures has RLS enabled');
select is(
  (select count(*) from pg_policies where schemaname = 'internal' and tablename = 'account_closures'),
  0::bigint, 'account_closures has no policy');
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(1), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select count(*) from internal.account_closures$$,
  '42501', null, 'authenticated cannot read account_closures, not even its own row');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$select count(*) from internal.account_closures$$,
  '42501', null, 'anon cannot read account_closures');
reset role;

-- Only the service role passes the role check --------------------------------
-- Run as the owner with client claims, so the body check answers, not the grant.
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(1), 'role', 'authenticated')::text, true);
select throws_ok(
  $$select * from public.fn_claim_account_closures(10, interval '30 minutes', 5)$$,
  'P0001', 'UNAUTHORIZED', 'the claim refuses an authenticated caller');
select throws_ok(
  $$select public.fn_record_closure_attempt(pg_temp.mu(4), 'x', true)$$,
  'P0001', 'UNAUTHORIZED', 'recording refuses an authenticated caller');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$select * from public.fn_claim_account_closures(10, interval '30 minutes', 5)$$,
  'P0001', 'UNAUTHORIZED', 'the claim refuses an anon caller');
select throws_ok(
  $$select public.fn_record_closure_attempt(pg_temp.mu(4), 'x', true)$$,
  'P0001', 'UNAUTHORIZED', 'recording refuses an anon caller');

-- Unusable arguments ----------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select throws_ok(
  $$select * from public.fn_claim_account_closures(0, interval '30 minutes', 5)$$,
  'P0001', 'INVALID_ARGUMENT', 'a limit below 1 is refused');
select throws_ok(
  $$select * from public.fn_claim_account_closures(101, interval '30 minutes', 5)$$,
  'P0001', 'INVALID_ARGUMENT', 'a limit above 100 is refused');
select throws_ok(
  $$select * from public.fn_claim_account_closures(null, interval '30 minutes', 5)$$,
  'P0001', 'INVALID_ARGUMENT', 'a NULL limit is refused');
select throws_ok(
  $$select * from public.fn_claim_account_closures(10, interval '-1 minute', 5)$$,
  'P0001', 'INVALID_ARGUMENT', 'a negative idle time is refused');
select throws_ok(
  $$select * from public.fn_claim_account_closures(10, interval '30 minutes', 0)$$,
  'P0001', 'INVALID_ARGUMENT', 'a max attempts below 1 is refused');

-- Claim: open, idle, below the limit, oldest first, bounded --------------------
select is(pg_temp.claimed(3, interval '30 minutes', 5), '01,02,07',
  'with a limit of 3 the claim takes the three oldest claimable closures');
reset role;
select is(
  pg_temp.state(7) || ' ' || pg_temp.state(1) || ' ' || pg_temp.state(2),
  '5:0:- 1:0:- 2:0:-', 'the claim adds one attempt and stamps updated_at on each claimed row');
select is(
  pg_temp.state(3) || ' ' || pg_temp.state(4) || ' ' || pg_temp.state(5) || ' '
    || pg_temp.state(6) || ' ' || pg_temp.state(8) || ' ' || pg_temp.state(9),
  '0:60:- 0:300:- 5:300:- 4:10:- 2:30:- 0:0:-',
  'the claim leaves every row it did not return unchanged');
set local role service_role;
select is(pg_temp.claimed(100, interval '30 minutes', 5), '03,08',
  'the next claim skips the rows just claimed and includes a row idle exactly the minimum');
select is(pg_temp.claimed(2, interval '0 minutes', 6), '05,06',
  'with no idle time the two oldest open rows win the batch over rows touched now');
select is(pg_temp.claimed(4, interval '0 minutes', 6), '01,02,03,06',
  'rows with the same updated_at go in user id order; 05 reached the limit');
reset role;
select is(pg_temp.state(4), '0:300:-', 'a closure with every step closed is never claimed');

-- Recording an attempt --------------------------------------------------------
update internal.account_closures set updated_at = now() - interval '2 hours', attempts = 1
where user_id in (pg_temp.mu(4), pg_temp.mu(5), pg_temp.mu(6));
set local role service_role;
select public.fn_record_closure_attempt(pg_temp.mu(4), repeat('e', 600), true);
select public.fn_record_closure_attempt(pg_temp.mu(5), 'stripe timeout', false);
select public.fn_record_closure_attempt(pg_temp.mu(99), 'no such closure', true);
reset role;
select is(
  (select attempts from internal.account_closures where user_id = pg_temp.mu(4)),
  2, 'p_count_attempt true adds one attempt');
select is(
  (select last_error from internal.account_closures where user_id = pg_temp.mu(4)),
  repeat('e', 500), 'last_error keeps the first 500 characters');
select is(
  (select attempts from internal.account_closures where user_id = pg_temp.mu(5)),
  1, 'p_count_attempt false keeps the attempt count');
select is(
  (select last_error from internal.account_closures where user_id = pg_temp.mu(5)),
  'stripe timeout', 'p_count_attempt false still records last_error');
select is(
  pg_temp.state(4) || ' ' || pg_temp.state(5),
  '2:0:' || repeat('e', 500) || ' 1:0:stripe timeout',
  'recording stamps updated_at on the named closure');
select is(pg_temp.state(6), '1:120:-', 'recording leaves the other closures unchanged');
select is(
  (select count(*) from internal.account_closures where last_error = 'no such closure'),
  0::bigint, 'recording for a user without a closure writes nothing');

select * from finish();
rollback;
