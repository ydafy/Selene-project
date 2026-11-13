-- Stripe fee reconciliation, part 1 (#276, T6): grants of the three leased job
-- RPCs, the dropped tokenless RPCs, the internal.stripe_fee_reconciliation_jobs
-- ledger (internal-schema T6: no role but its owner holds a privilege), and
-- the leased claim fn_claim_stripe_fee_reconciliation_jobs_leased (policy
-- bounds, due and expired-lease selection, legacy tokenless adoption, attempt
-- exhaustion, batch size and order). Transition and completion are in
-- stripe_fee_reconciliation_completion.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(63);
\ir ../fixtures/money.psql

-- Runs p_setup and p_query inside a subtransaction that always rolls back and
-- returns p_query's value. An error other than the rollback marker propagates,
-- so throws_ok works on it.
create function pg_temp.peek(p_setup text, p_query text)
returns text language plpgsql as $$
declare
  v text;
begin
  begin
    execute p_setup;
    execute p_query into v;
    raise exception 'peek_rollback';
  exception when raise_exception then
    if sqlerrm <> 'peek_rollback' then
      raise;
    end if;
  end;
  return v;
end $$;

-- A paid order of buyer 1 with payment intent pi_fee_<n>.
create function pg_temp.fee_order(p_n integer) returns uuid language sql as $$
  insert into public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id)
  values (pg_temp.mu(p_n), pg_temp.mu(1), 1000, '{}'::jsonb, 'paid', 'pi_fee_' || p_n)
  returning id
$$;

-- A reconciliation job p_n for order p_n (created with it), with the column
-- defaults.
create function pg_temp.fee_job(p_n integer) returns uuid language sql as $$
  select pg_temp.fee_order(p_n);
  insert into internal.stripe_fee_reconciliation_jobs (id, order_id, stripe_payment_intent_id)
  values (pg_temp.mu(p_n), pg_temp.mu(p_n), 'pi_fee_' || p_n)
  returning id
$$;

create function pg_temp.j(p_n integer) returns internal.stripe_fee_reconciliation_jobs language sql as $$
  select * from internal.stripe_fee_reconciliation_jobs where id = pg_temp.mu(p_n)
$$;

create function pg_temp.set_job(p_n integer, p_set text) returns text language sql as $$
  select format('update internal.stripe_fee_reconciliation_jobs set %s where id = %L', p_set, pg_temp.mu(p_n))
$$;

-- The ids a claim with p_args returns after p_setup, sorted, or 'none'.
create function pg_temp.claimed(p_setup text, p_args text default '')
returns text language sql as $$
  select pg_temp.peek(p_setup, format(
    'select coalesce(string_agg(id::text, '','' order by id), ''none'')
     from public.fn_claim_stripe_fee_reconciliation_jobs_leased(%s)', p_args))
$$;

create table pg_temp.got (
  seq serial, id uuid, status text, attempt_count integer, claim_token uuid,
  claim_expires_at timestamptz, next_retry_at timestamptz, updated_at timestamptz
);
create function pg_temp.claim(p_limit integer default 25) returns setof uuid language sql as $$
  insert into pg_temp.got (id, status, attempt_count, claim_token, claim_expires_at, next_retry_at, updated_at)
  select id, status, attempt_count, claim_token, claim_expires_at, next_retry_at, updated_at
  from public.fn_claim_stripe_fee_reconciliation_jobs_leased(p_limit, 3)
  returning id
$$;

select pg_temp.money_user(1);
-- The RPCs read the wall clock (clock_timestamp()), not the transaction start
-- (now()). After this pause a time of now() + 10 ms is already in the past.
select pg_sleep(0.05);

-- Grants: service_role only, behind SECURITY DEFINER with a fixed search_path.
select is(
  (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
   from pg_proc p, aclexplode(p.proacl) a
   where p.oid = f::regprocedure and a.privilege_type = 'EXECUTE'),
  array['postgres', 'service_role'],
  f || ' is executable by service_role only'
) from unnest(array[
  'public.fn_claim_stripe_fee_reconciliation_jobs_leased(integer,integer)',
  'public.fn_transition_stripe_fee_reconciliation_job_leased(uuid,uuid,text,timestamptz,text)',
  'public.fn_complete_stripe_fee_reconciliation_job_leased(uuid,uuid,bigint,timestamptz)'
]) as f;
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
     and p.proname in ('fn_claim_stripe_fee_reconciliation_jobs_leased',
       'fn_transition_stripe_fee_reconciliation_job_leased', 'fn_complete_stripe_fee_reconciliation_job_leased')),
  3, 'the three job RPCs are SECURITY DEFINER with search_path public, pg_temp'
);
select is(
  (select count(*)::integer from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'internal.stripe_fee_reconciliation_jobs'::regclass
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))),
  0, 'the job ledger grants nothing to PUBLIC, anon or authenticated'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'internal.stripe_fee_reconciliation_jobs'::regclass),
  'the job ledger has row level security on'
);
select ok(
  (select not bool_or(has_table_privilege('service_role', 'internal.stripe_fee_reconciliation_jobs', p))
   from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p),
  'service_role holds no privilege on the job ledger (the webhook enqueues through fn_enqueue_stripe_fee_reconciliation_job)'
);

