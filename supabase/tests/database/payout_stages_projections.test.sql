-- The webhook projections of a payout run (#275 T5, part 2 of 3):
-- fn_project_payout_run_stage (payout.created / payout.updated progress) and
-- fn_project_payout_run_terminal (payout.paid / failed / canceled). Both lock
-- the run by run id and payout id, replay a complete projection without writes,
-- never move progress backwards, and clear the executor claim when they write.
-- The terminal projection writes the run, its mappings and the shipment payout
-- ids as one unit. Stage and fence writes: payout_stages_fences.test.sql; parks:
-- payout_stages_parks.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(37);
\ir ../fixtures/money.psql

create function pg_temp.t(p_hours integer) returns timestamptz language sql as $$
  select '2026-01-01 00:00:00+00'::timestamptz + p_hours * interval '1 hour'
$$;

-- Run p_run of seller 1 over p_shipments shipments of its own (p_run * 10 + k,
-- order 5000 + p_run * 10 + k), with the given fence columns. A 'paid' run is a
-- complete projection (paid_at t(0), shipments carry p_payout); a 'failed' run
-- has failed_at t(0). p_lease NULL leaves no claim lease.
create function pg_temp.run(
  p_run integer, p_stage text, p_version integer default 1, p_token text default null,
  p_lease interval default null, p_status text default 'pending_reconciliation',
  p_payout text default null, p_shipments integer default 1
) returns uuid language plpgsql as $$
declare v_ships integer[] := '{}';
begin
  for k in 1..p_shipments loop
    perform pg_temp.money_shipment(5000 + p_run * 10 + k, p_run * 10 + k, 1, 2);
    v_ships := v_ships || (p_run * 10 + k);
  end loop;
  perform pg_temp.money_payout_run(p_run, 1, 3, v_ships, p_status, p_stage);
  update public.connect_payout_runs
  set release_stage_version = p_version, payout_claim_token = p_token,
    payout_claim_expires_at = now() + p_lease, stripe_payout_id = p_payout,
    paid_at = case when p_status = 'paid' then pg_temp.t(0) end,
    failed_at = case when p_status = 'failed' then pg_temp.t(0) end
  where id = pg_temp.mu(p_run);
  if p_status = 'paid' then
    update public.shipments set stripe_payout_id = p_payout
    where id in (select pg_temp.mu(n) from unnest(v_ships) as n);
  end if;
  return pg_temp.mu(p_run);
end $$;

-- stage:version:status:payout id:claim token:lease
create function pg_temp.rs(p_run integer) returns text language sql as $$
  select concat_ws(':', coalesce(release_stage, '-'), release_stage_version, status,
    coalesce(stripe_payout_id, '-'), coalesce(payout_claim_token, '-'),
    case when payout_claim_expires_at is null then '-' else 'lease' end)
  from public.connect_payout_runs where id = pg_temp.mu(p_run)
$$;

-- Each mapping of p_run as shipment payout id/mapping status.
create function pg_temp.sp(p_run integer) returns text language sql as $$
  select string_agg(coalesce(s.stripe_payout_id, '-') || '/' || m.status, ' ' order by s.id)
  from public.connect_payout_run_shipments m join public.shipments s on s.id = m.shipment_id
  where m.run_id = pg_temp.mu(p_run)
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
select pg_temp.run(10, 'payout_create_in_progress', 3, 'tok-10', interval '5 minutes', p_payout => 'po_10');
select pg_temp.run(11, 'payout_in_transit', 2, 'tok-11', interval '5 minutes', p_payout => 'po_11');
select pg_temp.run(12, 'action_required', 2, p_status => 'reconciliation_needed', p_payout => 'po_12');
select pg_temp.run(13, 'payout_failed', 2, p_status => 'failed', p_payout => 'po_13');
select pg_temp.run(14, 'paid_observed', 2, p_status => 'paid', p_payout => 'po_14');
select pg_temp.run(15, 'paid_observed', 2, p_status => 'paid', p_payout => 'po_15');
update public.shipments set stripe_payout_id = null where id = pg_temp.mu(151);
select pg_temp.run(16, 'paid_observed', 2, 'tok-16', interval '5 minutes', 'paid', 'po_16');
select pg_temp.run(20, 'payout_in_transit', 2, 'tok-20', interval '5 minutes', p_payout => 'po_20', p_shipments => 2);
select pg_temp.run(21, 'paid_observed', 2, p_status => 'paid', p_payout => 'po_21');
update public.shipments set stripe_payout_id = null where id = pg_temp.mu(211);
select pg_temp.run(22, 'payout_failed', 2, p_status => 'failed', p_payout => 'po_22');
update public.shipments set stripe_payout_id = 'po_22' where id = pg_temp.mu(221);
select pg_temp.run(23, 'payout_pending', 2, p_payout => 'po_23');
update public.shipments set stripe_payout_id = 'po_other' where id = pg_temp.mu(231);
select pg_temp.run(25, 'payout_pending', 2, p_payout => 'po_25');
update public.connect_payout_run_shipments set status = 'reconciliation_needed' where run_id = pg_temp.mu(25);
select pg_temp.run(26, 'payout_pending', 2, p_payout => 'po_26', p_shipments => 0);
select pg_temp.run(27, 'payout_in_transit', 2, p_payout => 'po_27');

-- The webhook Edge Function calls these RPCs with the service role.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

-- 1. fn_project_payout_run_stage -----------------------------------------------
select throws_ok($$select public.fn_project_payout_run_stage(pg_temp.mu(10), 'po_10', 'paid_observed')$$,
  'P0001', 'UNSUPPORTED_PROGRESS_STAGE', 'stage: only payout_pending and payout_in_transit are progress stages');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(10), 'po_other', 'payout_pending')$$, 10),
  'false|payout_create_in_progress:3:pending_reconciliation:po_10:tok-10:lease', 'stage: another payout id changes nothing');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(10), 'po_10', 'payout_pending')$$, 10),
  'true|payout_pending:4:pending_reconciliation:po_10:-:-', 'stage: payout.created moves the fence to payout_pending and clears the claim');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(10), 'po_10', 'payout_pending')$$, 10),
  'true|payout_pending:4:pending_reconciliation:po_10:-:-', 'stage: a replay of the same stage is a no-op that keeps the version');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(10), 'po_10', 'payout_in_transit')$$, 10),
  'true|payout_in_transit:5:pending_reconciliation:po_10:-:-', 'stage: payout_pending moves to payout_in_transit');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(10), 'po_10', 'payout_pending')$$, 10),
  'true|payout_in_transit:5:pending_reconciliation:po_10:-:-', 'stage: a late payout_pending never moves payout_in_transit back');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(11), 'po_11', 'payout_pending')$$, 11),
  'false|payout_in_transit:2:pending_reconciliation:po_11:tok-11:lease', 'stage: a late payout_pending on a claimed run is left to the park decision');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(12), 'po_12', 'payout_pending')$$, 12),
  'false|action_required:2:reconciliation_needed:po_12:-:-', 'stage: an action_required run is not moved');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(13), 'po_13', 'payout_in_transit')$$, 13),
  'false|payout_failed:2:failed:po_13:-:-', 'stage: a failed run is not moved');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(14), 'po_14', 'payout_in_transit')$$, 14),
  'true|paid_observed:2:paid:po_14:-:-', 'stage: late progress on a complete paid run is accepted without writes');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(15), 'po_15', 'payout_in_transit')$$, 15),
  'false|paid_observed:2:paid:po_15:-:-', 'stage: late progress on a paid run with a shipment missing the payout id is refused');
