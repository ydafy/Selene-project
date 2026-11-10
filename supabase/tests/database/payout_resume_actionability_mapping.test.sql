-- fn_atomic_payout_resume_mapping (#275 T6): the server CAS that moves a
-- pre-payout run, and every shipment mapped to it, back to
-- awaiting_connected_balance before release-connect-payout resumes it. It
-- refuses (returns NULL and writes nothing) unless the run, its optional failed
-- parent and the complete mapping set agree; on success it bumps the stage
-- version, writes the run before its mappings, and never touches identity or
-- money columns. The account actionability projection is in
-- payout_resume_actionability_account.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(63);
\ir ../fixtures/money.psql

-- Runs and mappings of the two sellers, to prove a refused call wrote nothing.
create function pg_temp.fp() returns text language sql as $$
  select md5(
    coalesce((select string_agg(r::text, '|' order by r.id) from public.connect_payout_runs r
      where r.seller_id in (pg_temp.mu(6002), pg_temp.mu(6004))), '')
    || coalesce((select string_agg(m::text, '|' order by m.id) from public.connect_payout_run_shipments m
      join public.connect_payout_runs r on r.id = m.run_id
      where r.seller_id in (pg_temp.mu(6002), pg_temp.mu(6004))), ''))
$$;

-- The RPC with small-integer ids. A NULL element stays NULL; an empty list is '{}'.
create function pg_temp.resume(
  p_run integer, p_mode text, p_status text, p_stage text, p_version integer, p_ships integer[],
  p_parent integer default null, p_parent_version integer default null, p_parent_payout text default null
) returns integer language sql as $$
  select public.fn_atomic_payout_resume_mapping(
    pg_temp.mu(p_run), p_mode, p_status, p_stage, p_version,
    coalesce((select array_agg(pg_temp.mu(n) order by o) from unnest(p_ships) with ordinality as u(n, o)), '{}'),
    case when p_parent is not null then pg_temp.mu(p_parent) end, p_parent_version, p_parent_payout)
$$;

-- Runs p_setup, then p_call, and undoes both. 'applied <version>' when the call
-- returned a version, 'refused' when it returned NULL and wrote nothing,
-- 'error <message>' when it raised.
create function pg_temp.try(p_setup text, p_call text) returns text language plpgsql as $$
declare
  v_before text;
  v_result integer;
  v_outcome text;
begin
  begin
    execute p_setup;
    v_before := pg_temp.fp();
    execute p_call into v_result;
    v_outcome := case when v_result is not null then 'applied ' || v_result
      when pg_temp.fp() is distinct from v_before then 'refused after writing' else 'refused' end;
    raise exception using errcode = 'P0T06';
  exception
    when sqlstate 'P0T06' then return v_outcome;
    when others then return 'error ' || sqlerrm;
  end;
end $$;

-- The baseline call: run 6201 (pending_reconciliation, release_accepted, v1)
-- over shipments 6101 and 6102.
create function pg_temp.try_base(p_setup text) returns text language sql as $$
  select pg_temp.try(p_setup,
    $c$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'release_accepted', 1, array[6101, 6102])$c$)
$$;
-- The child call: run 6212 retries failed parent 6211 (v3, po_t6_parent).
create function pg_temp.try_child(p_setup text) returns text language sql as $$
  select pg_temp.try(p_setup,
    $c$select pg_temp.resume(6212, 'retry', 'pending_reconciliation', 'release_accepted', 1, array[6111], 6211, 3, 'po_t6_parent')$c$)
$$;

-- Every column except the ones a resume may write.
create function pg_temp.ident(p_run integer) returns jsonb language sql as $$
  select to_jsonb(r) - array['status', 'release_stage', 'release_stage_version', 'failure_reason', 'failed_at', 'updated_at']
    || jsonb_build_object('mappings', (select jsonb_agg(jsonb_build_array(m.shipment_id, m.net_payout) order by m.shipment_id)
      from public.connect_payout_run_shipments m where m.run_id = r.id))
  from public.connect_payout_runs r where r.id = pg_temp.mu(p_run)
$$;
create function pg_temp.run_state(p_run integer) returns text language sql as $$
  select status || ':' || coalesce(release_stage, '-') || ':' || release_stage_version
    || ':' || coalesce(failure_reason, '-') || ':' || coalesce(failed_at::text, '-')
    || ':' || (select string_agg(m.status, ',' order by m.shipment_id) from public.connect_payout_run_shipments m where m.run_id = r.id)
  from public.connect_payout_runs r where r.id = pg_temp.mu(p_run)
