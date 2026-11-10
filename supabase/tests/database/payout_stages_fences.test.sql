-- The payout release stages and the payout-create fence (#275 T5, part 1 of 3):
-- the release_stage and status CHECK values, fn_transition_payout_release_stage,
-- fn_begin_payout_create_fence, fn_begin_manual_payout_create_fence and the
-- three fence exits (complete, fail, abort). Every write is conditional on the
-- stage version and, when the caller holds one, on the executor claim token and
-- its unexpired lease; a successful exit clears the claim. The refusals and
-- grant of fn_begin_payout_create_fence are in payout_claims.test.sql. Webhook
-- projections: payout_stages_projections.test.sql; parks: payout_stages_parks.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(66);
\ir ../fixtures/money.psql

-- Run p_run of seller 1 over its own shipment (p_run + 100, order p_run + 200),
-- with the given fence columns. p_lease NULL leaves no claim lease.
create function pg_temp.run(
  p_run integer, p_stage text, p_version integer default 1, p_token text default null,
  p_lease interval default null, p_status text default 'pending_reconciliation',
  p_payout text default null
) returns uuid language plpgsql as $$
begin
  perform pg_temp.money_shipment(p_run + 200, p_run + 100, 1, 2);
  perform pg_temp.money_payout_run(p_run, 1, 3, array[p_run + 100], p_status, p_stage);
  update public.connect_payout_runs
  set release_stage_version = p_version, payout_claim_token = p_token,
    payout_claim_expires_at = now() + p_lease, stripe_payout_id = p_payout
  where id = pg_temp.mu(p_run);
  return pg_temp.mu(p_run);
end $$;

-- stage:version:status:payout id:claim token:lease
create function pg_temp.rs(p_run integer) returns text language sql as $$
  select concat_ws(':', coalesce(release_stage, '-'), release_stage_version, status,
    coalesce(stripe_payout_id, '-'), coalesce(payout_claim_token, '-'),
    case when payout_claim_expires_at is null then '-' else 'lease' end)
  from public.connect_payout_runs where id = pg_temp.mu(p_run)
$$;

-- result|state of p_run, the call evaluated before the state is read. An error
-- comes back as its message, so a broken rule fails one assertion, not the file.
create function pg_temp.call(p_sql text, p_run integer) returns text language plpgsql as $$
declare r text;
begin
  execute p_sql into r;
  return r || '|' || pg_temp.rs(p_run);
exception when others then
  return sqlerrm || '|' || pg_temp.rs(p_run);
end $$;

-- The values of p_values that the CHECK of p_column on run 9 accepts.
create function pg_temp.accepts(p_column text, p_values text[]) returns text[] language plpgsql as $$
declare v text; ok text[] := '{}';
begin
  foreach v in array p_values loop
    begin
      execute format('update public.connect_payout_runs set %I = %L where id = pg_temp.mu(9)', p_column, v);
      raise exception using errcode = 'P0099';
    exception
      when check_violation then null;
      when sqlstate 'P0099' then ok := ok || v;
    end;
  end loop;
  return ok;
end $$;

-- The roles of anon, authenticated and service_role that may execute p_fn.
create function pg_temp.exec_roles(p_fn text) returns text language sql as $$
  select coalesce(string_agg(r, ',' order by r), '-')
  from unnest(array['anon', 'authenticated', 'service_role']) as r
  where has_function_privilege(r, p_fn, 'execute')
$$;

select pg_temp.money_user(1);
select pg_temp.money_user(2);
select pg_temp.money_user(3, 'admin');
select pg_temp.money_shipment(209, 109, 1, 2);
select pg_temp.money_payout_run(9, 1, 3, array[109]);
select pg_temp.run(10, 'ready');
select pg_temp.run(11, 'awaiting_connected_balance', 3, 'tok-11', interval '5 minutes');
select pg_temp.run(12, 'awaiting_connected_balance', 1, 'tok-12', interval '-1 minute');
select pg_temp.run(13, 'paid_observed', p_status => 'paid');
select pg_temp.run(14, 'payout_failed', p_status => 'failed');
select pg_temp.run(15, 'payout_canceled', p_status => 'canceled');
select pg_temp.run(16, 'action_required', p_status => 'reconciliation_needed');
select pg_temp.run(20, 'awaiting_connected_balance', 2, 'tok-20', interval '5 minutes');
select pg_temp.run(30, 'release_accepted');
select pg_temp.run(31, 'transfer_created');
select pg_temp.run(32, 'awaiting_connected_balance');
select pg_temp.run(33, null);
select pg_temp.run(34, 'payout_create_in_progress');
select pg_temp.run(35, 'ready');
select pg_temp.run(36, 'awaiting_connected_balance', 1, 'tok-36', interval '5 minutes');
select pg_temp.run(37, 'awaiting_connected_balance', 1, 'tok-37', interval '-1 minute');
select pg_temp.run(40, 'payout_create_in_progress', 3);
select pg_temp.run(41, 'payout_create_in_progress', 3, 'tok-41', interval '5 minutes');
select pg_temp.run(42, 'payout_create_in_progress', 3, 'tok-42', interval '-1 minute');
select pg_temp.run(43, 'payout_in_transit', 5, p_payout => 'po_43');
select pg_temp.run(44, 'paid_observed', 5, p_status => 'paid', p_payout => 'po_44');
select pg_temp.run(45, 'awaiting_connected_balance');
select pg_temp.run(50, 'payout_create_in_progress', 3);
select pg_temp.run(51, 'payout_create_in_progress', 3, p_payout => 'po_51');
select pg_temp.run(52, 'payout_create_in_progress', 3, 'tok-52', interval '5 minutes');
select pg_temp.run(53, 'payout_create_in_progress', 3, 'tok-53', interval '-1 minute');
select pg_temp.run(54, 'awaiting_connected_balance', 3);
select pg_temp.run(60, 'payout_create_in_progress', 3);
select pg_temp.run(61, 'payout_create_in_progress', 3, 'tok-61', interval '5 minutes');
select pg_temp.run(62, 'payout_create_in_progress', 3, 'tok-62', interval '-1 minute');
select pg_temp.run(63, 'payout_pending', 3, p_payout => 'po_63');

-- The Edge Functions call these RPCs with the service role.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

-- 1. Columns and constraints ---------------------------------------------------
select is(
  pg_temp.accepts('release_stage', array['ready', 'release_accepted', 'transfer_created',
    'awaiting_connected_balance', 'payout_create_in_progress', 'payout_pending',
    'payout_in_transit', 'paid_observed', 'payout_failed', 'payout_canceled',
    'action_required', 'pending', 'paid', 'in_transit', 'bogus']),
  array['ready', 'release_accepted', 'transfer_created', 'awaiting_connected_balance',
    'payout_create_in_progress', 'payout_pending', 'payout_in_transit', 'paid_observed',
    'payout_failed', 'payout_canceled', 'action_required'],
  'release_stage accepts exactly the eleven release stages');
select is(
  pg_temp.accepts('status', array['pending_reconciliation', 'paid', 'failed', 'canceled',
    'reconciliation_needed', 'pending', 'in_transit', 'payout_failed', 'bogus']),
  array['pending_reconciliation', 'paid', 'failed', 'canceled', 'reconciliation_needed'],
  'status accepts exactly the five run statuses');
select is(
  (select release_stage_version || ':' || attempt_count from public.connect_payout_runs where id = pg_temp.mu(9)),
  '1:0', 'a new run starts at stage version 1 with no attempts');
select has_index('public', 'connect_payout_runs', 'idx_connect_payout_runs_release_stage_next_attempt',
  array['release_stage', 'next_attempt_at'], 'executor candidates are indexed by stage and next attempt');
select ok(
  not has_table_privilege('anon', 'public.connect_payout_runs', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('authenticated', 'public.connect_payout_runs', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'),
  'anon and authenticated have no table privilege on connect_payout_runs');

-- 2. fn_transition_payout_release_stage ----------------------------------------
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(10), 'bogus', 1)$$,
  'P0001', 'UNSUPPORTED_RELEASE_STAGE', 'transition: an unknown stage is refused');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(10), 'release_accepted', null)$$,
  'P0001', 'INVALID_STAGE_VERSION', 'transition: a NULL expected version is refused');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(10), 'release_accepted', 0)$$,
  'P0001', 'INVALID_STAGE_VERSION', 'transition: an expected version below 1 is refused');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(99), 'release_accepted', 1)$$,
  'P0001', 'PAYOUT_RUN_NOT_FOUND', 'transition: an unknown run is refused');
