-- Payout claims and the create fence (#275, T4): the create claim
-- fn_claim_awaiting_balance_payout_run, the reconciliation claim
-- fn_claim_payout_create_reconciliation, fn_release_payout_claim,
-- fn_verify_payout_claim, fn_defer_awaiting_balance_run, the NULL guards of
-- fn_begin_payout_create_fence, and their grants. The other fence functions,
-- stage transitions and run projections are in T5.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(95);
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

create function pg_temp.claim_after(p_setup text, p_lease integer default 60)
returns text language sql as $$
  select pg_temp.peek(p_setup,
    format('select run_id::text from public.fn_claim_awaiting_balance_payout_run(%s)', coalesce(p_lease::text, 'null')))
$$;

create function pg_temp.reconcile_after(p_setup text, p_grace integer default 600)
returns text language sql as $$
  select pg_temp.peek(p_setup,
    format('select run_id::text from public.fn_claim_payout_create_reconciliation(%s)', coalesce(p_grace::text, 'null')))
$$;

-- A run of seller 1 in p_stage over p_shipments, each shipment with a Stripe
-- transfer (the create claim needs them).
create function pg_temp.run(p_run integer, p_shipments integer[], p_stage text default 'awaiting_connected_balance')
returns uuid language plpgsql as $$
begin
  perform pg_temp.money_shipment(n, n, 1, 2) from unnest(p_shipments) as n;
  update public.shipments set stripe_transfer_id = 'tr_t4_' || id
  where id in (select pg_temp.mu(n) from unnest(p_shipments) as n);
  return pg_temp.money_payout_run(p_run, 1, 3, p_shipments, 'pending_reconciliation', p_stage);
end $$;

create function pg_temp.r(p_run integer) returns public.connect_payout_runs language sql as $$
  select * from public.connect_payout_runs where id = pg_temp.mu(p_run)
$$;

-- Calls the given function with run p_run's stored token and version.
create function pg_temp.with_claim(p_fn text, p_run integer, p_tail text default '')
returns text language sql as $$
  select format('select public.%s(id, payout_claim_token, release_stage_version%s)::text
    from public.connect_payout_runs where id = %L', p_fn, p_tail, pg_temp.mu(p_run))
$$;

create table pg_temp.got (
  seq serial, run_id uuid, actor_id uuid, seller_id uuid, amount_cents integer,
  idempotency_key text, shipment_ids uuid[], claim_token text, stage_version integer,
  claim_expires_at timestamptz
);
create function pg_temp.claim() returns uuid language sql as $$
  insert into pg_temp.got (run_id, actor_id, seller_id, amount_cents, idempotency_key,
    shipment_ids, claim_token, stage_version, claim_expires_at)
  select * from public.fn_claim_awaiting_balance_payout_run(60)
  returning run_id
$$;

select pg_temp.money_user(1);
select pg_temp.money_user(2);
select pg_temp.money_user(3, 'admin');
update public.profiles_private set stripe_account_id = 'acct_t4_seller' where id = pg_temp.mu(1);

-- Grants: service_role only, behind SECURITY DEFINER with a fixed search_path.
select is(
  (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
   from pg_proc p, aclexplode(p.proacl) a
   where p.oid = f::regprocedure and a.privilege_type = 'EXECUTE'),
  array['postgres', 'service_role'],
  f || ' is executable by service_role only'
) from unnest(array[
  'public.fn_claim_awaiting_balance_payout_run(integer)',
  'public.fn_claim_payout_create_reconciliation(integer)',
  'public.fn_release_payout_claim(uuid,text)',
  'public.fn_verify_payout_claim(uuid,text,integer)',
  'public.fn_defer_awaiting_balance_run(uuid,text,integer,integer)',
  'public.fn_begin_payout_create_fence(uuid,text,integer)'
]) as f;
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.proconfig = array['search_path=public']
     and p.proname in ('fn_claim_awaiting_balance_payout_run', 'fn_claim_payout_create_reconciliation',
       'fn_release_payout_claim', 'fn_verify_payout_claim', 'fn_defer_awaiting_balance_run',
       'fn_begin_payout_create_fence')),
  6, 'the six claim and fence functions are SECURITY DEFINER with search_path public'
);
-- One session cannot show a second worker skipping a locked run, so this reads
-- the deployed definitions instead.
select is(
  (select count(*)::integer from pg_proc p
   where p.oid in ('public.fn_claim_awaiting_balance_payout_run(integer)'::regprocedure,
     'public.fn_claim_payout_create_reconciliation(integer)'::regprocedure)
     and pg_get_functiondef(p.oid) ~* 'FOR\s+UPDATE\s+OF\s+cpr\s+SKIP\s+LOCKED\s+LIMIT\s+1'),
  2, 'both claims lock their candidate with FOR UPDATE SKIP LOCKED, so concurrent workers never share a run'
);
select is(
  (select count(*)::integer from pg_class c, aclexplode(c.relacl) a
   where c.oid = t::regclass and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))),
  0, t || ' grants nothing to PUBLIC, anon or authenticated'
) from unnest(array['public.connect_payout_runs', 'public.connect_payout_run_shipments']) as t;