$$;

create function pg_temp.complete(p_n integer, p_transfer boolean default true) returns void language sql as $$
  update public.shipments set completed_at = now(),
    stripe_transfer_id = case when p_transfer then 'tr_t6_' || p_n end
  where id = pg_temp.mu(p_n)
$$;

-- 6001 admin, 6002 seller, 6003 buyer, 6004 another seller.
select pg_temp.money_user(6001, 'admin');
select pg_temp.money_user(6002);
select pg_temp.money_user(6003);
select pg_temp.money_user(6004);
select pg_temp.money_shipment(6051, s, 6002, 6003, 'completed') from unnest(array[6101, 6102, 6103]) as s;
select pg_temp.money_shipment(6052, 6111, 6002, 6003, 'completed');
select pg_temp.money_shipment(6053, 6121, 6002, 6003, 'completed');
select pg_temp.complete(s) from unnest(array[6101, 6102, 6103, 6111, 6121]) as s;
select pg_temp.money_payout_run(6201, 6002, 6001, array[6101, 6102], 'pending_reconciliation', 'release_accepted');
select pg_temp.money_payout_run(6211, 6002, 6001, array[6111], 'failed', 'payout_failed');
update public.connect_payout_runs set stripe_payout_id = 'po_t6_parent', release_stage_version = 3,
  failed_at = now(), failure_reason = 'insufficient_funds' where id = pg_temp.mu(6211);
select pg_temp.money_payout_run(6212, 6002, 6001, array[6111], 'pending_reconciliation', 'release_accepted');
update public.connect_payout_runs set retry_of_run_id = pg_temp.mu(6211) where id = pg_temp.mu(6212);
select pg_temp.money_payout_run(6221, 6002, 6001, array[6121], 'failed', null);
update public.connect_payout_runs set failed_at = now(), failure_reason = 'legacy_failure' where id = pg_temp.mu(6221);

-- 1. Grants -------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$select public.fn_atomic_payout_resume_mapping('f0000000-0000-4000-8000-000000006201', 'pending',
    'pending_reconciliation', 'release_accepted', 1, array['f0000000-0000-4000-8000-000000006101']::uuid[], null, null, null)$$,
  '42501', null, 'anon cannot execute fn_atomic_payout_resume_mapping');
select set_config('request.jwt.claims', '{"sub": "f0000000-0000-4000-8000-000000006002", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.fn_atomic_payout_resume_mapping('f0000000-0000-4000-8000-000000006201', 'pending',
    'pending_reconciliation', 'release_accepted', 1, array['f0000000-0000-4000-8000-000000006101']::uuid[], null, null, null)$$,
  '42501', null, 'authenticated cannot execute fn_atomic_payout_resume_mapping');
reset role;
select is_definer('public', 'fn_atomic_payout_resume_mapping',
  array['uuid', 'text', 'text', 'text', 'integer', 'uuid[]', 'uuid', 'integer', 'text'],
  'fn_atomic_payout_resume_mapping is SECURITY DEFINER');
select ok(
  (select 'search_path=public' = any(proconfig) from pg_proc where proname = 'fn_atomic_payout_resume_mapping'),
  'fn_atomic_payout_resume_mapping pins search_path to public');

-- 2. Refusals: each one changes one fact of a call that would apply -----------
select is(pg_temp.try_base('select 1'), 'applied 2', 'fixture: the baseline call would apply');

-- Inputs.
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6201, 'other', 'pending_reconciliation', 'release_accepted', 1, array[6101, 6102])$$),
  'refused', 'refuses a mode other than retry or pending');
select is(pg_temp.try('update public.connect_payout_runs set release_stage_version = 0 where id = pg_temp.mu(6201)',
  $$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'release_accepted', 0, array[6101, 6102])$$),
  'refused', 'refuses an expected version below 1, even when it matches');
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'release_accepted', 1, array[6101, null])$$),
  'refused', 'refuses a shipment list with a NULL id');
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'release_accepted', 1, array[6101, 6102], null, 3, null)$$),
  'refused', 'refuses parent evidence without a parent run');