set local role anon;
select throws_ok('select * from public.fn_claim_stripe_fee_reconciliation_jobs_leased()', '42501', null,
  'anon cannot claim fee reconciliation jobs');
reset role;
set local role authenticated;
select throws_ok('select public.fn_complete_stripe_fee_reconciliation_job_leased(gen_random_uuid(), gen_random_uuid(), 1, now())',
  '42501', null, 'authenticated cannot complete a fee reconciliation job');
reset role;

-- The role check inside each RPC, for a caller that could execute it.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok(q, '42501', 'UNAUTHORIZED', 'a caller without the service_role claim is refused by ' || f)
from (values
  ('fn_claim_stripe_fee_reconciliation_jobs_leased', 'select * from public.fn_claim_stripe_fee_reconciliation_jobs_leased()'),
  ('fn_transition_stripe_fee_reconciliation_job_leased',
   $$select public.fn_transition_stripe_fee_reconciliation_job_leased(gen_random_uuid(), gen_random_uuid(), 'failed', null, 'x')$$),
  ('fn_complete_stripe_fee_reconciliation_job_leased',
   'select public.fn_complete_stripe_fee_reconciliation_job_leased(gen_random_uuid(), gen_random_uuid(), 1, now())')
) as t(f, q);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- The tokenless RPCs, which only raised STRIPE_FEE_LEASE_REQUIRED, are dropped:
-- only the leased ones exist.
select hasnt_function('public', 'fn_claim_stripe_fee_reconciliation_jobs',
  'the tokenless claim fn_claim_stripe_fee_reconciliation_jobs no longer exists');
select hasnt_function('public', 'fn_transition_stripe_fee_reconciliation_job',
  'the tokenless transition fn_transition_stripe_fee_reconciliation_job no longer exists');
select hasnt_function('public', 'fn_complete_stripe_fee_reconciliation_job',
  'the tokenless completion fn_complete_stripe_fee_reconciliation_job no longer exists');

-- Claim policy bounds (no job exists yet).
select throws_ok(format('select * from public.fn_claim_stripe_fee_reconciliation_jobs_leased(%s)', a),
  '22023', 'INVALID_CLAIM_POLICY', 'a claim with (' || a || ') is rejected')
from unnest(array['null, 3', '0, 3', '101, 3', '25, null', '25, 0', '25, 101']) as a;
select is(pg_temp.claimed('select 1', '100, 100'), 'none', 'a claim with limit 100 and 100 attempts is accepted');
select is(pg_temp.claimed('select 1', '1, 1'), 'none', 'a claim with limit 1 and 1 attempt is accepted');

-- The ledger: defaults and CHECKs.
select pg_temp.fee_job(10);
select ok(
  (select status = 'pending' and attempt_count = 0 and claim_token is null and claim_expires_at is null
     and next_retry_at is null and last_error is null from pg_temp.j(10)),
  'a new job is pending, with no attempt, claim, retry time or error'
);
select throws_ok(pg_temp.set_job(10, $$status = 'bogus'$$), '23514', null, 'a status outside the four states is rejected');
select throws_ok(pg_temp.set_job(10, 'attempt_count = 101'), '23514', null, 'more than 100 attempts are rejected');
select throws_ok(pg_temp.set_job(10, 'attempt_count = -1'), '23514', null, 'a negative attempt count is rejected');
select throws_ok(pg_temp.set_job(10, $$last_error = repeat('x', 4001)$$), '23514', null,
  'an error longer than 4000 characters is rejected');
select throws_ok(pg_temp.set_job(10, $$stripe_payment_intent_id = ''$$), '23514', null,
  'an empty payment intent id is rejected');
select throws_ok(format($$insert into internal.stripe_fee_reconciliation_jobs (order_id, stripe_payment_intent_id)
  values (%L, 'pi_fee_10')$$, pg_temp.mu(10)), '23505', null,
  'a second job for the same order and payment intent is rejected');