select is(pg_temp.call($$select public.fn_transition_payout_release_stage(pg_temp.mu(10), 'release_accepted', 1, null, 'boom')$$, 10),
  '2|release_accepted:2:pending_reconciliation:-:-:-', 'transition: the stage moves and the version goes up by one');
select is((select last_error from public.connect_payout_runs where id = pg_temp.mu(10)), 'boom',
  'transition: last_error records the given error');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(10), 'release_accepted', 1)$$,
  'P0001', 'STAGE_VERSION_CONFLICT', 'transition: a replay with the old version is refused');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(10), 'transfer_created', 2, 'tok-x')$$,
  'P0001', 'STALE_CLAIM', 'transition: a claim token on a run that holds none is refused');
select is(pg_temp.rs(10), 'release_accepted:2:pending_reconciliation:-:-:-',
  'transition: the refused calls left run 10 unchanged');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(11), 'payout_create_in_progress', 3, 'tok-other')$$,
  'P0001', 'STALE_CLAIM', 'transition: another worker claim token is refused');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(12), 'payout_create_in_progress', 1, 'tok-12')$$,
  'P0001', 'CLAIM_LEASE_EXPIRED', 'transition: the claim token with a lapsed lease is refused');
select is(pg_temp.call($$select public.fn_transition_payout_release_stage(pg_temp.mu(11), 'payout_create_in_progress', 3, 'tok-11')$$, 11),
  '4|payout_create_in_progress:4:pending_reconciliation:-:-:-', 'transition: the claim holder moves the run and the claim is cleared');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(13), 'payout_pending', 1)$$,
  'P0001', 'TERMINAL_STAGE_REGRESSION', 'transition: paid_observed never goes back to payout_pending');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(14), 'ready', 1)$$,
  'P0001', 'TERMINAL_STAGE_REGRESSION', 'transition: payout_failed never goes back to ready');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(15), 'action_required', 1)$$,
  'P0001', 'TERMINAL_STAGE_REGRESSION', 'transition: payout_canceled never goes to action_required');
