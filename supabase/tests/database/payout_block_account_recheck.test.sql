-- The worker's account park re-checks the account under its lock (#352 T2, S5, S6).
-- resume-pending-payouts reads the seller's actionability without a lock and,
-- when it is not actionable, calls fn_block_payout_run_for_account_actionability
-- under its claim. The RPC locks the account's connect_account_actionability
-- row before the run and parks only while the account is still refresh-pending
-- or not actionable. When a refresh committed "actionable" between the worker's
-- read and the park, the run is requeued to awaiting_connected_balance and the
-- RPC returns FALSE, so the worker claims it again instead of leaving it parked
-- until the next account event. The shipment mappings never change.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(33);
\ir ../fixtures/money.psql

-- A shipment of p_seller (listing p_n, order p_n + 100) with its Stripe
-- Transfer already created, as release-connect-payout leaves it.
create function pg_temp.shipment(p_n integer, p_seller integer) returns uuid language plpgsql as $$
begin
  perform pg_temp.money_shipment(p_n + 100, p_n, p_seller, 2);
  update public.shipments set stripe_transfer_id = 'tr_blk_' || p_n where id = pg_temp.mu(p_n);
  return pg_temp.mu(p_n);
end $$;

-- Run p_run of p_seller over shipment p_run + 100 in p_stage at version 1,
-- held by the worker under claim token tok_<p_run> with a live lease.
create function pg_temp.claimed(p_run integer, p_seller integer, p_stage text) returns uuid language plpgsql as $$
begin
  perform pg_temp.shipment(p_run + 100, p_seller);
  perform pg_temp.money_payout_run(p_run, p_seller, 3, array[p_run + 100], 'pending_reconciliation', p_stage);
  update public.connect_payout_runs
  set payout_claim_token = 'tok_' || p_run, payout_claim_expires_at = now() + interval '5 minutes'
  where id = pg_temp.mu(p_run);
  return pg_temp.mu(p_run);
end $$;

-- stage:version:status:reason:last error:next attempt:payout id:claim
create function pg_temp.rs(p_run integer) returns text language sql as $$
  select concat_ws(':', coalesce(release_stage, '-'), release_stage_version, status,
    coalesce(action_required_reason, '-'), coalesce(last_error, '-'),
    case when next_attempt_at is null then '-' else 'next' end,
    coalesce(stripe_payout_id, '-'),
    case when payout_claim_token is null and payout_claim_expires_at is null then 'unclaimed' else 'claimed' end)
  from public.connect_payout_runs where id = pg_temp.mu(p_run)
$$;

-- The statuses of the mappings of p_run, comma separated.
create function pg_temp.maps(p_run integer) returns text language sql as $$
  select string_agg(status, ',' order by shipment_id)
  from public.connect_payout_run_shipments where run_id = pg_temp.mu(p_run)
$$;

-- result|state of p_run after calling the block RPC; an error comes back as
-- its message, so a broken rule fails one assertion, not the file.
create function pg_temp.blk(p_run integer, p_token text, p_version integer, p_reason text) returns text language plpgsql as $$
declare r boolean;
begin
  r := public.fn_block_payout_run_for_account_actionability(pg_temp.mu(p_run), p_token, p_version, p_reason);
  return r::text || '|' || coalesce(pg_temp.rs(p_run), '');
exception when others then
  return sqlerrm || '|' || coalesce(pg_temp.rs(p_run), '');
end $$;

-- Every run of this file the worker claims now, by run number.
create function pg_temp.claim_all() returns integer[] language plpgsql as $$
declare
  v_run uuid;
  v_claimed uuid[] := '{}';
begin
  loop
    select run_id into v_run from public.fn_claim_awaiting_balance_payout_run(300);
    exit when v_run is null;
    v_claimed := v_claimed || v_run;
  end loop;
  return array(select n from generate_series(1, 99) as n where pg_temp.mu(n) = any(v_claimed) order by n);
end $$;

-- The roles of anon, authenticated and service_role that may execute p_fn.
create function pg_temp.exec_roles(p_fn text) returns text language sql as $$
  select coalesce(string_agg(r, ',' order by r), '-')
  from unnest(array['anon', 'authenticated', 'service_role']) as r
  where has_function_privilege(r, p_fn, 'execute')
$$;

