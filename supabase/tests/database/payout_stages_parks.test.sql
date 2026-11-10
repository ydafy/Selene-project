-- Parking a payout run for reconciliation (#275 T5, part 3 of 3):
-- fn_decide_rejected_payout_stage_park (what to do with progress the stage
-- projection refused), fn_mark_payout_run_reconciliation_needed and the manual
-- release fallback fn_mark_payout_run_sync_failed. A park moves the run to
-- reconciliation_needed, bumps the stage version once per new decision, clears
-- the executor claim and keeps the payout id and the terminal timestamps; an
-- exact repeat is a no-op. Stage and fence writes: payout_stages_fences.test.sql;
-- webhook projections: payout_stages_projections.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(27);
\ir ../fixtures/money.psql

create function pg_temp.t(p_hours integer) returns timestamptz language sql as $$
  select '2026-01-01 00:00:00+00'::timestamptz + p_hours * interval '1 hour'
$$;

-- Run p_run of seller 1 over its own shipment (p_run + 100, order p_run + 200),
-- with the given fence columns. A 'paid' run is a complete projection (paid_at
-- t(0), the shipment carries p_payout); a 'failed' run has failed_at t(0).
-- p_lease NULL leaves no claim lease.
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
    payout_claim_expires_at = now() + p_lease, stripe_payout_id = p_payout,
    paid_at = case when p_status = 'paid' then pg_temp.t(0) end,
    failed_at = case when p_status = 'failed' then pg_temp.t(0) end
  where id = pg_temp.mu(p_run);
  if p_status = 'paid' then
    update public.shipments set stripe_payout_id = p_payout where id = pg_temp.mu(p_run + 100);
  end if;
  return pg_temp.mu(p_run);
end $$;

-- stage:version:status:payout id:failure reason:claim token:lease
create function pg_temp.rs(p_run integer) returns text language sql as $$
  select concat_ws(':', coalesce(release_stage, '-'), release_stage_version, status,
    coalesce(stripe_payout_id, '-'), coalesce(failure_reason, '-'), coalesce(payout_claim_token, '-'),
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

-- The roles of anon, authenticated and service_role that may execute p_fn.
create function pg_temp.exec_roles(p_fn text) returns text language sql as $$
  select coalesce(string_agg(r, ',' order by r), '-')
  from unnest(array['anon', 'authenticated', 'service_role']) as r
  where has_function_privilege(r, p_fn, 'execute')
$$;

select pg_temp.money_user(1);
select pg_temp.money_user(2);
select pg_temp.money_user(3, 'admin');
select pg_temp.run(10, 'paid_observed', 2, p_status => 'paid', p_payout => 'po_10');
select pg_temp.run(11, 'payout_failed', 2, p_status => 'failed', p_payout => 'po_11');
select pg_temp.run(12, 'paid_observed', 2, p_status => 'paid', p_payout => 'po_12');
update public.shipments set stripe_payout_id = null where id = pg_temp.mu(112);
select pg_temp.run(13, 'payout_in_transit', 2, 'tok-13', interval '5 minutes', p_payout => 'po_13');
select pg_temp.run(14, 'payout_in_transit', 2, 'tok-14', interval '5 minutes', p_payout => 'po_14');
select pg_temp.run(20, 'payout_in_transit', 2, 'tok-20', interval '5 minutes', p_payout => 'po_20');
select pg_temp.run(21, 'paid_observed', 2, p_status => 'paid', p_payout => 'po_21');
select pg_temp.run(22, 'payout_failed', 2, p_status => 'failed', p_payout => 'po_22');
select pg_temp.run(30, 'payout_create_in_progress', 3, 'tok-30', interval '5 minutes');
select pg_temp.run(31, 'payout_create_in_progress', 3, p_payout => 'po_31');
select pg_temp.run(32, 'paid_observed', 2, p_status => 'paid', p_payout => 'po_32');
select pg_temp.run(33, 'payout_failed', 2, p_status => 'failed', p_payout => 'po_33');
select pg_temp.run(34, 'payout_canceled', 2, p_status => 'canceled', p_payout => 'po_34');

-- The Edge Functions call these RPCs with the service role.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

-- 1. fn_decide_rejected_payout_stage_park ---------------------------------------
select throws_ok($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(13), 'po_13', 'paid_observed', 'late')$$,
  'P0001', 'UNSUPPORTED_PROGRESS_STAGE', 'park decision: only progress stages are decided');
select throws_ok($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(13), ' ', 'payout_pending', 'late')$$,
  'P0001', 'MISSING_STRIPE_PAYOUT_ID', 'park decision: a blank payout id is refused');
