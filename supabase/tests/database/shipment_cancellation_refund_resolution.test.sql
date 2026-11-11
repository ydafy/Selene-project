-- Shipment cancellation refund resolution (#276 T3): fn_get_shipment_cancellation_recovery
-- reads a started operation for the recovery job; fn_escalate_shipment_cancellation
-- records once that recovery gave up; fn_resolve_shipment_cancellation_refund lets an
-- admin settle a failed or canceled refund, or an escalated operation with no refund,
-- with an audited reference and completes the cancellation when the shipment is open.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(55);
\ir ../fixtures/money.psql

-- Users: 64001 seller, 64002 buyer, 64003 admin, 64004 suspended admin, 64005 admin
-- with a NULL status.
select pg_temp.money_user(64001);
select pg_temp.money_user(64002);
select pg_temp.money_user(64003, 'admin');
select pg_temp.money_user(64004, 'admin');
select pg_temp.money_user(64005, 'admin');
update public.profiles_private set status = 'suspended' where id = pg_temp.mu(64004);
update public.profiles_private set status = null where id = pg_temp.mu(64005);

-- Claims shipment p_n for p_source with the real RPCs and, unless p_start is false,
-- starts its refund of 11000 cents with the frozen loss p_loss.
create function pg_temp.start_cancel(p_n integer, p_source text default 'buyer',
  p_loss bigint default 0, p_start boolean default true)
returns void language plpgsql as $$
declare
  v_ship public.shipments%rowtype;
  v_buyer uuid;
  v_claim jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
begin
  select * into v_ship from public.shipments where id = pg_temp.mu(p_n);
  select buyer_id into v_buyer from public.orders where id = v_ship.order_id;
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  v_claim := public.fn_claim_shipment_cancellation(v_ship.id, v_ship.order_id,
    case p_source when 'buyer' then v_buyer when 'seller' then v_ship.seller_id end,
    p_source, 'Changed my mind');
  if p_start then
    perform public.fn_start_shipment_cancellation_refund(v_ship.id, (v_claim->>'claim_token')::uuid,
      jsonb_build_object('payment_intent', v_ship.stripe_payment_intent_id, 'amount', 11000,
        'reason', 'requested_by_customer',
        'metadata', jsonb_build_object('shipment_id', v_ship.id::text, 'order_id', v_ship.order_id::text,
          'caller_role', case when p_source in ('buyer', 'seller') then p_source else 'system' end,
          'reason', 'Changed my mind', 'seguro_share_cents', 500)),
      p_loss);
  end if;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end $$;

-- The event RPC for shipment p_n with refund re_<p_n> and the shipment's payment intent.
create function pg_temp.apply(p_n integer, p_status text) returns jsonb language sql as $$
  select public.fn_apply_shipment_cancellation_refund_event(pg_temp.mu(p_n), 're_' || p_n,
    (select stripe_payment_intent_id from public.shipments where id = pg_temp.mu(p_n)), 11000, p_status, null)
$$;

-- The resolution RPC; an error comes back as ERR:<message> and its writes roll back.
create function pg_temp.resolve(p_n integer, p_admin integer, p_reference text default 'SPEI-123')
returns text language plpgsql as $$
begin
  return public.fn_resolve_shipment_cancellation_refund(pg_temp.mu(p_n), pg_temp.mu(p_admin), p_reference)::text;
exception when others then
  return 'ERR:' || sqlerrm;
end $$;

create function pg_temp.op(p_n integer) returns public.shipment_cancellation_operations language sql as $$
  select * from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(p_n)
$$;
create function pg_temp.audits(p_n integer) returns bigint language sql as $$
  select count(*) from public.admin_audit_logs where target_id = pg_temp.mu(p_n)
$$;

-- 1. Grants and security mode ------------------------------------------------------
select is(
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')
     || ':' || has_function_privilege('authenticated', p.oid, 'execute')
     || ':' || has_function_privilege('service_role', p.oid, 'execute'), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_get_shipment_cancellation_recovery', 'fn_escalate_shipment_cancellation',
       'fn_resolve_shipment_cancellation_refund')),
  'fn_escalate_shipment_cancellation:false:false:true fn_get_shipment_cancellation_recovery:false:false:true fn_resolve_shipment_cancellation_refund:false:false:true',
  'only service_role can execute the recovery read, the escalation and the resolution (anon, authenticated and PUBLIC cannot)');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_get_shipment_cancellation_recovery', 'fn_escalate_shipment_cancellation',
       'fn_resolve_shipment_cancellation_refund')),
  'fn_escalate_shipment_cancellation:true:v:search_path="" fn_get_shipment_cancellation_recovery:true:s:search_path="" fn_resolve_shipment_cancellation_refund:true:v:search_path=""',
  'the three RPCs are SECURITY DEFINER with an empty search_path, and the recovery read is STABLE');

