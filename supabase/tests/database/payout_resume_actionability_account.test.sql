-- Account actionability and payout runs (#275 T6). A committed account refresh
-- (fn_commit_connect_account_refresh) projects onto the seller's runs: a
-- blocked account parks every pre-payout run in action_required with the
-- account_not_actionable reason, and an actionable one resumes exactly those
-- parks. The legacy event-time projection (fn_apply_connect_account_actionability)
-- is fenced. fn_block_payout_run_for_account_actionability parks one claimed
-- run, only under its live claim. The refresh generation itself (acquire,
-- getter, evidence table) stays in connect_account_actionability.test.ts.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(50);
\ir ../fixtures/money.psql

-- status:stage:version:reason:last_error:claim cleared:next_attempt_at cleared
create function pg_temp.st(p_run integer) returns text language sql as $$
  select status || ':' || coalesce(release_stage, '-') || ':' || release_stage_version
    || ':' || coalesce(action_required_reason, '-') || ':' || coalesce(last_error, '-')
    || ':' || (payout_claim_token is null and payout_claim_expires_at is null)::text
    || ':' || (next_attempt_at is null)::text
  from public.connect_payout_runs where id = pg_temp.mu(p_run)
$$;

-- Whole-row snapshots, to prove a run outside the projection did not change.
create table pg_temp.snap (label text, n integer, v jsonb, primary key (label, n));
create function pg_temp.remember(p_label text) returns void language sql as $$
  insert into pg_temp.snap
  select p_label, n, to_jsonb(r) from public.connect_payout_runs r
  cross join lateral (select n from generate_series(6600, 6699) as n where pg_temp.mu(n) = r.id) as ids
$$;
create function pg_temp.same(p_label text, p_runs integer[]) returns boolean language sql as $$
  select bool_and(to_jsonb(r) = s.v) and count(*) = cardinality(p_runs)
  from unnest(p_runs) as u(n)
  join pg_temp.snap s on s.label = p_label and s.n = u.n
  join public.connect_payout_runs r on r.id = pg_temp.mu(u.n)
$$;

create function pg_temp.run(
  p_run integer, p_seller integer, p_status text, p_stage text, p_extra text default null
) returns void language plpgsql as $$
begin
  perform pg_temp.money_payout_run(p_run, p_seller, 6501, array[]::integer[], p_status, p_stage);
  if p_extra is not null then
    execute format('update public.connect_payout_runs set %s where id = %L', p_extra, pg_temp.mu(p_run));
  end if;
end $$;

create function pg_temp.record(p_acct text, p_evt text) returns boolean language sql as $$
  select public.fn_record_connect_account_event(p_evt, p_acct, 'account.updated', now(), null, null, null)
$$;
create function pg_temp.commit_blocked(p_acct text, p_generation bigint, p_evt text) returns boolean language sql as $$
  select public.fn_commit_connect_account_refresh(p_acct, p_generation, p_evt, false, 'payouts_disabled', false,
    null, null, null, null, null)
$$;
create function pg_temp.commit_actionable(p_acct text, p_generation bigint, p_evt text) returns boolean language sql as $$
  select public.fn_commit_connect_account_refresh(p_acct, p_generation, p_evt, true, null, true,
    'ba_t6default', 'verified', 'mxn', true, 1)
$$;

-- Runs p_setup, calls the block RPC, and undoes both: 'blocked', or 'refused'
-- when it returned FALSE and changed no run, 'error <message>' when it raised.
create function pg_temp.try_block(p_setup text, p_run integer, p_token text, p_version integer)
returns text language plpgsql as $$
declare
  v_before jsonb;
  v_outcome text;
begin
  begin
    execute p_setup;
    select jsonb_agg(to_jsonb(r) order by r.id) into v_before from public.connect_payout_runs r;
    v_outcome := case when public.fn_block_payout_run_for_account_actionability(pg_temp.mu(p_run), p_token, p_version, 'payouts_disabled')
      then 'blocked'
      when (select jsonb_agg(to_jsonb(r) order by r.id) from public.connect_payout_runs r) is distinct from v_before
      then 'refused after writing' else 'refused' end;
    raise exception using errcode = 'P0T06';
  exception
    when sqlstate 'P0T06' then return v_outcome;
    when others then return 'error ' || sqlerrm;
  end;
end $$;

-- 6501 admin; 6502 seller A (acct_t6sellerA); 6504 seller B (acct_t6sellerB).
select pg_temp.money_user(6501, 'admin');
select pg_temp.money_user(6502);
select pg_temp.money_user(6504);
update public.profiles_private set stripe_account_id = 'acct_t6sellerA' where id = pg_temp.mu(6502);
update public.profiles_private set stripe_account_id = 'acct_t6sellerB' where id = pg_temp.mu(6504);

-- Seller A: 6601-6605 are pre-payout and get parked; 6606-6610 never do.
select pg_temp.run(6601, 6502, 'pending_reconciliation', 'release_accepted',
  $$payout_claim_token = 'tok_6601', payout_claim_expires_at = now() + interval '1 hour'$$);
select pg_temp.run(6602, 6502, 'pending_reconciliation', 'transfer_created');
select pg_temp.run(6603, 6502, 'pending_reconciliation', 'awaiting_connected_balance',
  $$next_attempt_at = now() + interval '1 hour'$$);
select pg_temp.run(6604, 6502, 'pending_reconciliation', null);
select pg_temp.run(6605, 6502, 'reconciliation_needed', 'awaiting_connected_balance');
select pg_temp.run(6606, 6502, 'pending_reconciliation', 'payout_create_in_progress',
  $$payout_claim_token = 'tok_6606', payout_claim_expires_at = now() + interval '1 hour'$$);
select pg_temp.run(6607, 6502, 'pending_reconciliation', 'awaiting_connected_balance', $$stripe_payout_id = 'po_t6_6607'$$);
select pg_temp.run(6608, 6502, 'failed', 'awaiting_connected_balance');
select pg_temp.run(6609, 6502, 'reconciliation_needed', 'action_required', $$action_required_reason = 'manual_review'$$);
select pg_temp.run(6610, 6502, 'pending_reconciliation', 'ready');
-- Parked runs a resume must not touch: one with a payout, one failed.
select pg_temp.run(6611, 6502, 'reconciliation_needed', 'action_required',
  $$action_required_reason = 'account_not_actionable', stripe_payout_id = 'po_t6_6611'$$);
select pg_temp.run(6612, 6502, 'failed', 'action_required', $$action_required_reason = 'account_not_actionable'$$);
-- Seller B: one run in each projection's reach.
select pg_temp.run(6621, 6504, 'pending_reconciliation', 'awaiting_connected_balance');
select pg_temp.run(6622, 6504, 'reconciliation_needed', 'action_required', $$action_required_reason = 'account_not_actionable'$$);

-- 1. Grants: service_role only ------------------------------------------------
select is(
  array[has_function_privilege('anon', f, 'execute'), has_function_privilege('authenticated', f, 'execute'),
    has_function_privilege('service_role', f, 'execute')],
  array[false, false, true], f || ' is executable by service_role only')
from (values
  ('public.fn_block_payout_run_for_account_actionability(uuid, text, integer, text)'),
  ('public.fn_commit_connect_account_refresh(text, bigint, text, boolean, text, boolean, text, text, text, boolean, integer)'),
  ('public.fn_apply_connect_account_actionability(text, boolean, text, timestamptz, boolean, text, text)'),
  ('public.fn_record_connect_account_event(text, text, text, timestamptz, boolean, text, text)'),
  ('public.fn_get_connect_account_actionability(text)')
) as fns(f);
select is_definer('public', 'fn_block_payout_run_for_account_actionability', array['uuid', 'text', 'integer', 'text'],
  'fn_block_payout_run_for_account_actionability is SECURITY DEFINER');
select ok(
  (select 'search_path=public' = any(proconfig) from pg_proc where proname = 'fn_block_payout_run_for_account_actionability'),
  'fn_block_payout_run_for_account_actionability pins search_path to public');

-- 2. Evidence is idempotent by Stripe event id; the legacy projection is fenced
select is(pg_temp.record('acct_t6sellerA', 'evt_t6a1'), true, 'the first delivery of an account event is recorded');
select is(pg_temp.record('acct_t6sellerA', 'evt_t6a1'), false, 'a second delivery of the same event is a no-op');
select pg_temp.record('acct_t6sellerA', 'evt_t6a2');
select pg_temp.record('acct_t6sellerB', 'evt_t6b1');
select pg_temp.remember('start');
select throws_ok(
  $$select public.fn_apply_connect_account_actionability('acct_t6sellerA', false, 'payouts_disabled', now())$$,
  'P0001', 'ACCOUNT_REFRESH_REQUIRED', 'the legacy event-time projection is fenced');

-- 3. A blocked refresh parks the pre-payout runs of that account ---------------
create table pg_temp.gen as select public.fn_acquire_connect_account_refresh('acct_t6sellerA', 'evt_t6a1') as g;
select ok(pg_temp.same('start', array[6601, 6602, 6603, 6604, 6605, 6606, 6607, 6608, 6609, 6610, 6611, 6612]),
  'acquiring a refresh changes no run');
select is(pg_temp.commit_blocked('acct_t6sellerA', (select g from pg_temp.gen), 'evt_t6a1'), true,
  'blocked: the refresh is accepted');
select is(pg_temp.st(6601),
  'reconciliation_needed:action_required:2:account_not_actionable:account_not_actionable: payouts_disabled:true:true',
  'blocked: a release_accepted run is parked and its claim cleared');
select is(pg_temp.st(6602),
  'reconciliation_needed:action_required:2:account_not_actionable:account_not_actionable: payouts_disabled:true:true',
  'blocked: a transfer_created run is parked');
select is(pg_temp.st(6603),
  'reconciliation_needed:action_required:2:account_not_actionable:account_not_actionable: payouts_disabled:true:false',
  'blocked: an awaiting_connected_balance run is parked');
select is(pg_temp.st(6604),
  'reconciliation_needed:action_required:2:account_not_actionable:account_not_actionable: payouts_disabled:true:true',
  'blocked: a run without a stage is parked');
select is(pg_temp.st(6605),
  'reconciliation_needed:action_required:2:account_not_actionable:account_not_actionable: payouts_disabled:true:true',
  'blocked: a reconciliation_needed run is parked');
select ok(pg_temp.same('start', array[6606]), 'blocked: a run fenced in payout_create_in_progress is never parked');
select ok(pg_temp.same('start', array[6607]), 'blocked: a run with a Stripe payout is not parked');
select ok(pg_temp.same('start', array[6608]), 'blocked: a failed run is not parked');
select ok(pg_temp.same('start', array[6609]), 'blocked: a run parked for another reason keeps it');
select ok(pg_temp.same('start', array[6610]), 'blocked: a ready run is not parked');
select ok(pg_temp.same('start', array[6621, 6622]), 'blocked: runs of another account are untouched');

select pg_temp.remember('blocked');
select is(pg_temp.commit_blocked('acct_t6sellerA', (select g from pg_temp.gen), 'evt_t6a1'), false,
  'blocked: replaying the accepted refresh is refused');
select ok(pg_temp.same('blocked', array[6601, 6602, 6603, 6604, 6605, 6606, 6607, 6608, 6609, 6610, 6611, 6612]),
  'blocked: the replay changed no run');

-- 4. An actionable refresh resumes exactly the account_not_actionable parks ----
select pg_temp.run(6613, 6502, 'pending_reconciliation', 'awaiting_connected_balance');
update pg_temp.gen set g = public.fn_acquire_connect_account_refresh('acct_t6sellerA', 'evt_t6a2');
select pg_temp.remember('acquired');
select is(pg_temp.commit_actionable('acct_t6sellerA', (select g from pg_temp.gen) - 1, 'evt_t6a2'), false,
  'actionable: a superseded generation is refused');
select ok(pg_temp.same('acquired', array[6601, 6602, 6603, 6604, 6605, 6611, 6612, 6613]),
  'actionable: the superseded refresh changed no run');
select is(pg_temp.commit_actionable('acct_t6sellerA', (select g from pg_temp.gen), 'evt_t6a2'), true,
  'actionable: the current refresh is accepted');
select is(pg_temp.st(n), 'pending_reconciliation:awaiting_connected_balance:3:-:-:true:true',
  'actionable: parked run ' || n || ' is back in awaiting_connected_balance')
from unnest(array[6601, 6602, 6603, 6604, 6605]) as n;
select ok(pg_temp.same('acquired', array[6611]), 'actionable: a parked run with a Stripe payout stays parked');
select ok(pg_temp.same('acquired', array[6612]), 'actionable: a failed parked run stays parked');
select ok(pg_temp.same('acquired', array[6609]), 'actionable: a run parked for another reason stays parked');
select ok(pg_temp.same('acquired', array[6606, 6607, 6608, 6610]), 'actionable: runs that were never parked are untouched');
select ok(pg_temp.same('acquired', array[6613]), 'actionable: an awaiting_connected_balance run is not parked');
select ok(pg_temp.same('acquired', array[6621, 6622]), 'actionable: runs of another account are untouched');

-- 5. The executor parks one claimed run, only under its live claim -------------
-- A claimed run is parked before any payout exists; #352 tracks the retry this
-- leaves without a release path.
select pg_temp.run(6631, 6504, 'pending_reconciliation', 'awaiting_connected_balance',
  $$release_stage_version = 4, payout_claim_token = 'tok_6631', payout_claim_expires_at = now() + interval '1 hour'$$);
select pg_temp.run(6632, 6504, 'pending_reconciliation', 'payout_create_in_progress',
  $$payout_claim_token = 'tok_6632', payout_claim_expires_at = now() + interval '1 hour', payout_create_attempted_at = now()$$);
select is(pg_temp.try_block('select 1', 6631, 'tok_6631', 4), 'blocked', 'block: fixture, the live claim would park the run');
select is(pg_temp.try_block('select 1', 6631, 'tok_other', 4), 'refused', 'block: refuses another claim token');
select is(pg_temp.try_block('select 1', 6631, 'tok_6631', 3), 'refused', 'block: refuses a stale stage version');
select is(pg_temp.try_block($$update public.connect_payout_runs set payout_claim_expires_at = now() - interval '1 second' where id = pg_temp.mu(6631)$$,
  6631, 'tok_6631', 4), 'refused', 'block: refuses an expired lease');
select is(pg_temp.try_block($$update public.connect_payout_runs set stripe_payout_id = 'po_t6_6631' where id = pg_temp.mu(6631)$$,
  6631, 'tok_6631', 4), 'refused', 'block: refuses a run with a Stripe payout');
select is(pg_temp.try_block($$update public.connect_payout_runs set release_stage = 'transfer_created' where id = pg_temp.mu(6631)$$,
  6631, 'tok_6631', 4), 'refused', 'block: refuses a stage outside awaiting_connected_balance and payout_create_in_progress');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(public.fn_block_payout_run_for_account_actionability('f0000000-0000-4000-8000-000000006631', 'tok_6631', 4, 'payouts_disabled'),
  true, 'block: service_role parks the claimed run');
reset role;
select is(pg_temp.st(6631),
  'reconciliation_needed:action_required:5:account_not_actionable:account_not_actionable: payouts_disabled:true:true',
  'block: the run is parked with the reason, a new version and no claim');
select is(public.fn_block_payout_run_for_account_actionability(pg_temp.mu(6631), 'tok_6631', 4, 'payouts_disabled'),
  false, 'block: replaying the block is refused');
select is(public.fn_block_payout_run_for_account_actionability(pg_temp.mu(6632), 'tok_6632', 1, null),
  true, 'block: a claimed run in payout_create_in_progress is parked');
select is(pg_temp.st(6632),
  'reconciliation_needed:action_required:2:account_not_actionable:account_not_actionable: unknown:true:true',
  'block: without a reason the last error says unknown');

select * from finish();
rollback;