set local role anon;
select throws_ok('select * from public.fn_claim_awaiting_balance_payout_run(60)', '42501', null,
  'anon cannot claim a payout run');
reset role;
set local role authenticated;
select throws_ok($$select public.fn_release_payout_claim(gen_random_uuid(), 'x')$$, '42501', null,
  'authenticated cannot release a payout claim');
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(public.fn_release_payout_claim(gen_random_uuid(), 'x'), false,
  'service_role can call the claim functions');
reset role;

-- Create claim: lease bounds.
select throws_ok('select * from public.fn_claim_awaiting_balance_payout_run(0)', 'P0001', 'INVALID_LEASE_SECONDS',
  'a lease under 1 second is rejected');
select throws_ok('select * from public.fn_claim_awaiting_balance_payout_run(901)', 'P0001', 'INVALID_LEASE_SECONDS',
  'a lease over 900 seconds is rejected');
select throws_ok('select * from public.fn_claim_awaiting_balance_payout_run(null)', 'P0001', 'INVALID_LEASE_SECONDS',
  'a NULL lease is rejected');

-- Create claim gates, each on run 10 alone.
select pg_temp.run(10, array[102, 101]);
select is(pg_temp.claim_after('select 1', 1), pg_temp.mu(10)::text, 'a 1-second lease is accepted');
select is(pg_temp.claim_after('select 1', 900), pg_temp.mu(10)::text, 'a 900-second lease is accepted');
select is(pg_temp.claim_after(format('update public.connect_payout_runs set status = %L where id = %L',
  'reconciliation_needed', pg_temp.mu(10))), null, 'a run not pending_reconciliation is not claimed');
select is(pg_temp.claim_after(format('update public.connect_payout_runs set stripe_payout_id = %L where id = %L',
  'po_t4', pg_temp.mu(10))), null, 'a run with a payout id is not claimed');
select is(pg_temp.claim_after(format('update public.connect_payout_runs set release_stage = %L where id = %L',
  'ready', pg_temp.mu(10))), null, 'a run in stage ready is not claimed');
select is(pg_temp.claim_after(format('update public.connect_payout_runs set release_stage = %L where id = %L',
  'payout_create_in_progress', pg_temp.mu(10))), null, 'a run fenced in payout_create_in_progress is not claimed');
select is(pg_temp.peek(format('update public.connect_payout_runs set release_stage = null where id = %L', pg_temp.mu(10)),
  'select run_id::text from public.fn_claim_awaiting_balance_payout_run(60)',
  format('select id || %L || release_stage from public.connect_payout_runs where id = %L', ':', pg_temp.mu(10))),
  pg_temp.mu(10)::text || ':awaiting_connected_balance',
  'a run with no stage is claimed and moved to awaiting_connected_balance');