select set_config('request.jwt.claims', '{"sub": "f0000000-0000-4000-8000-000000064003", "role": "authenticated"}', true);
select throws_ok($$select public.fn_resolve_shipment_cancellation_refund(gen_random_uuid(), null, 'x')$$, 'P0001', 'UNAUTHORIZED',
  'resolve: a caller without the service_role claim is refused by the body, before the admin check');
select throws_ok($$select public.fn_escalate_shipment_cancellation(gen_random_uuid(), 'refund_not_found')$$, 'P0001', 'UNAUTHORIZED',
  'escalate: a caller without the service_role claim is refused by the body');
select throws_ok($$select public.fn_get_shipment_cancellation_recovery(gen_random_uuid())$$, 'P0001', 'UNAUTHORIZED',
  'recovery read: a caller without the service_role claim is refused by the body');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 2. Recovery read ----------------------------------------------------------------
-- 64101 started by the buyer with a frozen loss of 120, 64102 no operation, 64103 claimed only.
select pg_temp.money_shipment(64151, 64101, 64001, 64002, 'paid');
select pg_temp.money_shipment(64152, 64102, 64001, 64002, 'paid');
select pg_temp.money_shipment(64153, 64103, 64001, 64002, 'paid');
select pg_temp.start_cancel(64101, 'buyer', 120);
select pg_temp.start_cancel(64103, 'buyer', 0, false);
create function pg_temp.recovery(p_n integer) returns jsonb language sql as $$
  select public.fn_get_shipment_cancellation_recovery(pg_temp.mu(p_n))
$$;

select is(coalesce(pg_temp.recovery(64102)::text, 'null') || '|' || coalesce(pg_temp.recovery(64103)::text, 'null'),
  'null|null', 'recovery read: a shipment without an operation and a claimed-only one read as NULL');
select is(pg_temp.recovery(64101) - 'external_started_at',
  jsonb_build_object('operation_key', 'cancel_shipment_' || pg_temp.mu(64101), 'order_id', pg_temp.mu(64151),
    'source', 'buyer', 'actor_id', pg_temp.mu(64002), 'reason', 'Changed my mind',
    'refund_request', (pg_temp.op(64101)).refund_request, 'cancellation_loss_cents', 120,
    'refund_id', null, 'refund_status', null, 'recovery_escalated_at', null),
  'recovery read: a started operation returns its winner, frozen request and loss');
select is((pg_temp.recovery(64101)->>'external_started_at')::timestamptz, (pg_temp.op(64101)).external_started_at,
  'recovery read: it returns when the external call started');
select pg_temp.apply(64101, 'pending');
select is((pg_temp.recovery(64101)->>'refund_id') || ':' || (pg_temp.recovery(64101)->>'refund_status'), 're_64101:pending',
  'recovery read: it reflects the recorded refund');

-- 3. Escalation -------------------------------------------------------------------
-- 64101 (pending refund) is escalated; 64104 is its started sibling.
select pg_temp.money_shipment(64151, 64104, 64001, 64002, 'paid');
select pg_temp.start_cancel(64104);
create function pg_temp.escalate(p_n integer, p_reason text) returns jsonb language sql as $$
  select public.fn_escalate_shipment_cancellation(pg_temp.mu(p_n), p_reason)
$$;
create table pg_temp.sibling_before as select * from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(64104);

select throws_ok($$select pg_temp.escalate(64199, 'refund_not_found')$$, 'P0001', 'SHIPMENT_NOT_FOUND',
  'escalate: an unknown shipment is SHIPMENT_NOT_FOUND');