select is(pg_temp.call($$select public.fn_transition_payout_release_stage(pg_temp.mu(13), 'payout_failed', 1)$$, 13),
  '2|payout_failed:2:paid:-:-:-', 'transition: a terminal stage may move to another terminal stage');
select throws_ok($$select public.fn_transition_payout_release_stage(pg_temp.mu(16), 'awaiting_connected_balance', 1)$$,
  'P0001', 'STAGE_TRANSITION_BLOCKED', 'transition: action_required never goes back to a pre-payout stage');
select is(pg_temp.call($$select public.fn_transition_payout_release_stage(pg_temp.mu(16), 'payout_canceled', 1)$$, 16),
  '2|payout_canceled:2:reconciliation_needed:-:-:-', 'transition: action_required may move to a terminal stage');

-- 3. fn_begin_payout_create_fence (the executor) -------------------------------
-- Its refusals and grant are in payout_claims.test.sql; here, the claim it keeps
-- and the replay at the new version.
select is(pg_temp.call($$select public.fn_begin_payout_create_fence(pg_temp.mu(20), 'tok-20', 2)$$, 20),
  '3|payout_create_in_progress:3:pending_reconciliation:-:tok-20:lease',
  'begin fence: the fence opens and the worker keeps its claim for the Stripe call');