select is(pg_temp.call($$select public.fn_project_payout_run_stage(pg_temp.mu(16), 'po_16', 'payout_in_transit')$$, 16),
  'false|paid_observed:2:paid:po_16:tok-16:lease', 'stage: late progress on a paid run that still holds a claim is refused');

-- 2. fn_project_payout_run_terminal --------------------------------------------
select throws_ok($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), 'po_20', 'pending', pg_temp.t(1))$$,
  'P0001', 'UNSUPPORTED_TERMINAL_STATUS', 'terminal: only paid, failed and canceled are terminal');
select throws_ok($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), null, 'paid', pg_temp.t(1))$$,
  'P0001', 'MISSING_STRIPE_PAYOUT_ID', 'terminal: a NULL payout id is refused');
select throws_ok($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), ' ', 'paid', pg_temp.t(1))$$,
  'P0001', 'MISSING_STRIPE_PAYOUT_ID', 'terminal: a blank payout id is refused');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), 'po_other', 'paid', pg_temp.t(1))$$, 20),
  'false|payout_in_transit:2:pending_reconciliation:po_20:tok-20:lease', 'terminal: another payout id changes nothing');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), 'po_20', 'paid', pg_temp.t(1))$$, 20),
  'true|paid_observed:3:paid:po_20:-:-', 'terminal: payout.paid marks the run paid and clears the claim');