select throws_ok($$select pg_temp.escalate(64102, 'refund_not_found')$$, 'P0001', 'CANCELLATION_NOT_STARTED',
  'escalate: a shipment without an operation is CANCELLATION_NOT_STARTED');
select throws_ok($$select pg_temp.escalate(64103, 'refund_not_found')$$, 'P0001', 'CANCELLATION_NOT_STARTED',
  'escalate: a claimed-only operation is CANCELLATION_NOT_STARTED');
select throws_ok($$select pg_temp.escalate(64101, 'refund_lost')$$, 'P0001', 'INVALID_ESCALATION_REASON',
  'escalate: an unknown reason is INVALID_ESCALATION_REASON');
select throws_ok($$select pg_temp.escalate(64101, null)$$, 'P0001', 'INVALID_ESCALATION_REASON',
  'escalate: a NULL reason is INVALID_ESCALATION_REASON');
select is(pg_temp.escalate(64101, 'refund_not_found'), '{"escalated": true}'::jsonb, 'escalate: the first call escalates');
select is((pg_temp.op(64101)).recovery_escalation_reason || ':' || ((pg_temp.op(64101)).recovery_escalated_at is not null),
  'refund_not_found:true', 'escalate: it records the reason and the time');
create table pg_temp.escalated_before as select * from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(64101);
select is(pg_temp.escalate(64101, 'refund_ambiguous'), '{"escalated": false}'::jsonb, 'escalate: a second call reports escalated false');
select is(
  (select count(*) from public.shipment_cancellation_operations o, pg_temp.escalated_before b
   where o.shipment_id = b.shipment_id and o::text = b::text),
  1::bigint, 'escalate: a second call keeps the first reason and time');
select is((pg_temp.recovery(64101)->>'recovery_escalated_at')::timestamptz, (pg_temp.op(64101)).recovery_escalated_at,
  'recovery read: it returns the escalation time');
select is(
  (pg_temp.op(64101)).refund_status || '|' || (select count(*) from public.shipment_cancellation_operations o, pg_temp.sibling_before b
    where o.shipment_id = b.shipment_id and o::text = b::text),
  'pending|1', 'escalate: it leaves the recorded refund and the sibling operation untouched');
select throws_ok(
  format('update public.shipment_cancellation_operations set recovery_escalated_at = now() where shipment_id = %L', pg_temp.mu(64104)),
  '23514', null, 'check: an escalation time without a reason is rejected');
select throws_ok(
  format('update public.shipment_cancellation_operations set recovery_escalated_at = now(), recovery_escalation_reason = %L where shipment_id = %L',
    'refund_lost', pg_temp.mu(64104)),
  '23514', null, 'check: an unknown escalation reason is rejected');

-- 4. Resolution CHECKs ------------------------------------------------------------
-- 64105 succeeded refund on an open shipment, 64106 failed refund.
select pg_temp.money_shipment(64155, 64105, 64001, 64002, 'paid');
select pg_temp.money_shipment(64156, 64106, 64001, 64002, 'paid');
select pg_temp.start_cancel(64105);
select pg_temp.start_cancel(64106);
select public.fn_record_shipment_cancellation_refund(pg_temp.mu(64105), 're_64105', 'pi_test_64155', 11000, 'succeeded');
select pg_temp.apply(64106, 'failed');
create function pg_temp.set_resolution(p_n integer, p_by uuid, p_reference text) returns text language sql as $$
  select format('update public.shipment_cancellation_operations set refund_resolved_at = now(), refund_resolved_by = %L, refund_resolution_reference = %L where shipment_id = %L',
    p_by, p_reference, pg_temp.mu(p_n))
$$;
select throws_ok(pg_temp.set_resolution(64105, pg_temp.mu(64003), 'SPEI-1'), '23514', null,
  'check: a succeeded refund cannot carry a resolution');
select throws_ok(pg_temp.set_resolution(64104, pg_temp.mu(64003), 'SPEI-1'), '23514', null,
  'check: an operation with no refund and no escalation cannot carry a resolution');
select throws_ok(pg_temp.set_resolution(64106, null, 'SPEI-1'), '23514', null,
  'check: a resolution without its admin is rejected');
select throws_ok(pg_temp.set_resolution(64106, pg_temp.mu(64003), ' SPEI-1'), '23514', null,
  'check: an untrimmed reference is rejected');