select is(public.fn_decide_rejected_payout_stage_park(pg_temp.mu(99), 'po_99', 'payout_pending', 'late'),
  'identity_conflict', 'park decision: an unknown run is an identity conflict');
select is(pg_temp.call($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(10), 'po_10', 'payout_in_transit', 'late')$$, 10),
  'superseded_paid|paid_observed:2:paid:po_10:-:-:-', 'park decision: late progress on a complete paid run is evidence only');
select is(pg_temp.call($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(11), 'po_11', 'payout_in_transit', 'late')$$, 11),
  'superseded_failed|payout_failed:2:failed:po_11:-:-:-', 'park decision: late progress on a complete failed run is evidence only');
select is(pg_temp.call($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(12), 'po_12', 'payout_in_transit', 'late')$$, 12),
  'parked|action_required:3:reconciliation_needed:po_12:late:-:-', 'park decision: a paid run with a shipment missing the payout id is parked');
select is(pg_temp.call($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(13), 'po_other', 'payout_pending', 'late')$$, 13),
  'identity_conflict|action_required:3:reconciliation_needed:po_13:PAYOUT_STAGE_PAYOUT_ID_MISMATCH:-:-',
  'park decision: another payout id is flagged and the recorded payout id stays');
select is(pg_temp.call($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(13), 'po_other', 'payout_pending', 'late')$$, 13),
  'identity_conflict|action_required:3:reconciliation_needed:po_13:PAYOUT_STAGE_PAYOUT_ID_MISMATCH:-:-',
  'park decision: a repeated mismatch keeps the version');
select is(pg_temp.call($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(14), 'po_14', 'payout_pending', 'late')$$, 14),
  'parked|action_required:3:reconciliation_needed:po_14:late:-:-', 'park decision: refused progress parks the run and clears the claim');
select is(pg_temp.call($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(14), 'po_14', 'payout_pending', 'late')$$, 14),
  'parked|action_required:3:reconciliation_needed:po_14:late:-:-', 'park decision: an exact repeat keeps the version');
select is(pg_temp.call($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(14), 'po_14', 'payout_pending', null)$$, 14),
  'parked|action_required:3:reconciliation_needed:po_14:late:-:-', 'park decision: a repeat without a reason keeps the first reason and the version');
select is(pg_temp.call($$select public.fn_decide_rejected_payout_stage_park(pg_temp.mu(14), 'po_14', 'payout_pending', 'later')$$, 14),
  'parked|action_required:4:reconciliation_needed:po_14:later:-:-', 'park decision: a new reason is a new decision');

-- 2. fn_mark_payout_run_reconciliation_needed -----------------------------------
select is(pg_temp.call($$select public.fn_mark_payout_run_reconciliation_needed(pg_temp.mu(20), 'r1')$$, 20),
  'true|action_required:3:reconciliation_needed:po_20:r1:-:-', 'park: the run moves to action_required and the claim is cleared');
select is(pg_temp.call($$select public.fn_mark_payout_run_reconciliation_needed(pg_temp.mu(20), 'r1')$$, 20),
  'false|action_required:3:reconciliation_needed:po_20:r1:-:-', 'park: an exact repeat keeps the version');