-- 1 seller A, refresh pending (acct_blkA); 2 buyer; 3 admin; 4 seller B,
-- payouts disabled (acct_blkB); 5 seller C, actionable (acct_blkC);
-- 6 seller D, no actionability row (acct_blkD); 7 seller E, no Stripe account.
select pg_temp.money_user(1);
select pg_temp.money_user(2);
select pg_temp.money_user(3, 'admin');
select pg_temp.money_user(4);
select pg_temp.money_user(5);
select pg_temp.money_user(6);
select pg_temp.money_user(7);
update public.profiles_private set stripe_account_id = 'acct_blk' || x
from (values (1, 'A'), (4, 'B'), (5, 'C'), (6, 'D')) as v(n, x)
where id = pg_temp.mu(v.n);

select public.fn_record_connect_account_event('evt_blk' || x, 'acct_blk' || x, 'account.updated', now(), null, null, null)
from unnest(array['A', 'B', 'C']) as x;
create table pg_temp.gen (acct text primary key, g bigint);
insert into pg_temp.gen
select 'acct_blk' || x, public.fn_acquire_connect_account_refresh('acct_blk' || x, 'evt_blk' || x)
from unnest(array['A', 'B', 'C']) as x;
select public.fn_commit_connect_account_refresh('acct_blkB', (select g from pg_temp.gen where acct = 'acct_blkB'),
  'evt_blkB', false, 'payouts_disabled', false, null, null, null, null, null);
-- C is actionable: this is the refresh that commits between the worker's
-- unlocked read and its call to the block RPC.
select public.fn_commit_connect_account_refresh('acct_blkC', (select g from pg_temp.gen where acct = 'acct_blkC'),
  'evt_blkC', true, null, true, 'ba_blkdefault', 'verified', 'mxn', true, 1);

-- Claimed runs, version 1, token tok_<run>.
select pg_temp.claimed(n, s, st)
from (values
  (10, 1, 'awaiting_connected_balance'),
  (11, 1, 'payout_create_in_progress'),
  (20, 4, 'awaiting_connected_balance'),
  (30, 5, 'awaiting_connected_balance'),
  (31, 5, 'payout_create_in_progress'),
  (40, 6, 'awaiting_connected_balance'),
  (50, 7, 'awaiting_connected_balance'),
  (60, 1, 'awaiting_connected_balance'),
  (61, 5, 'awaiting_connected_balance'),
  (62, 5, 'awaiting_connected_balance'),
  (63, 5, 'awaiting_connected_balance'),
  (64, 5, 'transfer_created')
) as r(n, s, st);
update public.connect_payout_runs set last_error = 'stale error', next_attempt_at = now() + interval '1 hour'
where id = pg_temp.mu(30);
update public.connect_payout_runs set payout_claim_expires_at = now() - interval '1 second'
where id in (pg_temp.mu(62));
update public.connect_payout_runs set stripe_payout_id = 'po_blk_63' where id = pg_temp.mu(63);

-- 1. Grants: service_role only -------------------------------------------------
select is(pg_temp.exec_roles('public.fn_block_payout_run_for_account_actionability(uuid, text, integer, text)'),
  'service_role', 'fn_block_payout_run_for_account_actionability is executable by service_role only');
set local role anon;
select throws_ok($$select public.fn_block_payout_run_for_account_actionability('f0000000-0000-4000-8000-000000000010', 'tok_10', 1, null)$$,
  '42501', null, 'anon cannot call fn_block_payout_run_for_account_actionability');
reset role;
set local role authenticated;
select throws_ok($$select public.fn_block_payout_run_for_account_actionability('f0000000-0000-4000-8000-000000000010', 'tok_10', 1, null)$$,
  '42501', null, 'authenticated cannot call fn_block_payout_run_for_account_actionability');
reset role;

-- The Edge Function calls the RPC with the service role.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

-- 2. Guards refuse before the account is read ------------------------------------
select is(pg_temp.blk(10, 'tok_other', 1, 'account_refresh_pending'),
  'false|awaiting_connected_balance:1:pending_reconciliation:-:-:-:-:claimed',
  'pending account: another claim token is refused');
select is(pg_temp.blk(10, 'tok_10', 0, 'account_refresh_pending'),
  'false|awaiting_connected_balance:1:pending_reconciliation:-:-:-:-:claimed',
  'pending account: a stale stage version is refused');
select is(pg_temp.blk(61, 'tok_other', 1, 'payouts_disabled'),
  'false|awaiting_connected_balance:1:pending_reconciliation:-:-:-:-:claimed',
  'actionable account: another claim token is refused, not requeued');
select is(pg_temp.blk(61, 'tok_61', 0, 'payouts_disabled'),
  'false|awaiting_connected_balance:1:pending_reconciliation:-:-:-:-:claimed',
  'actionable account: a stale stage version is refused, not requeued');