select throws_ok(pg_temp.set_resolution(64106, pg_temp.mu(64003), repeat('x', 201)), '23514', null,
  'check: a reference over 200 characters is rejected');

-- 5. fn_cancel_shipment accepts a resolved refund ------------------------------------
-- 64315: a failed refund resolved while the shipment is still open.
select pg_temp.money_shipment(64415, 64315, 64001, 64002, 'paid');
select pg_temp.start_cancel(64315);
select pg_temp.apply(64315, 'failed');
update public.shipment_cancellation_operations
  set refund_resolved_at = now(), refund_resolved_by = pg_temp.mu(64003), refund_resolution_reference = 'SPEI-9'
  where shipment_id = pg_temp.mu(64315);
select is(
  (select c.success::text || ':' || coalesce(c.error_message, '-') from public.fn_cancel_shipment(pg_temp.mu(64315), 'buyer', 'Changed my mind') c),
  'true:-', 'cancel: a failed refund an admin resolved lets the cancellation complete');

-- 6. fn_resolve_shipment_cancellation_refund --------------------------------------
-- 64301 failed before success (frozen loss 120, order fee 500); 64302 failed after
-- cancellation; 64303 canceled, timeout-sourced; 64304 pending; 64305 requires_action;
-- 64306 succeeded on an open shipment; 64307 no operation; 64308 claimed only; 64309
-- started without a refund; 64310 escalated without a refund; 64311 escalated with a
-- pending refund; 64312 escalated, then failed; 64313 failed, then shipped; 64314 failed,
-- its cancellation fails.
select pg_temp.money_shipment(64400 + n, 64300 + n, 64001, 64002, 'paid') from generate_series(1, 14) n;
update public.orders set actual_stripe_fee_cents = 500 where id = pg_temp.mu(64401);
select pg_temp.start_cancel(64301, 'buyer', 120);
select pg_temp.start_cancel(64300 + n) from generate_series(2, 14) n where n not in (3, 7, 8);
select pg_temp.start_cancel(64303, 'paid_timeout');
select pg_temp.start_cancel(64308, 'buyer', 0, false);
select pg_temp.apply(64301, 'failed');
select pg_temp.apply(64302, 'succeeded');
select pg_temp.apply(64302, 'failed');
select pg_temp.apply(64303, 'canceled');
select pg_temp.apply(64304, 'pending');
select pg_temp.apply(64305, 'requires_action');
select public.fn_record_shipment_cancellation_refund(pg_temp.mu(64306), 're_64306', 'pi_test_64406', 11000, 'succeeded');
select pg_temp.escalate(64310, 'refund_not_found');
select pg_temp.escalate(64311, 'refund_ambiguous');
select pg_temp.apply(64311, 'pending');
select pg_temp.escalate(64312, 'refund_ambiguous');
select pg_temp.apply(64312, 'failed');
select pg_temp.apply(64313, 'failed');
update public.shipments set status = 'shipped' where id = pg_temp.mu(64313);
select pg_temp.apply(64314, 'failed');

select is(pg_temp.resolve(64304, null) || ' ' || pg_temp.resolve(64304, 64002),
  'ERR:ADMIN_REQUIRED ERR:ADMIN_REQUIRED', 'resolve: a missing admin or a non-admin is ADMIN_REQUIRED, before the refund is checked');
select is(pg_temp.resolve(64304, 64004), 'ERR:ADMIN_REQUIRED', 'resolve: a suspended admin is ADMIN_REQUIRED');
select is(pg_temp.resolve(64304, 64003, '   ') || ' ' || pg_temp.resolve(64304, 64003, null),
  'ERR:INVALID_RESOLUTION_REFERENCE ERR:INVALID_RESOLUTION_REFERENCE',
  'resolve: a blank or NULL reference is INVALID_RESOLUTION_REFERENCE, before the refund is checked');
select is(pg_temp.resolve(64304, 64003, repeat('x', 201)), 'ERR:INVALID_RESOLUTION_REFERENCE',
  'resolve: a reference over 200 characters is INVALID_RESOLUTION_REFERENCE');