select is(
  (select (paid_at = pg_temp.t(1))::text from public.connect_payout_runs where id = pg_temp.mu(20)) || ' ' || pg_temp.sp(20),
  'true po_20/paid po_20/paid', 'terminal: paid_at is recorded and every mapping and shipment is released to the payout');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), 'po_20', 'paid', pg_temp.t(1))$$, 20),
  'true|paid_observed:3:paid:po_20:-:-', 'terminal: a replay of a complete paid projection writes nothing');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(21), 'po_21', 'paid', pg_temp.t(1))$$, 21),
  'false|paid_observed:2:paid:po_21:-:-', 'terminal: a paid replay on a run with a shipment missing the payout id is refused');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), 'po_20', 'failed', pg_temp.t(0))$$, 20),
  'false|paid_observed:3:paid:po_20:-:-', 'terminal: a failure older than paid_at never downgrades the run');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), 'po_20', 'failed', null)$$, 20),
  'false|paid_observed:3:paid:po_20:-:-', 'terminal: an undated failure never downgrades a paid run');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), 'po_20', 'failed', pg_temp.t(2), 'account_closed')$$, 20),
  'true|payout_failed:4:failed:po_20:-:-', 'terminal: a later failure downgrades a paid run');
select is(
  (select failure_reason || ' ' || (failed_at = pg_temp.t(2))::text || ' ' || (paid_at = pg_temp.t(1))::text
   from public.connect_payout_runs where id = pg_temp.mu(20)) || ' ' || pg_temp.sp(20),
  'account_closed true true -/failed -/failed', 'terminal: the failure is recorded and the shipments are no longer released');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), 'po_20', 'paid', pg_temp.t(3))$$, 20),
  'false|payout_failed:4:failed:po_20:-:-', 'terminal: a failed run never goes back to paid');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(20), 'po_20', 'failed', pg_temp.t(3), 'other')$$, 20),
  'true|payout_failed:4:failed:po_20:-:-', 'terminal: a replay of a complete failed projection writes nothing');
select is(
  (select failure_reason || ' ' || (failed_at = pg_temp.t(2))::text from public.connect_payout_runs where id = pg_temp.mu(20)),
  'account_closed true', 'terminal: the failed replay keeps the first failure reason and time');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(22), 'po_22', 'failed', pg_temp.t(1))$$, 22),
  'false|payout_failed:2:failed:po_22:-:-', 'terminal: a failed replay on a run with a shipment still released is refused');
select throws_ok($$select public.fn_project_payout_run_terminal(pg_temp.mu(23), 'po_23', 'paid', pg_temp.t(1))$$,
  'P0001', 'SHIPMENT_ALREADY_RELEASED:' || pg_temp.mu(231), 'terminal: a shipment released to another payout refuses the paid projection');
select is(pg_temp.rs(23) || ' ' || pg_temp.sp(23), 'payout_pending:2:pending_reconciliation:po_23:-:- po_other/pending_reconciliation',
  'terminal: the refused paid projection left the run, mapping and shipment unchanged');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(23), 'po_23', 'failed', pg_temp.t(1))$$, 23)
  || ' ' || pg_temp.sp(23), 'true|payout_failed:3:failed:po_23:-:- po_other/failed',
  'terminal: a failure clears only the failing payout id from the shipments');
select throws_ok($$select public.fn_project_payout_run_terminal(pg_temp.mu(25), 'po_25', 'paid', pg_temp.t(1))$$,
  'P0001', 'PAYOUT_MAPPING_INCOMPLETE', 'terminal: a mapping that cannot be marked paid refuses the paid projection');
select is(pg_temp.rs(25) || ' ' || pg_temp.sp(25), 'payout_pending:2:pending_reconciliation:po_25:-:- -/reconciliation_needed',
  'terminal: the incomplete paid projection left the run, mapping and shipment unchanged');
select throws_ok($$select public.fn_project_payout_run_terminal(pg_temp.mu(26), 'po_26', 'paid', pg_temp.t(1))$$,
  'P0001', 'PAYOUT_RUN_HAS_NO_SHIPMENTS', 'terminal: a run without shipments is never marked paid');
select is(pg_temp.call($$select public.fn_project_payout_run_terminal(pg_temp.mu(27), 'po_27', 'canceled', pg_temp.t(1))$$, 27)
  || ' ' || pg_temp.sp(27), 'true|payout_canceled:3:canceled:po_27:-:- -/canceled',
  'terminal: payout.canceled cancels the run and its mapping');

-- 3. Execute grants: service_role only -------------------------------------------
select is(pg_temp.exec_roles('public.fn_project_payout_run_stage(uuid,text,text)'),
  'service_role', 'only service_role may execute fn_project_payout_run_stage');
select is(pg_temp.exec_roles('public.fn_project_payout_run_terminal(uuid,text,text,timestamptz,text)'),
  'service_role', 'only service_role may execute fn_project_payout_run_terminal');

select * from finish();
rollback;