select is(pg_temp.call($$select public.fn_mark_payout_run_reconciliation_needed(pg_temp.mu(20), null)$$, 20),
  'false|action_required:3:reconciliation_needed:po_20:r1:-:-', 'park: a repeat without a reason keeps the first reason');
select is(pg_temp.call($$select public.fn_mark_payout_run_reconciliation_needed(pg_temp.mu(20), 'r2')$$, 20),
  'true|action_required:4:reconciliation_needed:po_20:r2:-:-', 'park: a new reason is a new decision');
select is(pg_temp.call($$select public.fn_mark_payout_run_reconciliation_needed(pg_temp.mu(21), 'r1')$$, 21),
  'true|action_required:3:reconciliation_needed:po_21:r1:-:-', 'park: a paid run can be parked');
select is(pg_temp.call($$select public.fn_mark_payout_run_reconciliation_needed(pg_temp.mu(22), 'r1')$$, 22),
  'true|action_required:3:reconciliation_needed:po_22:r1:-:-', 'park: a failed run can be parked');
select is(
  (select string_agg(coalesce(paid_at::text, '-') || '/' || coalesce(failed_at::text, '-'), ' ' order by id)
   from public.connect_payout_runs where id in (pg_temp.mu(21), pg_temp.mu(22))),
  pg_temp.t(0)::text || '/- -/' || pg_temp.t(0)::text, 'park: paid_at and failed_at survive the park');

-- 3. fn_mark_payout_run_sync_failed (manual release fallback) --------------------
select is(pg_temp.call($$select public.fn_mark_payout_run_sync_failed(pg_temp.mu(30), 'po_30', 'sync')$$, 30),
  'true|payout_create_in_progress:4:reconciliation_needed:po_30:sync:-:-',
  'sync failed: the payout id is attached, the fence stage stays and the claim is cleared');
select is(pg_temp.call($$select public.fn_mark_payout_run_sync_failed(pg_temp.mu(30), 'po_30', 'sync')$$, 30),
  'false|payout_create_in_progress:4:reconciliation_needed:po_30:sync:-:-', 'sync failed: an exact repeat keeps the version');
select is(pg_temp.call($$select public.fn_mark_payout_run_sync_failed(pg_temp.mu(30), 'po_30', 'sync2')$$, 30),
  'true|payout_create_in_progress:5:reconciliation_needed:po_30:sync2:-:-', 'sync failed: a new reason is a new decision');
select is(pg_temp.call($$select public.fn_mark_payout_run_sync_failed(pg_temp.mu(31), 'po_other', 'sync')$$, 31),
  'true|payout_create_in_progress:4:reconciliation_needed:po_31:sync:-:-', 'sync failed: a recorded payout id is never replaced');
select is(
  (select string_agg(pg_temp.call(format('select public.fn_mark_payout_run_sync_failed(%L, %L, %L)',
     pg_temp.mu(n), 'po_' || n, 'sync'), n), ' ' order by n)
   from unnest(array[32, 33, 34]) as n),
  'false|paid_observed:2:paid:po_32:-:-:- false|payout_failed:2:failed:po_33:-:-:- '
  || 'false|payout_canceled:2:canceled:po_34:-:-:-',
  'sync failed: paid, failed and canceled runs are refused and unchanged');

-- 4. Execute grants: service_role only -------------------------------------------
select is(pg_temp.exec_roles('public.fn_decide_rejected_payout_stage_park(uuid,text,text,text)'),
  'service_role', 'only service_role may execute fn_decide_rejected_payout_stage_park');
select is(pg_temp.exec_roles('public.fn_mark_payout_run_reconciliation_needed(uuid,text)'),
  'service_role', 'only service_role may execute fn_mark_payout_run_reconciliation_needed');
select is(pg_temp.exec_roles('public.fn_mark_payout_run_sync_failed(uuid,text,text)'),
  'service_role', 'only service_role may execute fn_mark_payout_run_sync_failed');

select * from finish();
rollback;
