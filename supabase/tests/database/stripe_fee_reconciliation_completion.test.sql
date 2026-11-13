-- Stripe fee reconciliation, part 2 (#276, T6): the leased transition
-- fn_transition_stripe_fee_reconciliation_job_leased (retry or fail only,
-- token and lease fencing) and the leased completion
-- fn_complete_stripe_fee_reconciliation_job_leased, which writes the actual
-- Stripe fee it is given onto the order. Grants, the ledger and the claim are
-- in stripe_fee_reconciliation_claim.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(48);
\ir ../fixtures/money.psql

-- Runs p_setup and p_query inside a subtransaction that always rolls back and
-- returns p_query's value (or p_after's, when given, read after p_query). An
-- error other than the rollback marker propagates, so throws_ok works on it.
create function pg_temp.peek(p_setup text, p_query text, p_after text default null)
returns text language plpgsql as $$
declare
  v text;
begin
  begin
    execute p_setup;
    execute p_query into v;
    if p_after is not null then
      execute p_after into v;
    end if;
    raise exception 'peek_rollback';
  exception when raise_exception then
    if sqlerrm <> 'peek_rollback' then
      raise;
    end if;
  end;
  return v;
end $$;

-- Runs p_query for real and returns its value.
create function pg_temp.exec(p_query text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_query into v;
  return v;
end $$;

-- A paid order of buyer 1 with payment intent pi_fee_<n>, and its job p_n.
create function pg_temp.fee_job(p_n integer) returns uuid language sql as $$
  insert into public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id)
  values (pg_temp.mu(p_n), pg_temp.mu(1), 1000, '{}'::jsonb, 'paid', 'pi_fee_' || p_n);
  insert into internal.stripe_fee_reconciliation_jobs (id, order_id, stripe_payment_intent_id)
  values (pg_temp.mu(p_n), pg_temp.mu(p_n), 'pi_fee_' || p_n)
  returning id
$$;

create function pg_temp.j(p_n integer) returns internal.stripe_fee_reconciliation_jobs language sql as $$
  select * from internal.stripe_fee_reconciliation_jobs where id = pg_temp.mu(p_n)
$$;

create function pg_temp.o(p_n integer) returns public.orders language sql as $$
  select * from public.orders where id = pg_temp.mu(p_n)
$$;

create function pg_temp.set_job(p_n integer, p_set text) returns text language sql as $$
  select format('update internal.stripe_fee_reconciliation_jobs set %s where id = %L', p_set, pg_temp.mu(p_n))
$$;

-- Claims every due job with the leased claim and returns how many it got.
create function pg_temp.claim() returns integer language sql as $$
  select count(*)::integer from public.fn_claim_stripe_fee_reconciliation_jobs_leased(25, 3)
$$;