select is(pg_temp.blk(62, 'tok_62', 1, 'payouts_disabled'),
  'false|awaiting_connected_balance:1:pending_reconciliation:-:-:-:-:claimed',
  'an expired lease is refused, not requeued');
select is(pg_temp.blk(63, 'tok_63', 1, 'payouts_disabled'),
  'false|awaiting_connected_balance:1:pending_reconciliation:-:-:-:po_blk_63:claimed',
  'a run with a Stripe payout is refused, not requeued');
select is(pg_temp.blk(64, 'tok_64', 1, 'payouts_disabled'),
  'false|transfer_created:1:pending_reconciliation:-:-:-:-:claimed',
  'a stage outside awaiting_connected_balance and payout_create_in_progress is refused');
select is(pg_temp.blk(98, 'tok_98', 1, 'payouts_disabled'), 'false|', 'an unknown run is refused');
select is(public.fn_block_payout_run_for_account_actionability(null, 'tok_10', 1, null), false,
  'a NULL run id is refused');

-- 3. A non-actionable account at lock time parks the run, as before -------------
select is(pg_temp.blk(10, 'tok_10', 1, 'account_refresh_pending'),
  'true|action_required:2:reconciliation_needed:account_not_actionable:account_not_actionable: account_refresh_pending:-:-:unclaimed',
  'refresh pending: the run is parked with a new version and no claim');
select is(pg_temp.blk(11, 'tok_11', 1, 'account_refresh_pending'),
  'true|action_required:2:reconciliation_needed:account_not_actionable:account_not_actionable: account_refresh_pending:-:-:unclaimed',
  'refresh pending: a claimed run in payout_create_in_progress is parked');
select is(pg_temp.blk(20, 'tok_20', 1, 'payouts_disabled'),
  'true|action_required:2:reconciliation_needed:account_not_actionable:account_not_actionable: payouts_disabled:-:-:unclaimed',
  'blocked account: the run is parked with the blocked reason');
select is(pg_temp.blk(50, 'tok_50', 1, null),
  'true|action_required:2:reconciliation_needed:account_not_actionable:account_not_actionable: unknown:-:-:unclaimed',
  'a seller without a Stripe account: the run is parked as before');
select is(pg_temp.blk(10, 'tok_10', 1, 'account_refresh_pending'),
  'false|action_required:2:reconciliation_needed:account_not_actionable:account_not_actionable: account_refresh_pending:-:-:unclaimed',
  'replaying the park is refused');

-- 4. An actionable account at lock time requeues the run (the cron race) -------
select is(pg_temp.blk(30, 'tok_30', 1, 'account_refresh_pending'),
  'false|awaiting_connected_balance:2:pending_reconciliation:-:-:-:-:unclaimed',
  'actionable account: the run is requeued, not parked, with its error, next attempt and claim cleared');
select is(pg_temp.blk(31, 'tok_31', 1, 'account_refresh_pending'),
  'false|payout_create_in_progress:1:pending_reconciliation:-:-:-:-:claimed',
  'actionable account: a run inside its payout-create fence keeps its stage and claim, never requeued to a create stage');
select is(pg_temp.blk(40, 'tok_40', 1, 'payouts_disabled'),
  'false|awaiting_connected_balance:2:pending_reconciliation:-:-:-:-:unclaimed',
  'account without an actionability row: the run is requeued');
select is(pg_temp.blk(30, 'tok_30', 1, 'account_refresh_pending'),
  'false|awaiting_connected_balance:2:pending_reconciliation:-:-:-:-:unclaimed',
  'replaying the call after the requeue changes nothing');

-- 5. Mappings never change -------------------------------------------------------
select is(pg_temp.maps(n), 'pending_reconciliation', 'run ' || n || ' keeps its mapping pending_reconciliation')
from unnest(array[10, 11, 20, 30, 31, 40, 50, 61, 62, 63, 64]) as n;

-- 6. The worker claims the requeued runs again, never a parked one --------------
-- Release the leases the fixture still holds, so only the RPC outcome decides.
reset role;
update public.connect_payout_runs set payout_claim_token = null, payout_claim_expires_at = null
where id in (pg_temp.mu(61), pg_temp.mu(62), pg_temp.mu(63), pg_temp.mu(64));
set local role service_role;
select is(pg_temp.claim_all(), array[30, 40, 61, 62],
  'the worker claims the requeued runs and never a parked one');

select * from finish();
rollback;