select throws_ok($$select public.fn_begin_payout_create_fence(pg_temp.mu(20), 'tok-20', 3)$$,
  'P0001', 'PAYOUT_CREATE_FENCE_CONFLICT', 'begin fence: an open fence is never opened again');
select is(pg_temp.rs(20), 'payout_create_in_progress:3:pending_reconciliation:-:tok-20:lease',
  'begin fence: the replays left run 20 unchanged');

-- 4. fn_begin_manual_payout_create_fence (the admin release path) ---------------
select is(
  (select string_agg(pg_temp.call(format('select public.fn_begin_manual_payout_create_fence(%L)', pg_temp.mu(n)), n), ' ' order by n)
   from unnest(array[30, 31, 32, 33]) as n),
  '2|payout_create_in_progress:2:pending_reconciliation:-:-:- 2|payout_create_in_progress:2:pending_reconciliation:-:-:- '
  || '2|payout_create_in_progress:2:pending_reconciliation:-:-:- 2|payout_create_in_progress:2:pending_reconciliation:-:-:-',
  'manual fence: release_accepted, transfer_created, awaiting_connected_balance and no stage open the fence');
select is(
  (select count(*) from public.connect_payout_runs
   where id in (pg_temp.mu(30), pg_temp.mu(31), pg_temp.mu(32), pg_temp.mu(33))
     and payout_create_attempted_at = now()),
  4::bigint, 'manual fence: each run records the create attempt');
select throws_ok($$select public.fn_begin_manual_payout_create_fence(pg_temp.mu(34))$$,
  'P0001', 'PAYOUT_CREATE_FENCE_CONFLICT', 'manual fence: an open fence is reconciled, never created over');
select throws_ok($$select public.fn_begin_manual_payout_create_fence(pg_temp.mu(35))$$,
  'P0001', 'PAYOUT_CREATE_FENCE_CONFLICT', 'manual fence: a ready run cannot open the fence');
select throws_ok($$select public.fn_begin_manual_payout_create_fence(pg_temp.mu(36))$$,
  'P0001', 'EXECUTOR_CLAIM_HELD', 'manual fence: a live executor claim is refused');
select throws_ok($$select public.fn_begin_manual_payout_create_fence(pg_temp.mu(37))$$,
  'P0001', 'EXECUTOR_CLAIM_HELD', 'manual fence: a lapsed executor claim is refused too');
select throws_ok($$select public.fn_begin_manual_payout_create_fence(pg_temp.mu(99))$$,
  'P0001', 'PAYOUT_RUN_NOT_FOUND', 'manual fence: an unknown run is refused');
select is(
  (select string_agg(pg_temp.rs(n), ' ' order by n) from unnest(array[34, 35, 36, 37]) as n),
  'payout_create_in_progress:1:pending_reconciliation:-:-:- ready:1:pending_reconciliation:-:-:- '
  || 'awaiting_connected_balance:1:pending_reconciliation:-:tok-36:lease awaiting_connected_balance:1:pending_reconciliation:-:tok-37:lease',
  'manual fence: the refused runs are unchanged');

-- 5. fn_complete_payout_create_fence --------------------------------------------
select throws_ok($$select public.fn_complete_payout_create_fence(pg_temp.mu(40), 3, null)$$,
  'P0001', 'MISSING_STRIPE_PAYOUT_ID', 'complete: a NULL payout id is refused');
select throws_ok($$select public.fn_complete_payout_create_fence(pg_temp.mu(40), 3, '  ')$$,
  'P0001', 'MISSING_STRIPE_PAYOUT_ID', 'complete: a blank payout id is refused');
select is(pg_temp.call($$select public.fn_complete_payout_create_fence(pg_temp.mu(40), 3, 'po_40')$$, 40),
  'true|payout_pending:4:pending_reconciliation:po_40:-:-', 'complete: the manual path (no token) records the payout and moves to payout_pending');
select is(pg_temp.call($$select public.fn_complete_payout_create_fence(pg_temp.mu(40), 3, 'po_40')$$, 40),
  'false|payout_pending:4:pending_reconciliation:po_40:-:-', 'complete: a replay with the old version changes nothing');
