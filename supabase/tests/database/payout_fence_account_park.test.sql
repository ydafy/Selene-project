-- Parking a payout run from the manual payout-create fence (#352 T1, S3, S6).
-- release-connect-payout opens the fence with fn_begin_manual_payout_create_fence
-- and re-checks the seller's account before calling Stripe. When the account is
-- refresh-pending or not actionable, fn_park_payout_run_from_fence parks the run
-- in action_required (account_not_actionable) so an actionable
-- fn_commit_connect_account_refresh resumes it and the worker claims it. When
-- the account is actionable again by the time the RPC holds the account lock,
-- the run goes back to awaiting_connected_balance instead. The shipment
-- mappings stay pending_reconciliation in both outcomes.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(40);
\ir ../fixtures/money.psql

-- A shipment of p_seller (listing p_n, order p_n + 100) with its Stripe
-- Transfer already created, as release-connect-payout leaves it before the fence.
create function pg_temp.shipment(p_n integer, p_seller integer) returns uuid language plpgsql as $$
begin
  perform pg_temp.money_shipment(p_n + 100, p_n, p_seller, 2);
  update public.shipments set stripe_transfer_id = 'tr_park_' || p_n where id = pg_temp.mu(p_n);
  return pg_temp.mu(p_n);
end $$;

-- Run p_run of p_seller over shipment p_shipment, opened through the real
-- manual fence from awaiting_connected_balance. Returns the fence version.
create function pg_temp.fenced(p_run integer, p_seller integer, p_shipment integer) returns integer language plpgsql as $$
begin
  perform pg_temp.money_payout_run(p_run, p_seller, 3, array[p_shipment],
    'pending_reconciliation', 'awaiting_connected_balance');
  return public.fn_begin_manual_payout_create_fence(pg_temp.mu(p_run));
end $$;

-- stage:version:status:reason:last error:payout id:claim
create function pg_temp.rs(p_run integer) returns text language sql as $$
  select concat_ws(':', coalesce(release_stage, '-'), release_stage_version, status,
    coalesce(action_required_reason, '-'), coalesce(last_error, '-'),
    coalesce(stripe_payout_id, '-'),
    case when payout_claim_token is null and payout_claim_expires_at is null then 'unclaimed' else 'claimed' end)
  from public.connect_payout_runs where id = pg_temp.mu(p_run)
$$;

-- The statuses of the mappings of p_run, comma separated.
create function pg_temp.maps(p_run integer) returns text language sql as $$
  select string_agg(status, ',' order by shipment_id)
  from public.connect_payout_run_shipments where run_id = pg_temp.mu(p_run)
$$;

-- result|state of p_run after calling the park RPC; an error comes back as
-- its message, so a broken rule fails one assertion, not the file.
create function pg_temp.park(p_run_id uuid, p_version integer, p_run integer) returns text language plpgsql as $$
declare r text;
begin
  select outcome || ':' || stage_version into r
  from public.fn_park_payout_run_from_fence(p_run_id, p_version);
  return r || '|' || coalesce(pg_temp.rs(p_run), '');
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

-- 1 seller A, refresh pending (acct_parkA); 2 buyer; 3 admin; 4 seller B,
-- payouts disabled (acct_parkB); 5 seller C, actionable (acct_parkC);
-- 6 seller D, no actionability row (acct_parkD); 7 seller E, no Stripe account.
select pg_temp.money_user(1);
select pg_temp.money_user(2);
select pg_temp.money_user(3, 'admin');
select pg_temp.money_user(4);
select pg_temp.money_user(5);
select pg_temp.money_user(6);
select pg_temp.money_user(7);
update public.profiles_private set stripe_account_id = 'acct_park' || x
from (values (1, 'A'), (4, 'B'), (5, 'C'), (6, 'D')) as v(n, x)
where id = pg_temp.mu(v.n);

select public.fn_record_connect_account_event('evt_park' || x, 'acct_park' || x, 'account.updated', now(), null, null, null)
from unnest(array['A', 'B', 'C']) as x;
create table pg_temp.gen (acct text primary key, g bigint);
insert into pg_temp.gen
select 'acct_park' || x, public.fn_acquire_connect_account_refresh('acct_park' || x, 'evt_park' || x)
from unnest(array['A', 'B', 'C']) as x;
select public.fn_commit_connect_account_refresh('acct_parkB', (select g from pg_temp.gen where acct = 'acct_parkB'),
  'evt_parkB', false, 'payouts_disabled', false, null, null, null, null, null);
select public.fn_commit_connect_account_refresh('acct_parkC', (select g from pg_temp.gen where acct = 'acct_parkC'),
  'evt_parkC', true, null, true, 'ba_parkdefault', 'verified', 'mxn', true, 1);

-- Runs, one shipment each (shipment = run + 100, order = run + 200). Every
-- fenced run starts at version 1 and is at version 2 inside the fence.
select pg_temp.shipment(n + 100, s)
from (values (10, 1), (20, 4), (30, 5), (40, 6), (50, 1), (51, 1), (52, 1), (53, 1), (54, 1), (55, 7), (60, 1)) as r(n, s);
select pg_temp.fenced(n, s, n + 100)
from (values (10, 1), (20, 4), (30, 5), (40, 6), (51, 1), (52, 1), (53, 1), (54, 1), (55, 7)) as r(n, s);
select pg_temp.money_payout_run(50, 1, 3, array[150], 'pending_reconciliation', 'transfer_created');
update public.connect_payout_runs set last_error = 'stale error' where id = pg_temp.mu(30);
update public.connect_payout_runs set payout_claim_token = 'tok_52', payout_claim_expires_at = now() + interval '5 minutes'
where id = pg_temp.mu(52);
update public.connect_payout_runs set stripe_payout_id = 'po_park_53' where id = pg_temp.mu(53);
update public.connect_payout_runs set status = 'reconciliation_needed' where id = pg_temp.mu(54);
-- A retry child: the failed parent 60 keeps its failed mapping, the child 61
-- maps the same shipment and reaches the fence.
select pg_temp.money_payout_run(60, 1, 3, array[160], 'failed', 'payout_failed');
select pg_temp.money_payout_run(61, 1, 3, array[160], 'pending_reconciliation', 'awaiting_connected_balance');
update public.connect_payout_runs set retry_of_run_id = pg_temp.mu(60) where id = pg_temp.mu(61);
select public.fn_begin_manual_payout_create_fence(pg_temp.mu(61));
create table pg_temp.parent as select to_jsonb(r) as v from public.connect_payout_runs r where id = pg_temp.mu(60);
grant select on pg_temp.parent, pg_temp.gen to service_role;

-- 1. Grants: service_role only -------------------------------------------------
select is(pg_temp.exec_roles('public.fn_park_payout_run_from_fence(uuid, integer)'), 'service_role',
  'fn_park_payout_run_from_fence is executable by service_role only');
select is_definer('public', 'fn_park_payout_run_from_fence', array['uuid', 'integer'],
  'fn_park_payout_run_from_fence is SECURITY DEFINER');
select ok(
  (select 'search_path=public' = any(proconfig) from pg_proc where proname = 'fn_park_payout_run_from_fence'),
  'fn_park_payout_run_from_fence pins search_path to public');
set local role anon;
select throws_ok($$select * from public.fn_park_payout_run_from_fence('f0000000-0000-4000-8000-000000000010', 2)$$,
  '42501', null, 'anon cannot call fn_park_payout_run_from_fence');
reset role;
set local role authenticated;
select throws_ok($$select * from public.fn_park_payout_run_from_fence('f0000000-0000-4000-8000-000000000010', 2)$$,
  '42501', null, 'authenticated cannot call fn_park_payout_run_from_fence');
reset role;

-- The Edge Function calls the RPCs with the service role.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

-- 2. A non-actionable account parks the run ------------------------------------
select is(pg_temp.park(pg_temp.mu(10), 2, 10),
  'parked:3|action_required:3:reconciliation_needed:account_not_actionable:account_not_actionable: account_refresh_pending:-:unclaimed',
  'refresh pending: the run is parked with the pending reason, a new version and no claim');
select is(pg_temp.maps(10), 'pending_reconciliation', 'refresh pending: the mapping stays pending_reconciliation');
select is(pg_temp.park(pg_temp.mu(20), 2, 20),
  'parked:3|action_required:3:reconciliation_needed:account_not_actionable:account_not_actionable: payouts_disabled:-:unclaimed',
  'blocked account: the run is parked with the blocked reason');
select is(pg_temp.maps(20), 'pending_reconciliation', 'blocked account: the mapping stays pending_reconciliation');
select is(pg_temp.park(pg_temp.mu(61), 2, 61),
  'parked:3|action_required:3:reconciliation_needed:account_not_actionable:account_not_actionable: account_refresh_pending:-:unclaimed',
  'retry child: the child is parked like a first release');
select is(pg_temp.maps(61), 'pending_reconciliation', 'retry child: the child mapping stays pending_reconciliation');
select is((select to_jsonb(r) from public.connect_payout_runs r where id = pg_temp.mu(60)), (select v from pg_temp.parent),
  'retry child: the failed parent is untouched');

-- 3. An actionable account at lock time requeues the run -----------------------
-- This is also the race of S3: a refresh committed between the Edge Function's
-- check and this call leaves the run requeued, never parked.
select is(pg_temp.park(pg_temp.mu(30), 2, 30),
  'requeued:3|awaiting_connected_balance:3:pending_reconciliation:-:-:-:unclaimed',
  'actionable account: the run goes back to awaiting_connected_balance with its last error cleared');
select is(pg_temp.maps(30), 'pending_reconciliation', 'actionable account: the mapping stays pending_reconciliation');
select is(pg_temp.park(pg_temp.mu(40), 2, 40),
  'requeued:3|awaiting_connected_balance:3:pending_reconciliation:-:-:-:unclaimed',
  'account without an actionability row: the run is requeued');

-- 4. Refusals raise and change nothing -----------------------------------------
select is(pg_temp.park(null, 2, 10),
  'PAYOUT_RUN_NOT_FOUND|action_required:3:reconciliation_needed:account_not_actionable:account_not_actionable: account_refresh_pending:-:unclaimed',
  'a NULL run id is refused');
select is(pg_temp.park(pg_temp.mu(98), 2, 98), 'PAYOUT_RUN_NOT_FOUND|', 'an unknown run is refused');
select is(pg_temp.park(pg_temp.mu(51), null, 51),
  'STAGE_VERSION_CONFLICT|payout_create_in_progress:2:pending_reconciliation:-:-:-:unclaimed',
  'a NULL stage version is refused');
select is(pg_temp.park(pg_temp.mu(51), 1, 51),
  'STAGE_VERSION_CONFLICT|payout_create_in_progress:2:pending_reconciliation:-:-:-:unclaimed',
  'a stale stage version is refused');
select is(pg_temp.park(pg_temp.mu(50), 1, 50),
  'PAYOUT_CREATE_FENCE_CONFLICT|transfer_created:1:pending_reconciliation:-:-:-:unclaimed',
  'a run outside payout_create_in_progress is refused');
select is(pg_temp.park(pg_temp.mu(52), 2, 52),
  'EXECUTOR_CLAIM_HELD|payout_create_in_progress:2:pending_reconciliation:-:-:-:claimed',
  'a run with an executor claim is refused');
select is(pg_temp.park(pg_temp.mu(53), 2, 53),
  'PAYOUT_CREATE_FENCE_CONFLICT|payout_create_in_progress:2:pending_reconciliation:-:-:po_park_53:unclaimed',
  'a run with a Stripe payout is refused');
select is(pg_temp.park(pg_temp.mu(54), 2, 54),
  'PAYOUT_CREATE_FENCE_CONFLICT|payout_create_in_progress:2:reconciliation_needed:-:-:-:unclaimed',
  'a run that is not pending_reconciliation is refused');
select is(pg_temp.park(pg_temp.mu(55), 2, 55),
  'MISSING_STRIPE_ACCOUNT_ID|payout_create_in_progress:2:pending_reconciliation:-:-:-:unclaimed',
  'a seller without a Stripe account is refused');
select is(pg_temp.park(pg_temp.mu(10), 2, 10),
  'STAGE_VERSION_CONFLICT|action_required:3:reconciliation_needed:account_not_actionable:account_not_actionable: account_refresh_pending:-:unclaimed',
  'replaying the park with the fence version is refused');
select is(pg_temp.park(pg_temp.mu(10), 3, 10),
  'PAYOUT_CREATE_FENCE_CONFLICT|action_required:3:reconciliation_needed:account_not_actionable:account_not_actionable: account_refresh_pending:-:unclaimed',
  'parking an already parked run is refused');
select is(pg_temp.maps(n), 'pending_reconciliation', 'refused run ' || n || ' keeps its mapping')
from unnest(array[50, 51, 52, 53, 54, 55]) as n;

-- 5. An actionable refresh resumes the parked runs and the worker claims them ---
select is(pg_temp.claim_all(), array[30, 40],
  'before the refresh the worker claims only the requeued runs, never a parked one');
select is(public.fn_commit_connect_account_refresh('acct_parkA', (select g from pg_temp.gen where acct = 'acct_parkA'),
  'evt_parkA', true, null, true, 'ba_parkdefault', 'verified', 'mxn', true, 1), true,
  'an actionable refresh of account A is accepted');
select is(pg_temp.rs(n), 'awaiting_connected_balance:4:pending_reconciliation:-:-:-:unclaimed',
  'the actionable refresh resumes parked run ' || n)
from unnest(array[10, 61]) as n;
select is(pg_temp.rs(20),
  'action_required:3:reconciliation_needed:account_not_actionable:account_not_actionable: payouts_disabled:-:unclaimed',
  'a run parked for another account stays parked');
select is(pg_temp.claim_all(), array[10, 61], 'the worker claims the resumed first release and retry child');
select is(pg_temp.maps(n), 'pending_reconciliation', 'claimed run ' || n || ' keeps its mapping pending')
from unnest(array[10, 61]) as n;

select * from finish();
rollback;