select is(pg_temp.resolve(64399, 64003), 'ERR:REFUND_NOT_RESOLVABLE', 'resolve: an unknown shipment is REFUND_NOT_RESOLVABLE');
select is(pg_temp.resolve(64307, 64003) || ' ' || pg_temp.resolve(64308, 64003),
  'ERR:REFUND_NOT_RESOLVABLE ERR:REFUND_NOT_RESOLVABLE', 'resolve: no operation or a claimed-only one is REFUND_NOT_RESOLVABLE');
select is(pg_temp.resolve(64309, 64003), 'ERR:REFUND_NOT_RESOLVABLE',
  'resolve: a started operation with no refund and no escalation is REFUND_NOT_RESOLVABLE');
select is(pg_temp.resolve(64304, 64003) || ' ' || pg_temp.resolve(64305, 64003) || ' ' || pg_temp.resolve(64306, 64003),
  'ERR:REFUND_NOT_RESOLVABLE ERR:REFUND_NOT_RESOLVABLE ERR:REFUND_NOT_RESOLVABLE',
  'resolve: a pending, requires_action or succeeded refund is REFUND_NOT_RESOLVABLE');
select is(pg_temp.resolve(64311, 64003), 'ERR:REFUND_NOT_RESOLVABLE',
  'resolve: an escalated operation whose refund is recorded as pending is REFUND_NOT_RESOLVABLE');
select is(
  (select count(*) from public.admin_audit_logs where target_id in (select pg_temp.mu(n) from generate_series(64304, 64311) n))
  + (select count(*) from public.shipment_cancellation_operations
     where shipment_id in (select pg_temp.mu(n) from generate_series(64304, 64311) n) and refund_resolved_at is not null)
  + (select count(*) from public.shipments
     where id in (select pg_temp.mu(n) from generate_series(64304, 64311) n) and status <> 'paid'),
  0::bigint, 'resolve: refusals write no audit row, no resolution and cancel nothing');

select is(pg_temp.resolve(64301, 64003, '  SPEI-123 ')::jsonb,
  '{"resolved": true, "shipment_cancelled": true, "amount_owed_cents": 11000, "reference": "SPEI-123"}'::jsonb,
  'resolve: a refund that failed before success is resolved with the trimmed reference and the cancellation completes');
select is(
  ((pg_temp.op(64301)).refund_resolved_by = pg_temp.mu(64003))::text || ':' || (pg_temp.op(64301)).refund_resolution_reference
  || ':' || ((pg_temp.op(64301)).refund_resolved_at is not null),
  'true:SPEI-123:true', 'resolve: the operation records the admin, the reference and the time');
select is(
  (select s.status::text || ':' || p.status::text from public.shipments s join public.products p on p.id = s.id where s.id = pg_temp.mu(64301))
  || ':' || (select count(*) from public.notifications where event_kind = 'shipment.cancelled' and event_payload->>'shipment_id' = pg_temp.mu(64301)::text)
  || ':' || (select cancellation_loss_cents from public.orders where id = pg_temp.mu(64401)),
  'cancelled:VERIFIED:2:120', 'resolve: completion cancels the shipment, frees the listing, notifies both parties and books the frozen loss');
select is(
  (select string_agg(admin_id || '|' || action_type || '|' || details::text, ' ') from public.admin_audit_logs where target_id = pg_temp.mu(64301)),
  pg_temp.mu(64003) || '|SHIPMENT_REFUND_RESOLVED|'
    || jsonb_build_object('refund_id', 're_64301', 'refund_status', 'failed', 'amount_owed_cents', 11000,
      'reference', 'SPEI-123', 'shipment_status_before', 'paid')::text,
  'resolve: one audit row records the admin, the refund, the amount owed, the reference and the prior status');
create table pg_temp.resolved_before as select * from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(64301);
select is(pg_temp.resolve(64301, 64005, 'OTHER')::jsonb,
  '{"resolved": false, "shipment_cancelled": false, "amount_owed_cents": 11000, "reference": "SPEI-123"}'::jsonb,
  'resolve: a second resolution reports resolved false with the first reference');
select is(
  pg_temp.audits(64301) || ':' || (select count(*) from public.shipment_cancellation_operations o, pg_temp.resolved_before b
    where o.shipment_id = b.shipment_id and o::text = b::text),
  '1:1', 'resolve: a second resolution writes no audit row and keeps the first admin and reference');