select throws_ok(format('delete from public.orders where id = %L', pg_temp.mu(10)), '23503', null,
  'an order with a reconciliation job cannot be deleted');

-- Claim selection, each case on job 10 alone.
select is(pg_temp.claimed('select 1'), pg_temp.mu(10)::text, 'a pending job with no retry time is claimed');
select is(pg_temp.claimed(pg_temp.set_job(10, $$next_retry_at = now() + interval '10 ms'$$)), pg_temp.mu(10)::text,
  'a pending job whose retry time passed on the wall clock is claimed');
select is(pg_temp.claimed(pg_temp.set_job(10, $$next_retry_at = clock_timestamp() + interval '1 hour'$$)), 'none',
  'a pending job whose retry time is ahead is not claimed');
select is(pg_temp.claimed(pg_temp.set_job(10, $$status = 'processing', claim_token = gen_random_uuid(),
  claim_expires_at = clock_timestamp() + interval '1 hour'$$)), 'none', 'a job under an active lease is not claimed');
select is(pg_temp.claimed(pg_temp.set_job(10, $$status = 'processing', claim_token = gen_random_uuid(),
  claim_expires_at = now() + interval '10 ms'$$)), pg_temp.mu(10)::text,
  'a job whose lease expired on the wall clock is claimed');
select is(pg_temp.claimed(pg_temp.set_job(10, $$status = 'processing',
  updated_at = now() - interval '5 minutes' + interval '10 ms'$$)), pg_temp.mu(10)::text,
  'a tokenless processing job idle for 5 minutes on the wall clock is adopted');
select is(pg_temp.claimed(pg_temp.set_job(10, $$status = 'processing', updated_at = clock_timestamp() - interval '4 minutes'$$)),
  'none', 'a tokenless processing job idle for less than 5 minutes is not adopted');
select is(pg_temp.claimed(pg_temp.set_job(10, $$status = 'processing', claim_token = gen_random_uuid(),
  updated_at = now() - interval '1 hour'$$)), 'none', 'a processing job with a token and no lease expiry is not adopted');
select is(pg_temp.claimed(pg_temp.set_job(10, $$status = 'processing',
  claim_expires_at = clock_timestamp() + interval '1 hour', updated_at = now() - interval '1 hour'$$)), 'none',
  'a tokenless processing job with an active lease expiry is not adopted');
select is(pg_temp.claimed(pg_temp.set_job(10, $$status = 'succeeded'$$)), 'none', 'a succeeded job is not claimed');
select is(pg_temp.claimed(pg_temp.set_job(10, $$status = 'failed'$$)), 'none', 'a failed job is not claimed');
select is(pg_temp.claimed(pg_temp.set_job(10, 'attempt_count = 2')), pg_temp.mu(10)::text,
  'with the default of 3 attempts, a job with 2 attempts is claimed');
select is(pg_temp.claimed(pg_temp.set_job(10, 'attempt_count = 3')), 'none',
  'with the default of 3 attempts, a job with 3 attempts is not claimed');
select is(pg_temp.claimed(pg_temp.set_job(10, 'attempt_count = 5'), '25, 6'), pg_temp.mu(10)::text,
  'the attempt limit comes from p_max_attempts');

-- A claim leases the job under a new token.
update internal.stripe_fee_reconciliation_jobs
set next_retry_at = now() - interval '1 hour', updated_at = now() - interval '1 hour', last_error = 'earlier'
where id = pg_temp.mu(10);
select is(array(select pg_temp.claim()), array[pg_temp.mu(10)], 'a due pending job is claimed');
select ok(
  (select g.status = 'processing' and j.status = 'processing' and g.claim_token is not null
     and g.claim_token = j.claim_token from pg_temp.got g, pg_temp.j(10) j where g.seq = 1),
  'the claim moves the job to processing and returns its stored token'
);
select is((select attempt_count from pg_temp.j(10)), 1, 'the claim counts the attempt');
select ok(
  (select claim_expires_at > now() + interval '5 minutes' and claim_expires_at <= clock_timestamp() + interval '5 minutes'
   from pg_temp.j(10)),
  'the lease ends 5 minutes after the claim on the wall clock'
);
select is((select next_retry_at from pg_temp.j(10)), null, 'the claim clears the retry time');
select ok((select updated_at > now() from pg_temp.j(10)), 'the claim stamps updated_at with the wall clock');
select is(array(select pg_temp.claim()), '{}'::uuid[], 'a leased job is not claimed again');
update internal.stripe_fee_reconciliation_jobs set claim_expires_at = now() - interval '1 second' where id = pg_temp.mu(10);
select is(array(select pg_temp.claim()), array[pg_temp.mu(10)], 'a job whose lease expired is claimed again');
select ok(
  (select b.claim_token <> a.claim_token and j.claim_token = b.claim_token and j.attempt_count = 2
   from pg_temp.got a, pg_temp.got b, pg_temp.j(10) j where a.seq = 1 and b.seq = 2),
  'a new claim mints a new token and counts a second attempt'
);