-- Compare-and-set on the run.
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6201, 'pending', 'failed', 'release_accepted', 1, array[6101, 6102])$$),
  'refused', 'refuses a stale expected status');
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'awaiting_connected_balance', 1, array[6101, 6102])$$),
  'refused', 'refuses a stale expected stage');
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'release_accepted', 2, array[6101, 6102])$$),
  'refused', 'refuses a stale expected version');

-- A run that already has newer identity, a claim, a create fence or a result.
select is(pg_temp.try_base($$update public.connect_payout_runs set stripe_payout_id = 'po_t6' where id = pg_temp.mu(6201)$$),
  'refused', 'refuses a run with a Stripe payout');
select is(pg_temp.try_base($$update public.connect_payout_runs set payout_claim_token = 'tok' where id = pg_temp.mu(6201)$$),
  'refused', 'refuses a run with a claim token');
select is(pg_temp.try_base($$update public.connect_payout_runs set payout_claim_expires_at = now() + interval '1 hour' where id = pg_temp.mu(6201)$$),
  'refused', 'refuses a run with a claim lease');
select is(pg_temp.try_base('update public.connect_payout_runs set payout_create_attempted_at = now() where id = pg_temp.mu(6201)'),
  'refused', 'refuses a run past the payout create fence');
select is(pg_temp.try_base('update public.connect_payout_runs set paid_at = now() where id = pg_temp.mu(6201)'),
  'refused', 'refuses a paid run');
-- A parked run and a parent with a retry child are refused on purpose; #352
-- tracks the retry that the actionability fence leaves without a path.
select is(pg_temp.try_base($$update public.connect_payout_runs set action_required_reason = 'account_not_actionable' where id = pg_temp.mu(6201)$$),
  'refused', 'refuses a run with an action_required reason');
select is(pg_temp.try_base($$insert into public.connect_payout_runs (id, idempotency_key, seller_id, amount, status, actor_id, retry_of_run_id)
    values (pg_temp.mu(6290), 'test-run-6290', pg_temp.mu(6002), 0, 'failed', pg_temp.mu(6001), pg_temp.mu(6201))$$),
  'refused', 'refuses a run that already has a retry child');
select is(pg_temp.try_base($$select pg_temp.money_payout_run(6292, 6002, 6001, array[]::integer[], 'failed', 'payout_failed');
    update public.connect_payout_runs set retry_of_run_id = pg_temp.mu(6292) where id = pg_temp.mu(6201)$$),
  'refused', 'refuses a retry child called without its parent');

-- Only pre-payout states resume.
select is(pg_temp.try($$update public.connect_payout_runs set release_stage = 'transfer_created' where id = pg_temp.mu(6201)$$,
  $$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'transfer_created', 1, array[6101, 6102])$$),
  'refused', 'refuses a pending run in a stage other than release_accepted or awaiting_connected_balance');
select is(pg_temp.try_base('update public.connect_payout_runs set failed_at = now() where id = pg_temp.mu(6201)'),
  'refused', 'refuses a pending run with failed_at');
select is(pg_temp.try_base($$update public.connect_payout_runs set failure_reason = 'x' where id = pg_temp.mu(6201)$$),
  'refused', 'refuses a pending run with a failure reason');
select is(pg_temp.try(
  $$update public.connect_payout_runs set status = 'reconciliation_needed' where id = pg_temp.mu(6201);
    update public.connect_payout_run_shipments set status = 'reconciliation_needed' where run_id = pg_temp.mu(6201)$$,
  $$select pg_temp.resume(6201, 'pending', 'reconciliation_needed', 'release_accepted', 1, array[6101, 6102])$$),
  'refused', 'refuses a reconciliation_needed run');
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6221, 'pending', 'failed', null, 1, array[6121])$$),
  'refused', 'refuses a failed run in pending mode');
select is(pg_temp.try($$update public.connect_payout_runs set release_stage = 'payout_canceled' where id = pg_temp.mu(6221)$$,
  $$select pg_temp.resume(6221, 'retry', 'failed', 'payout_canceled', 1, array[6121])$$),
  'refused', 'refuses a failed run in a stage other than payout_failed');

-- The mapping set must be complete, consistent and exactly the run amount.
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'release_accepted', 1, array[6101, 6102, 6103])$$),
  'refused', 'refuses a list longer than the mapping');
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'release_accepted', 1, array[6101, 6103])$$),
  'refused', 'refuses a list naming a shipment the run does not map');