select is(pg_temp.resolve(64302, 64003)::jsonb,
  '{"resolved": true, "shipment_cancelled": false, "amount_owed_cents": 11000, "reference": "SPEI-123"}'::jsonb,
  'resolve: a refund that failed after the cancellation is resolved without cancelling again');
select is(
  (select count(*) from public.notifications where event_kind = 'shipment.cancelled' and event_payload->>'shipment_id' = pg_temp.mu(64302)::text)
  || ':' || (select details->>'shipment_status_before' from public.admin_audit_logs where target_id = pg_temp.mu(64302)),
  '2:cancelled', 'resolve: no second cancellation notice, and the audit row records the cancelled status');
select is(pg_temp.resolve(64303, 64005, repeat('r', 200))::jsonb - 'reference',
  '{"resolved": true, "shipment_cancelled": true, "amount_owed_cents": 11000}'::jsonb,
  'resolve: a canceled refund of a timeout operation resolves and completes as system; a NULL-status admin and a 200-character reference are accepted');
select is(pg_temp.resolve(64310, 64003)::jsonb,
  '{"resolved": true, "shipment_cancelled": true, "amount_owed_cents": 11000, "reference": "SPEI-123"}'::jsonb,
  'resolve: an escalated operation without a refund is resolvable and completes the cancellation');
select is(
  (select details::text from public.admin_audit_logs where target_id = pg_temp.mu(64310)),
  jsonb_build_object('refund_id', null, 'refund_status', null, 'amount_owed_cents', 11000, 'reference', 'SPEI-123',
    'shipment_status_before', 'paid', 'escalation_reason', 'refund_not_found')::text,
  'resolve: the audit row of an escalated operation records the escalation reason');
create table pg_temp.resolved_64312 as select pg_temp.resolve(64312, 64003)::jsonb as r;
select is(
  (select r->>'resolved' from pg_temp.resolved_64312) || ':'
  || (select (details->>'refund_status') || ':' || (details->>'escalation_reason') from public.admin_audit_logs where target_id = pg_temp.mu(64312)),
  'true:failed:refund_ambiguous', 'resolve: an escalated operation whose refund later failed resolves through the failed path and audits both');
select is(
  (select string_agg(recovery_escalation_reason || ':' || (recovery_escalated_at is not null), ',' order by shipment_id)
   from public.shipment_cancellation_operations where shipment_id in (pg_temp.mu(64310), pg_temp.mu(64312))),
  'refund_not_found:true,refund_ambiguous:true', 'resolve: the escalation markers stay as history');
select is(pg_temp.resolve(64313, 64003), 'ERR:SHIPMENT_STATUS_UNEXPECTED: shipped',
  'resolve: a shipment that moved on is SHIPMENT_STATUS_UNEXPECTED');
select is(pg_temp.audits(64313) || ':' || ((pg_temp.op(64313)).refund_resolved_at is null),
  '0:true', 'resolve: SHIPMENT_STATUS_UNEXPECTED writes no audit row and no resolution');

create function pg_temp.fail_cancel() returns trigger language plpgsql as $$
begin
  raise exception 'TEST_CANCEL_FAILURE';
end $$;
create trigger t3_fail_cancel before update on public.shipments
  for each row when (new.id = 'f0000000-0000-4000-8000-000000064314'::uuid)
  execute function pg_temp.fail_cancel();
select is(pg_temp.resolve(64314, 64003), 'ERR:CANCELLATION_COMPLETE_FAILED: INTERNAL_SERVER_ERROR',
  'resolve: a failed completion raises CANCELLATION_COMPLETE_FAILED');
drop trigger t3_fail_cancel on public.shipments;
select is(
  pg_temp.audits(64314) || ':' || ((pg_temp.op(64314)).refund_resolved_at is null) || ':'
  || (select status::text from public.shipments where id = pg_temp.mu(64314)) || ':'
  || (select count(*) from public.system_logs where message = 'Fallo en fn_cancel_shipment'
      and metadata->>'shipment_id' = pg_temp.mu(64314)::text),
  '0:true:paid:0', 'resolve: a failed completion commits nothing, audit row and log included');

select * from finish();
rollback;