-- A call of the leased transition on job p_n under its stored token; p_tail
-- holds the outcome, retry time and error.
create function pg_temp.tr(p_n integer, p_tail text) returns text language sql as $$
  select format('select public.fn_transition_stripe_fee_reconciliation_job_leased(id, claim_token, %s)::text
    from internal.stripe_fee_reconciliation_jobs where id = %L', p_tail, pg_temp.mu(p_n))
$$;

-- A call of the leased completion on job p_n under its stored token; p_tail
-- holds the fee in cents and the reconciliation time.
create function pg_temp.done(p_n integer, p_tail text) returns text language sql as $$
  select format('select public.fn_complete_stripe_fee_reconciliation_job_leased(id, claim_token, %s)::text
    from internal.stripe_fee_reconciliation_jobs where id = %L', p_tail, pg_temp.mu(p_n))
$$;

select pg_temp.money_user(1);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
-- The RPCs read the wall clock (clock_timestamp()), not the transaction start
-- (now()). After this pause a time of now() + 10 ms is already in the past.
select pg_sleep(0.05);

-- Transition, on job 30 under a live claim.
select pg_temp.fee_job(30), pg_temp.fee_job(31);
select pg_temp.claim();
select is(pg_temp.peek('select 1', format($$select public.fn_transition_stripe_fee_reconciliation_job_leased(
  %L, null, 'succeeded')::text$$, pg_temp.mu(30))), 'false',
  'a NULL token returns false before the arguments are validated');
select is(pg_temp.peek('select 1', format($$select public.fn_transition_stripe_fee_reconciliation_job_leased(
  null, claim_token, 'succeeded')::text from internal.stripe_fee_reconciliation_jobs where id = %L$$, pg_temp.mu(30))),
  'false', 'a NULL job id returns false before the arguments are validated');
select throws_ok(pg_temp.tr(30, $$null, null, 'x'$$), '22023', 'INVALID_TRANSITION', 'a NULL outcome is rejected');
select throws_ok(pg_temp.tr(30, $$'succeeded', null, 'x'$$), '22023', 'INVALID_TRANSITION',
  'a transition cannot mark a job succeeded; only the completion can');
select throws_ok(pg_temp.tr(30, $$'bogus', null, 'x'$$), '22023', 'INVALID_TRANSITION', 'an unknown outcome is rejected');
select throws_ok(pg_temp.tr(30, $$'retry', null, 'x'$$), '22023', 'INVALID_TRANSITION', 'a retry needs a retry time');
select throws_ok(pg_temp.tr(30, $$'failed', now(), 'x'$$), '22023', 'INVALID_TRANSITION',
  'a failure cannot carry a retry time');
select throws_ok(pg_temp.tr(30, $$'failed', null, null$$), '22023', 'INVALID_TRANSITION', 'a transition needs an error');
select throws_ok(pg_temp.tr(30, $$'failed', null, '  '$$), '22023', 'INVALID_TRANSITION', 'a blank error is rejected');
select throws_ok(pg_temp.tr(30, $$'failed', null, repeat('x', 4001)$$), '22023', 'INVALID_TRANSITION',
  'an error longer than 4000 characters is rejected');
select is(pg_temp.peek('select 1', pg_temp.tr(30, $$'failed', null, repeat('x', 4000)$$)), 'true',
  'an error of 4000 characters is accepted');
select is(pg_temp.peek('select 1', $$select public.fn_transition_stripe_fee_reconciliation_job_leased(
  gen_random_uuid(), gen_random_uuid(), 'failed', null, 'x')::text$$), 'false', 'an unknown job returns false');
select is(pg_temp.peek('select 1', format($$select public.fn_transition_stripe_fee_reconciliation_job_leased(
  %L, gen_random_uuid(), 'failed', null, 'x')::text$$, pg_temp.mu(30))), 'false', 'another token returns false');
select is(pg_temp.peek(pg_temp.set_job(30, $$status = 'pending'$$), pg_temp.tr(30, $$'failed', null, 'x'$$)), 'false',
  'a job that is not processing returns false');
select is(pg_temp.peek(pg_temp.set_job(30, 'claim_expires_at = null'), pg_temp.tr(30, $$'failed', null, 'x'$$)), 'false',
  'a claim with no lease expiry returns false');
select is(pg_temp.peek(pg_temp.set_job(30, $$claim_expires_at = now() + interval '10 ms'$$),
  pg_temp.tr(30, $$'failed', null, 'x'$$)), 'false', 'a lease expired on the wall clock returns false');
update internal.stripe_fee_reconciliation_jobs set updated_at = now() - interval '1 hour' where id = pg_temp.mu(30);
select is(pg_temp.exec(pg_temp.tr(30, $$'retry', now() + interval '1 hour', 'stripe timeout'$$)), 'true',
  'a retry under the live claim succeeds');
select ok((select status = 'pending' and next_retry_at = now() + interval '1 hour' and last_error = 'stripe timeout'
  from pg_temp.j(30)), 'a retry makes the job pending with the given retry time and error');
select ok((select claim_token is null and claim_expires_at is null from pg_temp.j(30)), 'a retry drops the claim');
select is((select attempt_count from pg_temp.j(30)), 1, 'a retry keeps the attempt count');
select ok((select updated_at > now() from pg_temp.j(30)), 'a transition stamps updated_at with the wall clock');
select is(pg_temp.exec(pg_temp.tr(31, $$'failed', null, 'card declined'$$)), 'true', 'a failure under the live claim succeeds');
select ok((select status = 'failed' and next_retry_at is null and last_error = 'card declined'
     and claim_token is null and claim_expires_at is null from pg_temp.j(31)),
  'a failure makes the job failed with the error and no claim');

-- Completion, on job 40 under a live claim (jobs 30 and 31 are not due).
select pg_temp.fee_job(40);
update internal.stripe_fee_reconciliation_jobs set last_error = 'stripe timeout' where id = pg_temp.mu(40);
select pg_temp.claim();
create table pg_temp.token as select claim_token from pg_temp.j(40);
select is(pg_temp.peek('select 1', format('select public.fn_complete_stripe_fee_reconciliation_job_leased(
  %L, null, null, null)::text', pg_temp.mu(40))), 'false', 'a NULL token returns false before the amounts are validated');
select is(pg_temp.peek('select 1', 'select public.fn_complete_stripe_fee_reconciliation_job_leased(
  null, claim_token, null, null)::text from pg_temp.token'), 'false',
  'a NULL job id returns false before the amounts are validated');
select throws_ok(pg_temp.done(40, 'null, now()'), '22023', 'INVALID_COMPLETION', 'a NULL fee is rejected');
select throws_ok(pg_temp.done(40, '-1, now()'), '22023', 'INVALID_COMPLETION', 'a negative fee is rejected');
select throws_ok(pg_temp.done(40, '100, null'), '22023', 'INVALID_COMPLETION', 'a NULL reconciliation time is rejected');
select is(pg_temp.peek('select 1', pg_temp.done(40, '0, now()'),
  format('select actual_stripe_fee_cents::text from public.orders where id = %L', pg_temp.mu(40))), '0',
  'a fee of 0 cents is written');
select is(pg_temp.peek('select 1', 'select public.fn_complete_stripe_fee_reconciliation_job_leased(
  gen_random_uuid(), claim_token, 100, now())::text from pg_temp.token'), 'false', 'an unknown job returns false');
select is(pg_temp.peek('select 1', format('select public.fn_complete_stripe_fee_reconciliation_job_leased(
  %L, gen_random_uuid(), 100, now())::text', pg_temp.mu(40))), 'false', 'another token returns false');
select is(pg_temp.peek(pg_temp.set_job(40, $$status = 'failed'$$), pg_temp.done(40, '100, now()')), 'false',
  'a job that is not processing returns false');
select throws_ok(format($$update public.orders set stripe_payment_intent_id = 'pi_other' where id = %L;
  %s$$, pg_temp.mu(40), pg_temp.done(40, '100, now()')), 'P0001', 'ORDER_PAYMENT_INTENT_MISMATCH',
  'an order whose payment intent differs from the job is refused');
select is(pg_temp.peek(pg_temp.set_job(40, 'claim_expires_at = null'), pg_temp.done(40, '100, now()')), 'false',
  'a claim with no lease expiry returns false');
select is(pg_temp.peek(pg_temp.set_job(40, $$claim_expires_at = now() + interval '10 ms'$$),
  pg_temp.done(40, '100, now()')), 'false', 'a lease expired on the wall clock returns false');

select is(pg_temp.exec(pg_temp.done(40, $$4321, '2026-11-01 12:00:00+00'$$)), 'true',
  'the completion under the live claim succeeds');
select is((select actual_stripe_fee_cents from pg_temp.o(40)), 4321::bigint,
  'the order stores exactly the fee in cents it was given');
select is((select stripe_fee_reconciled_at from pg_temp.o(40)), '2026-11-01 12:00:00+00'::timestamptz,
  'the order stores exactly the reconciliation time it was given');
select is((select status from pg_temp.j(40)), 'succeeded', 'the job is succeeded');
select ok((select last_error is null and next_retry_at is null from pg_temp.j(40)), 'the job clears its error and retry time');
select is((select claim_expires_at from pg_temp.j(40)), null, 'the job drops its lease');
select is((select j.claim_token from pg_temp.j(40) j), (select claim_token from pg_temp.token),
  'the job keeps its token as evidence of the successful claim');
select is(pg_temp.exec(pg_temp.done(40, $$9999, '2026-11-02 12:00:00+00'$$)), 'true',
  'a replay under the same token returns true');
select is((select actual_stripe_fee_cents || '@' || stripe_fee_reconciled_at from pg_temp.o(40)),
  4321 || '@' || '2026-11-01 12:00:00+00'::timestamptz, 'a replay writes nothing');
select is(pg_temp.peek('select 1', format('select public.fn_complete_stripe_fee_reconciliation_job_leased(
  %L, gen_random_uuid(), 100, now())::text', pg_temp.mu(40))), 'false', 'a replay under another token returns false');

-- An order that already has a fee keeps it.
select pg_temp.fee_job(41);
update public.orders set actual_stripe_fee_cents = 999, stripe_fee_reconciled_at = '2026-10-01 00:00:00+00'
where id = pg_temp.mu(41);
select pg_temp.claim();
select is(pg_temp.exec(pg_temp.done(41, $$5000, '2026-11-01 12:00:00+00'$$)), 'true',
  'completing a job whose order already has a fee returns true');
select is((select actual_stripe_fee_cents || '@' || stripe_fee_reconciled_at from pg_temp.o(41)),
  999 || '@' || '2026-10-01 00:00:00+00'::timestamptz, 'an existing fee and its time are never overwritten');
select is((select status from pg_temp.j(41)), 'succeeded', 'the job of an order that already had a fee is succeeded');

select * from finish();
rollback;