select is(pg_temp.try_base('update public.connect_payout_runs set amount = amount + 1 where id = pg_temp.mu(6201)'),
  'refused', 'refuses a run whose amount is not the sum of its mapped net_payout');
select is(pg_temp.try_base($$update public.connect_payout_run_shipments set status = 'reconciliation_needed'
    where run_id = pg_temp.mu(6201) and shipment_id = pg_temp.mu(6102)$$),
  'refused', 'refuses a mapping whose status differs from the run');
select is(pg_temp.try_base($$update public.connect_payout_run_shipments set net_payout = 0
    where run_id = pg_temp.mu(6201) and shipment_id = pg_temp.mu(6102);
    update public.connect_payout_runs set amount = 90000 where id = pg_temp.mu(6201)$$),
  'refused', 'refuses a mapping with a zero net_payout');
select is(pg_temp.try_base('update public.shipments set seller_id = pg_temp.mu(6004) where id = pg_temp.mu(6102)'),
  'refused', 'refuses a shipment of another seller');
select is(pg_temp.try_base($$update public.shipments set status = 'delivered' where id = pg_temp.mu(6102)$$),
  'refused', 'refuses a shipment that is not completed');
select is(pg_temp.try_base('update public.shipments set completed_at = null where id = pg_temp.mu(6102)'),
  'refused', 'refuses a completed shipment without completed_at');
select is(pg_temp.try_base('update public.shipments set stripe_transfer_id = null where id = pg_temp.mu(6102)'),
  'refused', 'pending mode refuses a shipment without a Stripe transfer');
select is(pg_temp.try('update public.shipments set stripe_transfer_id = null where id = pg_temp.mu(6102)',
  $$select pg_temp.resume(6201, 'retry', 'pending_reconciliation', 'release_accepted', 1, array[6101, 6102])$$),
  'applied 2', 'retry mode accepts a shipment without a Stripe transfer');
select is(pg_temp.try(
  $$select pg_temp.money_payout_run(6291, 6002, 6001, array[6121])$$,
  $$select pg_temp.resume(6221, 'retry', 'failed', null, 1, array[6121])$$),
  'refused', 'refuses a shipment another run holds active');

-- A child must agree with its failed parent's immutable history.
select is(pg_temp.try_child('select 1'), 'applied 2', 'fixture: the child call would apply');
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6212, 'retry', 'pending_reconciliation', 'release_accepted', 1, array[6111], 6211, 2, 'po_t6_parent')$$),
  'refused', 'refuses a stale parent version');
select is(pg_temp.try('select 1',
  $$select pg_temp.resume(6212, 'retry', 'pending_reconciliation', 'release_accepted', 1, array[6111], 6211, 3, 'po_other')$$),
  'refused', 'refuses a parent payout id that does not match');
select is(pg_temp.try_child($$update public.connect_payout_runs set status = 'canceled' where id = pg_temp.mu(6211)$$),
  'refused', 'refuses a parent that is not failed');
select is(pg_temp.try_child($$update public.connect_payout_runs set release_stage = 'payout_canceled' where id = pg_temp.mu(6211)$$),
  'refused', 'refuses a parent outside payout_failed');
select is(pg_temp.try_child($$update public.connect_payout_runs set payout_claim_token = 'tok' where id = pg_temp.mu(6211)$$),
  'refused', 'refuses a parent with a claim token');
select is(pg_temp.try_child($$update public.connect_payout_runs set payout_claim_expires_at = now() + interval '1 hour' where id = pg_temp.mu(6211)$$),
  'refused', 'refuses a parent with a claim lease');
select is(pg_temp.try_child('update public.connect_payout_runs set seller_id = pg_temp.mu(6004) where id = pg_temp.mu(6211)'),
  'refused', 'refuses a parent of another seller');
select is(pg_temp.try_child('update public.connect_payout_runs set amount = amount + 1 where id = pg_temp.mu(6211)'),
  'refused', 'refuses a parent with another amount');
select is(pg_temp.try_child($$update public.connect_payout_run_shipments set status = 'canceled' where run_id = pg_temp.mu(6211)$$),
  'refused', 'refuses a parent mapping that is not failed');
select is(pg_temp.try_child('update public.connect_payout_run_shipments set net_payout = net_payout + 1 where run_id = pg_temp.mu(6211)'),
  'refused', 'refuses a child mapping that differs from the parent mapping');

