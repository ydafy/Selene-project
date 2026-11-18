-- RPC error paths (odd/tasks/table-cleanup.md T6b, S6d, #153): no RPC or
-- trigger error handler writes system_logs. An RPC that catches an unexpected
-- error and answers with a value records one internal.ops_failures row (the
-- function, the SQLSTATE, the ids and the raw message) and answers its generic
-- code, never the raw message. A function whose handler only logged and
-- re-raised has no handler now: the log row never survived the RAISE (#153),
-- and the caller still gets the same error. fn_confirm_shipment_delivery is
-- pinned in shipment_delivery_confirmation.test.sql, the NULL actor of the
-- _as_admin verdicts in shipment_disputes.test.sql. fn_release_shipment_funds
-- has no handler either: its unexpected errors reach the caller, and the
-- shipping timeout cron records them (shipment_funds_release.test.sql).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(31);
\ir ../fixtures/money.psql

-- 1. No handler writes system_logs -------------------------------------------------
select is_empty(
  $$select p.proname::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('fn_seller_initiate_return_label', 'fn_confirm_shipment_delivery', 'fn_cancel_shipment',
        'fn_mark_shipment_delivered', 'fn_mark_return_delivered', 'fn_buyer_submit_return_evidence',
        'fn_seller_submit_return_evidence', 'fn_resolve_dispute_to_buyer', 'fn_resolve_dispute_to_buyer_as_admin',
        'fn_resolve_dispute_to_seller', 'fn_resolve_dispute_to_seller_as_admin', 'fn_lock_dispute',
        'fn_unlock_dispute', 'fn_admin_update_user_status', 'fn_admin_toggle_verified_seller',
        'fn_trigger_review_changes', 'fn_release_shipment_funds')
      and p.prosrc ilike '%system_logs%'$$,
  'no RPC or trigger error handler in scope writes system_logs');
select is_empty(
  $$select p.proname::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('fn_lock_dispute', 'fn_unlock_dispute', 'fn_admin_update_user_status', 'fn_trigger_review_changes',
        'fn_release_shipment_funds')
      and p.prosrc ~* 'exception\s+when'$$,
  'the functions that only logged and re-raised, and fn_release_shipment_funds, have no exception handler');

-- Rows a source wrote in this transaction: code|context, oldest first.
create function pg_temp.failures(p_source text) returns text language sql as $$
  select coalesce(string_agg(f.code || '|' || f.context::text, ' / ' order by f.id), '-')
  from internal.ops_failures f where f.source = p_source and f.occurred_at = now()
$$;

create function pg_temp.fail() returns trigger language plpgsql as $$
begin
  raise exception 'TEST_RPC_FAILURE';
end $$;

-- Users: 17001 seller, 17002 buyer, 17003 admin.
select pg_temp.money_user(17001);
select pg_temp.money_user(17002);
select pg_temp.money_user(17003, 'admin');

-- Shipment n of order n + 100; dispute n + 200 on shipment n.
select pg_temp.money_shipment(17201, 17101, 17001, 17002, 'delivered');
select pg_temp.money_dispute(17301, 17101, 'waiting_return');
select pg_temp.money_shipment(17202, 17102, 17001, 17002, 'paid');
insert into public.shipment_cancellation_operations (shipment_id, order_id, source, actor_id, reason, claim_token,
    claim_expires_at, external_started_at, refund_request, refund_id, refund_status, refund_status_updated_at)
values (pg_temp.mu(17102), pg_temp.mu(17202), 'buyer', pg_temp.mu(17002), 'Changed my mind',
  'f0000000-0000-4000-8000-000000097102', now() - interval '1 day', now() - interval '1 day',
  jsonb_build_object('payment_intent', 'pi_test_17202', 'amount', 100000), 're_test_17102', 'succeeded', now());
select pg_temp.money_shipment(17203, 17103, 17001, 17002, 'shipped');
select pg_temp.money_shipment(17204, 17104, 17001, 17002, 'delivered');
select pg_temp.money_dispute(17304, 17104, 'waiting_return');
select pg_temp.money_shipment(17205, 17105, 17001, 17002, 'delivered');
select pg_temp.money_dispute(17305, 17105, 'waiting_return');
select pg_temp.money_shipment(17206, 17106, 17001, 17002, 'delivered');
select pg_temp.money_dispute(17306, 17106, 'return_delivered');
select pg_temp.money_shipment(17200 + n, 17100 + n, 17001, 17002, 'delivered') from generate_series(7, 10) n;
select pg_temp.money_dispute(17300 + n, 17100 + n) from generate_series(7, 10) n;

-- Each forced failure: a trigger that raises TEST_RPC_FAILURE on the row the RPC writes.
create trigger rpc_fail_shipments before update on public.shipments
  for each row when (new.id in ('f0000000-0000-4000-8000-000000017102'::uuid, 'f0000000-0000-4000-8000-000000017103'::uuid))
  execute function pg_temp.fail();
create trigger rpc_fail_disputes before update on public.disputes
  for each row when (new.id in (
    'f0000000-0000-4000-8000-000000017304'::uuid, 'f0000000-0000-4000-8000-000000017305'::uuid,
    'f0000000-0000-4000-8000-000000017306'::uuid, 'f0000000-0000-4000-8000-000000017307'::uuid,
    'f0000000-0000-4000-8000-000000017308'::uuid, 'f0000000-0000-4000-8000-000000017309'::uuid,
    'f0000000-0000-4000-8000-000000017310'::uuid))
  execute function pg_temp.fail();

-- 2. Rule A: one ops_failures row, a generic answer ---------------------------------
-- fn_seller_initiate_return_label writes nothing, so its read fails: the column
-- it reads is renamed for the call and renamed back.
alter table public.disputes rename column seller_id to seller_id_t6b;
create temp table r_initiate as
  select r.success || ':' || coalesce(r.error_message, '-') as r
  from public.fn_seller_initiate_return_label(pg_temp.mu(17301), pg_temp.mu(17001)) r;
alter table public.disputes rename column seller_id_t6b to seller_id;
select is((select r from r_initiate), 'false:INTERNAL_ERROR',
  'fn_seller_initiate_return_label: an unexpected error answers INTERNAL_ERROR, not the raw message');
select is(pg_temp.failures('fn_seller_initiate_return_label'),
  '42703|' || jsonb_build_object('dispute_id', pg_temp.mu(17301), 'error', 'column d.seller_id does not exist')::text,
  'fn_seller_initiate_return_label: records one failure with the SQLSTATE, the dispute and the message');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
create temp table r_cancel as
  select r.success || ':' || coalesce(r.error_message, '-') as r
  from public.fn_cancel_shipment(pg_temp.mu(17102), 'buyer', 'Changed my mind') r;
create temp table r_mark_shipment as
  select r.success || ':' || coalesce(r.error_message, '-') as r
  from public.fn_mark_shipment_delivered(pg_temp.mu(17103)) r;
create temp table r_mark_return as
  select r.success || ':' || coalesce(r.error_message, '-') as r
  from public.fn_mark_return_delivered(pg_temp.mu(17304)) r;
reset role;

select is((select r from r_cancel) || '|' || (select status::text from public.shipments where id = pg_temp.mu(17102)),
  'false:INTERNAL_SERVER_ERROR|paid',
  'fn_cancel_shipment: an unexpected error answers INTERNAL_SERVER_ERROR and the shipment stays paid');
select is(pg_temp.failures('fn_cancel_shipment'),
  'P0001|' || jsonb_build_object('shipment_id', pg_temp.mu(17102), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_cancel_shipment: records one failure with the SQLSTATE, the shipment and the message');
select is((select r from r_mark_shipment), 'false:INTERNAL_ERROR',
  'fn_mark_shipment_delivered: an unexpected error answers INTERNAL_ERROR, not the raw message');
select is(pg_temp.failures('fn_mark_shipment_delivered'),
  'P0001|' || jsonb_build_object('shipment_id', pg_temp.mu(17103), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_mark_shipment_delivered: records one failure with the SQLSTATE, the shipment and the message');
select is((select r from r_mark_return), 'false:INTERNAL_ERROR',
  'fn_mark_return_delivered: an unexpected error answers INTERNAL_ERROR, not the raw message');
select is(pg_temp.failures('fn_mark_return_delivered'),
  'P0001|' || jsonb_build_object('dispute_id', pg_temp.mu(17304), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_mark_return_delivered: records one failure with the SQLSTATE, the dispute and the message');

select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(17002), 'role', 'service_role')::text, true);
set local role service_role;
create temp table r_buyer_evidence as
  select r.success || ':' || coalesce(r.error_message, '-') as r
  from public.fn_buyer_submit_return_evidence(pg_temp.mu(17305),
    array['returns/' || pg_temp.mu(17205) || '/' || pg_temp.mu(17002) || '/box.jpg']) r;
reset role;
select is((select r from r_buyer_evidence), 'false:INTERNAL_ERROR',
  'fn_buyer_submit_return_evidence: an unexpected error answers INTERNAL_ERROR, not the raw message');
select is(pg_temp.failures('fn_buyer_submit_return_evidence'),
  'P0001|' || jsonb_build_object('dispute_id', pg_temp.mu(17305), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_buyer_submit_return_evidence: records one failure with the SQLSTATE, the dispute and the message');

select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(17001), 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table r_seller_evidence as
  select r.success || ':' || coalesce(r.error_message, '-') as r
  from public.fn_seller_submit_return_evidence(pg_temp.mu(17306),
    array['disputes/' || pg_temp.mu(17206) || '/' || pg_temp.mu(17001) || '/item.jpg'],
    'disputes/' || pg_temp.mu(17206) || '/' || pg_temp.mu(17001) || '/item.mp4') r;
reset role;
select is((select r from r_seller_evidence), 'false:EVIDENCE_SUBMISSION_FAILED',
  'fn_seller_submit_return_evidence: an unexpected error still answers EVIDENCE_SUBMISSION_FAILED');
select is(pg_temp.failures('fn_seller_submit_return_evidence'),
  'P0001|' || jsonb_build_object('dispute_id', pg_temp.mu(17306), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_seller_submit_return_evidence: records one failure with the SQLSTATE, the dispute and the message');

-- The verdicts: the JWT variants read the admin from the subject, the _as_admin ones take it.
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(17003), 'role', 'service_role')::text, true);
set local role service_role;
create temp table r_verdicts as
  select 'fn_resolve_dispute_to_buyer' as fn, 17307 as n, r.success || ':' || coalesce(r.error_message, '-') as r
  from public.fn_resolve_dispute_to_buyer(pg_temp.mu(17307), 'T6b note') r
  union all
  select 'fn_resolve_dispute_to_buyer_as_admin', 17308, r.success || ':' || coalesce(r.error_message, '-')
  from public.fn_resolve_dispute_to_buyer_as_admin(pg_temp.mu(17308), 'T6b note', pg_temp.mu(17003)) r
  union all
  select 'fn_resolve_dispute_to_seller', 17309, r.success || ':' || coalesce(r.error_message, '-')
  from public.fn_resolve_dispute_to_seller(pg_temp.mu(17309), 'T6b note') r
  union all
  select 'fn_resolve_dispute_to_seller_as_admin', 17310, r.success || ':' || coalesce(r.error_message, '-')
  from public.fn_resolve_dispute_to_seller_as_admin(pg_temp.mu(17310), 'T6b note', pg_temp.mu(17003)) r;
reset role;
select is((select r from r_verdicts where fn = 'fn_resolve_dispute_to_buyer'), 'false:INTERNAL_SERVER_ERROR',
  'fn_resolve_dispute_to_buyer: an unexpected error still answers INTERNAL_SERVER_ERROR');
select is(pg_temp.failures('fn_resolve_dispute_to_buyer'),
  'P0001|' || jsonb_build_object('dispute_id', pg_temp.mu(17307), 'admin_id', pg_temp.mu(17003), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_resolve_dispute_to_buyer: records one failure with the SQLSTATE, the dispute, the admin and the message');
select is((select r from r_verdicts where fn = 'fn_resolve_dispute_to_buyer_as_admin'), 'false:INTERNAL_SERVER_ERROR',
  'fn_resolve_dispute_to_buyer_as_admin: an unexpected error still answers INTERNAL_SERVER_ERROR');
select is(pg_temp.failures('fn_resolve_dispute_to_buyer_as_admin'),
  'P0001|' || jsonb_build_object('dispute_id', pg_temp.mu(17308), 'admin_id', pg_temp.mu(17003), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_resolve_dispute_to_buyer_as_admin: records one failure under its own name');
select is((select r from r_verdicts where fn = 'fn_resolve_dispute_to_seller'), 'false:INTERNAL_SERVER_ERROR',
  'fn_resolve_dispute_to_seller: an unexpected error still answers INTERNAL_SERVER_ERROR');
select is(pg_temp.failures('fn_resolve_dispute_to_seller'),
  'P0001|' || jsonb_build_object('dispute_id', pg_temp.mu(17309), 'admin_id', pg_temp.mu(17003), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_resolve_dispute_to_seller: records one failure with the SQLSTATE, the dispute, the admin and the message');
select is((select r from r_verdicts where fn = 'fn_resolve_dispute_to_seller_as_admin'), 'false:INTERNAL_SERVER_ERROR',
  'fn_resolve_dispute_to_seller_as_admin: an unexpected error still answers INTERNAL_SERVER_ERROR');
select is(pg_temp.failures('fn_resolve_dispute_to_seller_as_admin'),
  'P0001|' || jsonb_build_object('dispute_id', pg_temp.mu(17310), 'admin_id', pg_temp.mu(17003), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_resolve_dispute_to_seller_as_admin: records one failure under its own name');

drop trigger rpc_fail_shipments on public.shipments;
drop trigger rpc_fail_disputes on public.disputes;

-- fn_admin_toggle_verified_seller answers false for a refused caller and for an
-- unexpected error; only the error is a failure.
create trigger rpc_fail_profiles before update on public.profiles
  for each row when (new.id = 'f0000000-0000-4000-8000-000000017001'::uuid)
  execute function pg_temp.fail();
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(17002), 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table r_toggle_refused as
  select public.fn_admin_toggle_verified_seller(pg_temp.mu(17001), true) as r;
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(17003), 'role', 'authenticated')::text, true);
create temp table r_toggle as
  select public.fn_admin_toggle_verified_seller(pg_temp.mu(17001), true) as r;
reset role;
drop trigger rpc_fail_profiles on public.profiles;
select is((select r from r_toggle), false,
  'fn_admin_toggle_verified_seller: an unexpected error still answers false');
select is(pg_temp.failures('fn_admin_toggle_verified_seller'),
  'P0001|' || jsonb_build_object('target_id', pg_temp.mu(17001), 'admin_id', pg_temp.mu(17003), 'error', 'TEST_RPC_FAILURE')::text,
  'fn_admin_toggle_verified_seller: records one failure with the SQLSTATE, the target, the admin and the message');
select is((select r::text from r_toggle_refused) || '|'
    || (select count(*) from internal.ops_failures where source = 'fn_admin_toggle_verified_seller'
        and context ->> 'admin_id' = pg_temp.mu(17002)::text),
  'false|0', 'fn_admin_toggle_verified_seller: a caller who is not an admin still gets false and records no failure');

-- 3. Rule B: the same error, and no row anywhere ------------------------------------
-- A malformed JWT subject fails the first statement of each RPC.
select set_config('request.jwt.claims', '{"sub": "not-a-uuid", "role": "service_role"}', true);
set local role service_role;
select throws_ok(format('select * from public.fn_lock_dispute(%L)', pg_temp.mu(17307)), '22P02', null,
  'fn_lock_dispute: an unexpected error still reaches the caller');
select throws_ok(format('select public.fn_unlock_dispute(%L)', pg_temp.mu(17307)), '22P02', null,
  'fn_unlock_dispute: an unexpected error still reaches the caller');
reset role;

create trigger rpc_fail_profiles_private before update on public.profiles_private
  for each row when (new.id = 'f0000000-0000-4000-8000-000000017002'::uuid)
  execute function pg_temp.fail();
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(17003), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$select public.fn_admin_update_user_status(%L, 'suspended', 'T6b')$$, pg_temp.mu(17002)),
  'P0001', 'TEST_RPC_FAILURE', 'fn_admin_update_user_status: an unexpected error reaches the caller unchanged');
reset role;
drop trigger rpc_fail_profiles_private on public.profiles_private;

-- The review trigger fails only when the seller stats refresh raises; the real
-- refresh records its own failures and never raises, so a stand-in replaces it here.
create or replace function internal.fn_refresh_seller_stats(p_seller_id uuid) returns void
  language plpgsql as $$ begin raise exception 'TEST_RPC_FAILURE'; end $$;
select throws_ok(
  format($$insert into public.reviews (reviewer_id, seller_id, rating, shipment_id) values (%L, %L, 5, %L)$$,
    pg_temp.mu(17002), pg_temp.mu(17001), pg_temp.mu(17101)),
  'P0001', 'TEST_RPC_FAILURE', 'fn_trigger_review_changes: a failed refresh still fails the review write');
select is(
  (select count(*) from internal.ops_failures where occurred_at = now()
     and source in ('fn_lock_dispute', 'fn_unlock_dispute', 'fn_admin_update_user_status', 'fn_trigger_review_changes'))
  + (select count(*) from public.reviews where shipment_id = pg_temp.mu(17101)),
  0::bigint, 'the re-raised errors leave no failure row and no review');

-- 4. Nothing above wrote system_logs ------------------------------------------------
select is((select count(*) from public.system_logs where created_at = now()), 0::bigint,
  'no call in this file wrote a system_logs row');

select * from finish();
rollback;