select is(pg_temp.claim_after($$insert into internal.connect_account_actionability (stripe_account_id, is_actionable, stripe_created)
  values ('acct_t4_seller', false, now())$$), null, 'a run of a non-actionable account is not claimed');
select is(pg_temp.claim_after($$insert into internal.connect_account_actionability (stripe_account_id, is_actionable, stripe_created)
  values ('acct_t4_seller', true, now())$$), pg_temp.mu(10)::text, 'a run of an actionable account is claimed');
select is(pg_temp.claim_after(format('update public.connect_payout_runs set next_attempt_at = now() + interval %L where id = %L',
  '1 second', pg_temp.mu(10))), null, 'a run whose next attempt is not due is not claimed');
select is(pg_temp.claim_after(format('update public.connect_payout_runs set next_attempt_at = now() where id = %L',
  pg_temp.mu(10))), pg_temp.mu(10)::text, 'a run whose next attempt is due now is claimed');
select is(pg_temp.claim_after(format('update public.connect_payout_runs set payout_claim_token = %L,
  payout_claim_expires_at = now() + interval %L where id = %L', 'other', '1 second', pg_temp.mu(10))),
  null, 'a run under an active lease is not claimed');
select is(pg_temp.claim_after(format('update public.connect_payout_runs set payout_claim_token = %L,
  payout_claim_expires_at = now() where id = %L', 'other', pg_temp.mu(10))),
  pg_temp.mu(10)::text, 'a run whose lease expires now is claimed');
select is(pg_temp.claim_after(format('delete from public.connect_payout_run_shipments where run_id = %L', pg_temp.mu(10))),
  null, 'a run with no mapped shipment is not claimed');
select is(pg_temp.claim_after(format('update public.connect_payout_run_shipments set status = %L where shipment_id = %L',
  'failed', pg_temp.mu(101))), null, 'a run with a mapped shipment not pending is not claimed');
select is(pg_temp.claim_after(format('update public.shipments set stripe_transfer_id = null where id = %L', pg_temp.mu(102))),
  null, 'a run with a shipment without a transfer is not claimed');

-- A claim returns the run and leases it under a new token and stage version.
select is(pg_temp.claim(), pg_temp.mu(10), 'the eligible run is claimed');
select is(
  (select array[actor_id, seller_id]::text || amount_cents || idempotency_key || shipment_ids::text from pg_temp.got where seq = 1),
  array[pg_temp.mu(3), pg_temp.mu(1)]::text || 180000 || 'test-run-10' || array[pg_temp.mu(101), pg_temp.mu(102)]::text,
  'the claim returns the actor, seller, amount, idempotency key and sorted shipment ids'
);
select ok(
  (select g.claim_token is not null and g.claim_token = r.payout_claim_token
     and g.claim_expires_at = now() + interval '60 seconds' and r.payout_claim_expires_at = g.claim_expires_at
   from pg_temp.got g, pg_temp.r(10) r where g.seq = 1),
  'the claim stores and returns its token and a lease of now() plus the lease seconds'
);
select is((select array[g.stage_version, r.release_stage_version] from pg_temp.got g, pg_temp.r(10) r where g.seq = 1),
  array[2, 2], 'the claim bumps the stage version and returns it');
select is(pg_temp.claim_after('select 1'), null, 'an actively leased run is not claimed again');
update public.connect_payout_runs set payout_claim_expires_at = now() - interval '1 second' where id = pg_temp.mu(10);
select is(pg_temp.claim(), pg_temp.mu(10), 'a run whose lease expired is claimed again');
select ok(
  (select b.claim_token <> a.claim_token and b.stage_version = 3 and r.payout_claim_token = b.claim_token
   from pg_temp.got a, pg_temp.got b, pg_temp.r(10) r where a.seq = 1 and b.seq = 2),
  'a new claim mints a new token and stage version'
);

-- Fair order: by readiness (next_attempt_at, else created_at), then created_at.
select pg_temp.run(11, array[111]), pg_temp.run(12, array[112]), pg_temp.run(13, array[113]), pg_temp.run(14, array[114]);
update public.connect_payout_runs set created_at = now() - interval '30 minutes' where id = pg_temp.mu(11);
update public.connect_payout_runs set created_at = now() - interval '2 hours', next_attempt_at = now() - interval '1 hour'
where id = pg_temp.mu(12);
update public.connect_payout_runs set created_at = now() - interval '3 hours', next_attempt_at = now() - interval '5 minutes'
where id = pg_temp.mu(13);
update public.connect_payout_runs set created_at = now() - interval '4 hours', next_attempt_at = now() - interval '30 minutes'
where id = pg_temp.mu(14);
select is(array[pg_temp.claim(), pg_temp.claim(), pg_temp.claim(), pg_temp.claim()],
  array[pg_temp.mu(12), pg_temp.mu(14), pg_temp.mu(11), pg_temp.mu(13)],
  'due runs are claimed by readiness time, ties by creation time');

-- Defer (run 12): bounded backoff, only under the current claim.
select throws_ok(pg_temp.with_claim('fn_defer_awaiting_balance_run', 12, ', 59'), 'P0001', 'INVALID_BACKOFF_SECONDS',
  'a backoff under 60 seconds is rejected');
select throws_ok(pg_temp.with_claim('fn_defer_awaiting_balance_run', 12, ', 3601'), 'P0001', 'INVALID_BACKOFF_SECONDS',
  'a backoff over 3600 seconds is rejected');
select throws_ok(pg_temp.with_claim('fn_defer_awaiting_balance_run', 12, ', null'), 'P0001', 'INVALID_BACKOFF_SECONDS',
  'a NULL backoff is rejected');
select is(pg_temp.peek('select 1', pg_temp.with_claim('fn_defer_awaiting_balance_run', 12, ', 60')), 'true',
  'a 60-second backoff is accepted');
select is(pg_temp.peek('select 1', pg_temp.with_claim('fn_defer_awaiting_balance_run', 12, ', 3600')), 'true',
  'a 3600-second backoff is accepted');
select is(pg_temp.peek('select 1', format('select public.fn_defer_awaiting_balance_run(id, %L, release_stage_version, 60)::text
  from public.connect_payout_runs where id = %L', 'wrong', pg_temp.mu(12))), 'false', 'defer with another token does nothing');
select is(pg_temp.peek('select 1', format('select public.fn_defer_awaiting_balance_run(id, null, release_stage_version, 60)::text
  from public.connect_payout_runs where id = %L', pg_temp.mu(12))), 'false', 'defer with a NULL token does nothing');
select is(pg_temp.peek('select 1', format('select public.fn_defer_awaiting_balance_run(id, payout_claim_token, release_stage_version - 1, 60)::text
  from public.connect_payout_runs where id = %L', pg_temp.mu(12))), 'false', 'defer with a stale stage version does nothing');
select is(pg_temp.peek(format('update public.connect_payout_runs set payout_claim_expires_at = now() where id = %L', pg_temp.mu(12)),
  pg_temp.with_claim('fn_defer_awaiting_balance_run', 12, ', 60')), 'false', 'defer under an expired lease does nothing');
select is(pg_temp.peek(format('update public.connect_payout_runs set release_stage = %L where id = %L', 'payout_create_in_progress', pg_temp.mu(12)),
  pg_temp.with_claim('fn_defer_awaiting_balance_run', 12, ', 60')), 'false', 'defer outside awaiting_connected_balance does nothing');
select is(pg_temp.peek(format('update public.connect_payout_runs set stripe_payout_id = %L where id = %L', 'po_t4', pg_temp.mu(12)),
  pg_temp.with_claim('fn_defer_awaiting_balance_run', 12, ', 60')), 'false', 'defer of a run with a payout id does nothing');
select is(pg_temp.exec(pg_temp.with_claim('fn_defer_awaiting_balance_run', 12, ', 120')), 'true',
  'defer under the current claim succeeds');
select ok(
  (select next_attempt_at = now() + interval '120 seconds' and attempt_count = 1 and last_error = 'insufficient_balance'
     and payout_claim_token is null and payout_claim_expires_at is null from pg_temp.r(12)),
  'defer sets the next attempt, counts the attempt, records the error and drops the claim'
);
select is(pg_temp.claim_after('select 1'), null, 'a deferred run is not claimed again in the same tick');
select is(pg_temp.claim_after(format('update public.connect_payout_runs set next_attempt_at = now() where id = %L', pg_temp.mu(12))),
  pg_temp.mu(12)::text, 'a deferred run is claimed once its next attempt is due');

-- Release (run 10): only the matching token clears the claim.
select is(public.fn_release_payout_claim(pg_temp.mu(10), 'wrong'), false, 'release with another token returns false');
select is(public.fn_release_payout_claim(pg_temp.mu(10), null), false, 'release with a NULL token returns false');
select ok((select payout_claim_token = (select claim_token from pg_temp.got where seq = 2)
  and payout_claim_expires_at is not null from pg_temp.r(10)), 'a rejected release keeps the claim');
select is(public.fn_release_payout_claim(pg_temp.mu(10), (select claim_token from pg_temp.got where seq = 2)), true,
  'release with the matching token returns true');
select ok((select payout_claim_token is null and payout_claim_expires_at is null and release_stage_version = 3
  from pg_temp.r(10)), 'release clears the token and lease and keeps the stage version');

-- Verify (run 11): token, then lease, then stage version; it writes nothing.
create table pg_temp.before as select r::text as v from pg_temp.r(11) r;
select is(pg_temp.exec(pg_temp.with_claim('fn_verify_payout_claim', 11)), 'true', 'verify accepts the current claim');
select is((select r::text from pg_temp.r(11) r), (select v from pg_temp.before), 'verify writes nothing');
select throws_ok(format('select public.fn_verify_payout_claim(%L, %L, 1)', gen_random_uuid(), 'x'), 'P0001', 'PAYOUT_RUN_NOT_FOUND',
  'verify of an unknown run raises PAYOUT_RUN_NOT_FOUND');
select throws_ok(format('select public.fn_verify_payout_claim(id, null, release_stage_version) from public.connect_payout_runs where id = %L',
  pg_temp.mu(11)), 'P0001', 'STALE_CLAIM', 'verify with a NULL token raises STALE_CLAIM');
select throws_ok(format('select public.fn_verify_payout_claim(id, %L, release_stage_version) from public.connect_payout_runs where id = %L',
  'wrong', pg_temp.mu(11)), 'P0001', 'STALE_CLAIM', 'verify with another token raises STALE_CLAIM');
select throws_ok(format('select public.fn_verify_payout_claim(id, %L, release_stage_version) from public.connect_payout_runs where id = %L',
  'any', pg_temp.mu(10)), 'P0001', 'STALE_CLAIM', 'verify of an unclaimed run raises STALE_CLAIM');
select throws_ok(format('select pg_temp.peek(%L, %L)',
  format('update public.connect_payout_runs set payout_claim_expires_at = now() where id = %L', pg_temp.mu(11)),
  pg_temp.with_claim('fn_verify_payout_claim', 11)), 'P0001', 'CLAIM_LEASE_EXPIRED', 'verify under an expired lease raises CLAIM_LEASE_EXPIRED');
select throws_ok(format('select public.fn_verify_payout_claim(id, payout_claim_token, null) from public.connect_payout_runs where id = %L',
  pg_temp.mu(11)), 'P0001', 'STAGE_VERSION_CONFLICT', 'verify with a NULL stage version raises STAGE_VERSION_CONFLICT');
select throws_ok(format('select public.fn_verify_payout_claim(id, payout_claim_token, release_stage_version - 1) from public.connect_payout_runs where id = %L',
  pg_temp.mu(11)), 'P0001', 'STAGE_VERSION_CONFLICT', 'verify with a stale stage version raises STAGE_VERSION_CONFLICT');
select throws_ok(format('select pg_temp.peek(%L, %L)',
  format('update public.connect_payout_runs set payout_claim_expires_at = now() where id = %L', pg_temp.mu(11)),
  format('select public.fn_verify_payout_claim(id, %L, release_stage_version)::text from public.connect_payout_runs where id = %L', 'wrong', pg_temp.mu(11))),
  'P0001', 'STALE_CLAIM', 'verify checks the token before the lease');
select throws_ok(format('select pg_temp.peek(%L, %L)',
  format('update public.connect_payout_runs set payout_claim_expires_at = now() where id = %L', pg_temp.mu(11)),
  format('select public.fn_verify_payout_claim(id, payout_claim_token, null)::text from public.connect_payout_runs where id = %L', pg_temp.mu(11))),
  'P0001', 'CLAIM_LEASE_EXPIRED', 'verify checks the lease before the stage version');

-- Begin create fence (run 13): NULL inputs are rejected before any write.
create table pg_temp.before13 as select r::text as v from pg_temp.r(13) r;
select throws_ok(format('select public.fn_begin_payout_create_fence(id, null, release_stage_version) from public.connect_payout_runs where id = %L',
  pg_temp.mu(13)), 'P0001', 'STALE_CLAIM', 'the fence with a NULL token raises STALE_CLAIM');
select throws_ok(format('select public.fn_begin_payout_create_fence(id, payout_claim_token, null) from public.connect_payout_runs where id = %L',
  pg_temp.mu(13)), 'P0001', 'STAGE_VERSION_CONFLICT', 'the fence with a NULL stage version raises STAGE_VERSION_CONFLICT');
select is((select r::text from pg_temp.r(13) r), (select v from pg_temp.before13), 'a rejected fence leaves the run unchanged');
select throws_ok(format('select public.fn_begin_payout_create_fence(%L, %L, 1)', gen_random_uuid(), 'x'), 'P0001', 'PAYOUT_RUN_NOT_FOUND',
  'the fence on an unknown run raises PAYOUT_RUN_NOT_FOUND');
select throws_ok(format('select public.fn_begin_payout_create_fence(id, %L, release_stage_version) from public.connect_payout_runs where id = %L',
  'wrong', pg_temp.mu(13)), 'P0001', 'STALE_CLAIM', 'the fence with another token raises STALE_CLAIM');
select throws_ok(format('select pg_temp.peek(%L, %L)',
  format('update public.connect_payout_runs set payout_claim_expires_at = now() where id = %L', pg_temp.mu(13)),
  pg_temp.with_claim('fn_begin_payout_create_fence', 13)), 'P0001', 'CLAIM_LEASE_EXPIRED', 'the fence under an expired lease raises CLAIM_LEASE_EXPIRED');
select throws_ok(format('select public.fn_begin_payout_create_fence(id, payout_claim_token, release_stage_version - 1) from public.connect_payout_runs where id = %L',
  pg_temp.mu(13)), 'P0001', 'STAGE_VERSION_CONFLICT', 'the fence with a stale stage version raises STAGE_VERSION_CONFLICT');
select throws_ok(format('select pg_temp.peek(%L, %L)',
  format('update public.connect_payout_runs set release_stage = %L where id = %L', 'ready', pg_temp.mu(13)),
  pg_temp.with_claim('fn_begin_payout_create_fence', 13)), 'P0001', 'PAYOUT_CREATE_FENCE_CONFLICT', 'the fence outside awaiting_connected_balance raises PAYOUT_CREATE_FENCE_CONFLICT');
select is(pg_temp.exec(pg_temp.with_claim('fn_begin_payout_create_fence', 13)), '3', 'the fence returns the next stage version');
select ok((select release_stage = 'payout_create_in_progress' and release_stage_version = 3 and payout_create_attempted_at = now()
  from pg_temp.r(13)), 'the fence moves the run to payout_create_in_progress and records the attempt');

-- Reconciliation claim: stale create fences only, oldest attempt first.
select pg_temp.run(20, array[120], 'payout_create_in_progress'), pg_temp.run(21, array[121], 'payout_create_in_progress'),
  pg_temp.run(22, array[122], 'payout_create_in_progress');
update public.connect_payout_runs set payout_create_attempted_at = now() - interval '20 minutes' where id = pg_temp.mu(20);
update public.connect_payout_runs set payout_create_attempted_at = now() - interval '30 minutes' where id = pg_temp.mu(21);
update public.connect_payout_runs set payout_create_attempted_at = now() - interval '5 minutes' where id = pg_temp.mu(22);
select throws_ok('select * from public.fn_claim_payout_create_reconciliation(29)', 'P0001', 'INVALID_GRACE_SECONDS',
  'a grace under 30 seconds is rejected');
select throws_ok('select * from public.fn_claim_payout_create_reconciliation(3601)', 'P0001', 'INVALID_GRACE_SECONDS',
  'a grace over 3600 seconds is rejected');
select throws_ok('select * from public.fn_claim_payout_create_reconciliation(null)', 'P0001', 'INVALID_GRACE_SECONDS',
  'a NULL grace is rejected');
select is(pg_temp.reconcile_after('select 1', 30), pg_temp.mu(21)::text, 'a 30-second grace is accepted');
select is(pg_temp.reconcile_after(format('update public.connect_payout_runs set payout_create_attempted_at = now() - interval %L where id = %L',
  '3600 seconds', pg_temp.mu(22)), 3600), pg_temp.mu(22)::text, 'a 3600-second grace is accepted');
select is(pg_temp.reconcile_after(format('update public.connect_payout_runs set release_stage = %L where id = %L',
  'awaiting_connected_balance', pg_temp.mu(21))), pg_temp.mu(20)::text, 'a run outside payout_create_in_progress is not reconciled');
select is(pg_temp.reconcile_after(format('update public.connect_payout_runs set payout_claim_expires_at = now() + interval %L where id = %L',
  '1 second', pg_temp.mu(21))), pg_temp.mu(20)::text, 'a run under an active lease is not reconciled');
select is(pg_temp.reconcile_after(format('update public.connect_payout_runs set payout_claim_expires_at = now() where id = %L',
  pg_temp.mu(21))), pg_temp.mu(21)::text, 'a run whose lease expires now is reconciled');
create table pg_temp.rec as select * from public.fn_claim_payout_create_reconciliation(600);
select is((select run_id from pg_temp.rec), pg_temp.mu(21), 'the oldest stale fence is claimed first');
select ok(
  (select c.claim_token is not null and c.claim_token = r.payout_claim_token and c.stage_version = 2
     and r.release_stage_version = 2 and c.claim_expires_at = now() + interval '300 seconds'
     and r.payout_claim_expires_at = c.claim_expires_at
   from pg_temp.rec c, pg_temp.r(21) r),
  'the reconciliation claim stores a new token, bumps the stage version and leases for 300 seconds'
);
select is((select c.stripe_account_id || ':' || c.amount_cents || ':' || (c.payout_create_attempted_at = now() - interval '30 minutes')
  from pg_temp.rec c), 'acct_t4_seller:90000:true', 'the reconciliation claim returns the account, amount and attempt time');
select is((select run_id from public.fn_claim_payout_create_reconciliation(600)), pg_temp.mu(20), 'the next stale fence is claimed next');
select is(pg_temp.reconcile_after('select 1'), null, 'a fence attempted within the grace is not reconciled');
select is(pg_temp.reconcile_after(format('update public.connect_payout_runs set payout_create_attempted_at = now() - interval %L where id = %L',
  '600 seconds', pg_temp.mu(22))), pg_temp.mu(22)::text, 'a fence attempted exactly the grace ago is reconciled');

select * from finish();
rollback;