-- 3. A failing mapping write rolls back the run write --------------------------
create function pg_temp.fail_mapping() returns trigger language plpgsql as $$
begin
  raise exception 'T6_MAPPING_WRITE_FAILED';
end $$;
create trigger t6_fail_mapping before update on public.connect_payout_run_shipments
  for each row when (new.run_id = 'f0000000-0000-4000-8000-000000006201'::uuid)
  execute function pg_temp.fail_mapping();
select throws_ok(
  $$select pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'release_accepted', 1, array[6101, 6102])$$,
  'P0001', 'T6_MAPPING_WRITE_FAILED', 'a failing mapping write fails the call');
select is(pg_temp.run_state(6201), 'pending_reconciliation:release_accepted:1:-:-:pending_reconciliation,pending_reconciliation',
  'the failed call left the run unchanged');
drop trigger t6_fail_mapping on public.connect_payout_run_shipments;

-- 4. Applied resumes -------------------------------------------------------------
-- The run is written before its mappings: each mapping write sees the new version.
create table pg_temp.order_log (run_version integer);
create function pg_temp.log_run_version() returns trigger language plpgsql as $$
begin
  insert into pg_temp.order_log
  select release_stage_version from public.connect_payout_runs where id = new.run_id;
  return new;
end $$;
create trigger t6_order_log before update on public.connect_payout_run_shipments
  for each row when (new.run_id = 'f0000000-0000-4000-8000-000000006201'::uuid)
  execute function pg_temp.log_run_version();
create table pg_temp.before_call as
  select n, pg_temp.ident(n) as ident, to_jsonb(r) as full_row
  from unnest(array[6201, 6211, 6212, 6221]) as n
  join public.connect_payout_runs r on r.id = pg_temp.mu(n);

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  public.fn_atomic_payout_resume_mapping('f0000000-0000-4000-8000-000000006201', 'pending',
    'pending_reconciliation', 'release_accepted', 1,
    array['f0000000-0000-4000-8000-000000006101', 'f0000000-0000-4000-8000-000000006102']::uuid[], null, null, null),
  2, 'service_role resumes the run and gets the new stage version');
reset role;
drop trigger t6_order_log on public.connect_payout_run_shipments;
select is(pg_temp.run_state(6201),
  'pending_reconciliation:awaiting_connected_balance:2:-:-:pending_reconciliation,pending_reconciliation',
  'pending: the run and its mappings are pending_reconciliation in awaiting_connected_balance');
select is((select array_agg(run_version) from pg_temp.order_log), array[2, 2],
  'pending: the run is written before its mappings');
select is(pg_temp.ident(6201), (select ident from pg_temp.before_call where n = 6201),
  'pending: identity, claim, fence and money columns are unchanged');
select is(pg_temp.resume(6201, 'pending', 'pending_reconciliation', 'release_accepted', 1, array[6101, 6102]), null::integer,
  'pending: replaying the same call is refused');
select is(pg_temp.run_state(6201),
  'pending_reconciliation:awaiting_connected_balance:2:-:-:pending_reconciliation,pending_reconciliation',
  'pending: the replay changed nothing');

select is(pg_temp.resume(6212, 'retry', 'pending_reconciliation', 'release_accepted', 1, array[6111], 6211, 3, 'po_t6_parent'), 2,
  'child: the retry child resumes');
select is(pg_temp.run_state(6212), 'pending_reconciliation:awaiting_connected_balance:2:-:-:pending_reconciliation',
  'child: the child is pending_reconciliation in awaiting_connected_balance');
select is(pg_temp.ident(6212), (select ident from pg_temp.before_call where n = 6212),
  'child: identity, parent link and money columns are unchanged');
select is((select to_jsonb(r) from public.connect_payout_runs r where id = pg_temp.mu(6211)),
  (select full_row from pg_temp.before_call where n = 6211), 'child: the parent run is unchanged');
select is(pg_temp.run_state(6211), 'failed:payout_failed:3:insufficient_funds:' || now()::text || ':failed',
  'child: the parent mapping stays failed');

select is(pg_temp.resume(6221, 'retry', 'failed', null, 1, array[6121]), 2,
  'legacy: a failed run without a provider attempt resumes');
select is(pg_temp.run_state(6221), 'pending_reconciliation:awaiting_connected_balance:2:-:-:pending_reconciliation',
  'legacy: the run and its mapping are pending again and the failure is cleared');

select * from finish();
rollback;