select is(pg_temp.call($$select public.fn_complete_payout_create_fence(pg_temp.mu(41), 3, 'po_41', 'tok-other')$$, 41),
  'false|payout_create_in_progress:3:pending_reconciliation:-:tok-41:lease', 'complete: another worker claim token changes nothing');
select is(pg_temp.call($$select public.fn_complete_payout_create_fence(pg_temp.mu(42), 3, 'po_42', 'tok-42')$$, 42),
  'false|payout_create_in_progress:3:pending_reconciliation:-:tok-42:lease', 'complete: the claim token with a lapsed lease changes nothing');
select is(pg_temp.call($$select public.fn_complete_payout_create_fence(pg_temp.mu(41), 3, 'po_41', 'tok-41')$$, 41),
  'true|payout_pending:4:pending_reconciliation:po_41:-:-', 'complete: the claim holder completes and the claim is cleared');
select is(pg_temp.call($$select public.fn_complete_payout_create_fence(pg_temp.mu(43), 5, 'po_other')$$, 43),
  'true|payout_in_transit:6:pending_reconciliation:po_43:-:-', 'complete: payout_in_transit and the recorded payout id never go back');
select is(pg_temp.call($$select public.fn_complete_payout_create_fence(pg_temp.mu(44), 5, 'po_44')$$, 44),
  'true|paid_observed:6:paid:po_44:-:-', 'complete: a terminal stage projected by the webhook stays');
select is(pg_temp.call($$select public.fn_complete_payout_create_fence(pg_temp.mu(45), 1, 'po_45')$$, 45),
  'false|awaiting_connected_balance:1:pending_reconciliation:-:-:-', 'complete: a run without an open fence changes nothing');

-- 6. fn_fail_payout_create_from_fence -------------------------------------------
select is(pg_temp.call($$select public.fn_fail_payout_create_from_fence(pg_temp.mu(50), 3, 'card_declined')$$, 50),
  'true|payout_failed:4:failed:-:-:-', 'fail: the manual path (no token) fails the run');
select is(
  (select r.failure_reason || ':' || (r.failed_at = now())::text || ':' || m.status
   from public.connect_payout_runs r join public.connect_payout_run_shipments m on m.run_id = r.id
   where r.id = pg_temp.mu(50)),
  'card_declined:true:failed', 'fail: the reason and failed_at are recorded and the mapping fails with the run');
select is(pg_temp.call($$select public.fn_fail_payout_create_from_fence(pg_temp.mu(50), 3, 'card_declined')$$, 50),
  'false|payout_failed:4:failed:-:-:-', 'fail: a replay with the old version changes nothing');
select is(pg_temp.call($$select public.fn_fail_payout_create_from_fence(pg_temp.mu(51), 3, 'card_declined')$$, 51),
  'false|payout_create_in_progress:3:pending_reconciliation:po_51:-:-', 'fail: a run with a Stripe payout id is never failed from the fence');
select is(pg_temp.call($$select public.fn_fail_payout_create_from_fence(pg_temp.mu(52), 3, 'card_declined', 'tok-other')$$, 52),
  'false|payout_create_in_progress:3:pending_reconciliation:-:tok-52:lease', 'fail: another worker claim token changes nothing');
select is(pg_temp.call($$select public.fn_fail_payout_create_from_fence(pg_temp.mu(53), 3, 'card_declined', 'tok-53')$$, 53),
  'false|payout_create_in_progress:3:pending_reconciliation:-:tok-53:lease', 'fail: the claim token with a lapsed lease changes nothing');
select is(pg_temp.call($$select public.fn_fail_payout_create_from_fence(pg_temp.mu(52), 2, 'card_declined', 'tok-52')$$, 52),
  'false|payout_create_in_progress:3:pending_reconciliation:-:tok-52:lease', 'fail: a stale stage version changes nothing');