-- Exhaustion: a job at the attempt limit is failed, never stranded.
update internal.stripe_fee_reconciliation_jobs set claim_expires_at = now() - interval '1 second' where id = pg_temp.mu(10);
select pg_temp.claim();
update internal.stripe_fee_reconciliation_jobs set claim_expires_at = now() - interval '1 second' where id = pg_temp.mu(10);
select pg_temp.fee_job(11);
update internal.stripe_fee_reconciliation_jobs
set attempt_count = 3, next_retry_at = now() - interval '1 hour' where id = pg_temp.mu(11);
select is(array(select pg_temp.claim()), '{}'::uuid[], 'jobs at the attempt limit are not returned');
select is(array[(select status from pg_temp.j(10)), (select status from pg_temp.j(11))], array['failed', 'failed'],
  'an expired lease and a pending job at the attempt limit are failed');
select is(array[(select last_error from pg_temp.j(10)), (select last_error from pg_temp.j(11))],
  array['STRIPE_FEE_ATTEMPTS_EXHAUSTED', 'STRIPE_FEE_ATTEMPTS_EXHAUSTED'], 'the failure records STRIPE_FEE_ATTEMPTS_EXHAUSTED');
select ok((select claim_token is null and claim_expires_at is null from pg_temp.j(10)),
  'an exhausted job loses its claim');
select is((select next_retry_at from pg_temp.j(11)), null, 'an exhausted job loses its retry time');

-- Batch size and order.
select pg_temp.fee_job(20), pg_temp.fee_job(21), pg_temp.fee_job(22);
update internal.stripe_fee_reconciliation_jobs set created_at = now() - interval '1 hour' where id = pg_temp.mu(20);
update internal.stripe_fee_reconciliation_jobs
set created_at = now() - interval '3 hours', next_retry_at = now() - interval '2 hours' where id = pg_temp.mu(21);
update internal.stripe_fee_reconciliation_jobs set created_at = now() - interval '2 hours' where id = pg_temp.mu(22);
select is(array[(select pg_temp.claim(1) limit 1), (select pg_temp.claim(1) limit 1), (select pg_temp.claim(1) limit 1)],
  array[pg_temp.mu(22), pg_temp.mu(20), pg_temp.mu(21)],
  'jobs without a retry time come first, then by retry time, ties by creation time');
update internal.stripe_fee_reconciliation_jobs set status = 'pending', claim_token = null, claim_expires_at = null
where id in (pg_temp.mu(20), pg_temp.mu(21), pg_temp.mu(22));
create table pg_temp.batch (n integer);
insert into pg_temp.batch select count(*) from pg_temp.claim(2);
select is(
  (select n from pg_temp.batch) || ':' || (select count(*) from internal.stripe_fee_reconciliation_jobs where status = 'pending'),
  '2:1', 'a claim returns at most p_limit jobs and leaves the rest pending');
-- Claims cleared the retry times, so the order is now 21, 22, 20 by creation.
update internal.stripe_fee_reconciliation_jobs set status = 'pending', claim_token = null, claim_expires_at = null
where id in (pg_temp.mu(20), pg_temp.mu(21), pg_temp.mu(22));
update internal.stripe_fee_reconciliation_jobs set attempt_count = 3 where id = pg_temp.mu(21);
delete from pg_temp.batch;
insert into pg_temp.batch select count(*) from pg_temp.claim(1);
select is(
  (select n from pg_temp.batch) || ':' || (select status from pg_temp.j(21)) || ':' || (select status from pg_temp.j(22)),
  '0:failed:pending', 'an exhausted job counts toward p_limit, so the next job waits for the next claim');

-- One session cannot show a second worker skipping a locked job, so this reads
-- the deployed definition instead.
select ok(
  pg_get_functiondef('public.fn_claim_stripe_fee_reconciliation_jobs_leased(integer,integer)'::regprocedure)
    ~* 'FOR\s+UPDATE\s+SKIP\s+LOCKED\s+LIMIT',
  'the claim locks its batch with FOR UPDATE SKIP LOCKED, so concurrent workers never share a job'
);

select * from finish();
rollback;