select is(pg_temp.call($$select public.fn_fail_payout_create_from_fence(pg_temp.mu(52), 3, 'card_declined', 'tok-52')$$, 52),
  'true|payout_failed:4:failed:-:-:-', 'fail: the claim holder fails the run and the claim is cleared');
select is(pg_temp.call($$select public.fn_fail_payout_create_from_fence(pg_temp.mu(54), 3, 'card_declined')$$, 54),
  'false|awaiting_connected_balance:3:pending_reconciliation:-:-:-', 'fail: a run without an open fence changes nothing');

-- 7. fn_abort_payout_create_to_action_required ----------------------------------
select is(pg_temp.call($$select public.fn_abort_payout_create_to_action_required(pg_temp.mu(60), 3, 'timeout')$$, 60),
  'true|action_required:4:reconciliation_needed:-:-:-', 'abort: the manual path (no token) parks the run in action_required');
select is(
  (select r.action_required_reason || ':' || r.failure_reason || ':' || m.status
   from public.connect_payout_runs r join public.connect_payout_run_shipments m on m.run_id = r.id
   where r.id = pg_temp.mu(60)),
  'payout_create_outcome_unresolved:timeout:reconciliation_needed', 'abort: the reasons are recorded and the mapping waits for reconciliation');
select is(pg_temp.call($$select public.fn_abort_payout_create_to_action_required(pg_temp.mu(60), 3, 'timeout')$$, 60),
  'false|action_required:4:reconciliation_needed:-:-:-', 'abort: a replay with the old version changes nothing');
select is(pg_temp.call($$select public.fn_abort_payout_create_to_action_required(pg_temp.mu(61), 3, 'timeout', 'tok-other')$$, 61),
  'false|payout_create_in_progress:3:pending_reconciliation:-:tok-61:lease', 'abort: another worker claim token changes nothing');
select is(pg_temp.call($$select public.fn_abort_payout_create_to_action_required(pg_temp.mu(62), 3, 'timeout', 'tok-62')$$, 62),
  'false|payout_create_in_progress:3:pending_reconciliation:-:tok-62:lease', 'abort: the claim token with a lapsed lease changes nothing');
select is(pg_temp.call($$select public.fn_abort_payout_create_to_action_required(pg_temp.mu(61), 2, 'timeout', 'tok-61')$$, 61),
  'false|payout_create_in_progress:3:pending_reconciliation:-:tok-61:lease', 'abort: a stale stage version changes nothing');
select is(pg_temp.call($$select public.fn_abort_payout_create_to_action_required(pg_temp.mu(61), 3, 'timeout', 'tok-61')$$, 61),
  'true|action_required:4:reconciliation_needed:-:-:-', 'abort: the claim holder parks the run and the claim is cleared');
select is(pg_temp.call($$select public.fn_abort_payout_create_to_action_required(pg_temp.mu(63), 3, 'timeout')$$, 63),
  'false|payout_pending:3:pending_reconciliation:po_63:-:-', 'abort: a run without an open fence changes nothing');

-- 8. Execute grants: service_role only -------------------------------------------
select is(pg_temp.exec_roles('public.fn_transition_payout_release_stage(uuid,text,integer,text,text)'),
  'service_role', 'only service_role may execute fn_transition_payout_release_stage');
select is(pg_temp.exec_roles('public.fn_begin_manual_payout_create_fence(uuid)'),
  'service_role', 'only service_role may execute fn_begin_manual_payout_create_fence');
select is(pg_temp.exec_roles('public.fn_complete_payout_create_fence(uuid,integer,text,text)'),
  'service_role', 'only service_role may execute fn_complete_payout_create_fence');
select is(pg_temp.exec_roles('public.fn_fail_payout_create_from_fence(uuid,integer,text,text)'),
  'service_role', 'only service_role may execute fn_fail_payout_create_from_fence');
select is(pg_temp.exec_roles('public.fn_abort_payout_create_to_action_required(uuid,integer,text,text)'),
  'service_role', 'only service_role may execute fn_abort_payout_create_to_action_required');

select * from finish();
rollback;
