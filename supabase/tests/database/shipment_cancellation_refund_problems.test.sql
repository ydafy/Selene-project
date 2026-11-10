-- Shipment refund problems and notices (#276 T3): fn_list_shipment_refund_problems
-- lists the unresolved failed, canceled and escalated cancellation refunds for admins;
-- after an admin resolves an operation, fn_apply_shipment_cancellation_refund_event
-- still validates late Stripe events but never writes; fn_record_dispute_refund sends
-- the buyer the shipment.refunded notice on the branch that refunds the shipment.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(29);
\ir ../fixtures/money.psql

-- Users: 65001 seller, 65002 buyer, 65003 admin.
select pg_temp.money_user(65001);
select pg_temp.money_user(65002);
select pg_temp.money_user(65003, 'admin');

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

-- The event RPC for shipment p_n; the payment intent defaults to the shipment's.
create function pg_temp.apply(p_n integer, p_refund text, p_status text, p_reason text default null,
  p_amount bigint default 11000, p_intent text default null)
returns jsonb language sql as $$
  select public.fn_apply_shipment_cancellation_refund_event(pg_temp.mu(p_n), p_refund,
    coalesce(p_intent, (select stripe_payment_intent_id from public.shipments where id = pg_temp.mu(p_n)), 'pi_none'),
    p_amount, p_status, p_reason)
$$;
create function pg_temp.escalate(p_n integer, p_reason text) returns jsonb language sql as $$
  select public.fn_escalate_shipment_cancellation(pg_temp.mu(p_n), p_reason)
$$;
create function pg_temp.resolve(p_n integer) returns jsonb language sql as $$
  select public.fn_resolve_shipment_cancellation_refund(pg_temp.mu(p_n), pg_temp.mu(65003), 'SPEI-' || p_n)
$$;

-- The operation row plus its shipment status and notices, to prove an event wrote nothing.
create function pg_temp.state(p_n integer) returns text language sql as $$
  select o::text || '|' || s.status::text || '|'
    || (select count(*) from public.notifications n where n.event_payload->>'shipment_id' = s.id::text)
  from public.shipment_cancellation_operations o join public.shipments s on s.id = o.shipment_id
  where o.shipment_id = pg_temp.mu(p_n)
$$;

-- 1. Grants and security mode ------------------------------------------------------
select is(
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')
     || ':' || has_function_privilege('authenticated', p.oid, 'execute')
     || ':' || has_function_privilege('service_role', p.oid, 'execute'), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_list_shipment_refund_problems', 'fn_record_dispute_refund')),
  'fn_list_shipment_refund_problems:false:false:true fn_record_dispute_refund:false:false:true',
  'only service_role can execute the refund problems list and the dispute refund record (anon, authenticated and PUBLIC cannot)');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_list_shipment_refund_problems', 'fn_record_dispute_refund')),
  'fn_list_shipment_refund_problems:true:s:search_path="" fn_record_dispute_refund:true:v:search_path=""',
  'both are SECURITY DEFINER with an empty search_path, and the list is STABLE');
select set_config('request.jwt.claims', '{"sub": "f0000000-0000-4000-8000-000000065003", "role": "authenticated"}', true);
select throws_ok($$select * from public.fn_list_shipment_refund_problems()$$, 'P0001', 'UNAUTHORIZED',
  'list: a caller without the service_role claim is refused by the body');
select throws_ok($$select * from public.fn_record_dispute_refund(gen_random_uuid(), 're_x')$$, '42501',
  'fn_record_dispute_refund is service-role only', 'dispute refund: a caller without the service_role claim is refused by the body');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 2. fn_list_shipment_refund_problems --------------------------------------------
-- Listed: 65101 failed, 65102 canceled, 65103 escalated refund_not_found, 65104 escalated
-- refund_ambiguous, 65111 escalated then failed, 65112 failed after the cancellation.
-- Not listed: 65105 succeeded, 65106 pending, 65107 claimed only with a failed refund
-- written by hand (never started), 65108 started only,
-- 65109 escalated with a pending refund, 65110 failed and resolved.
select pg_temp.money_shipment(65150 + n, 65100 + n, 65001, 65002, 'paid') from generate_series(1, 12) n;
select pg_temp.start_cancel(65100 + n) from generate_series(1, 12) n where n <> 7;
select pg_temp.start_cancel(65107, 'buyer', 0, false);
update public.shipment_cancellation_operations
  set refund_id = 're_65107', refund_status = 'failed', refund_status_updated_at = now()
  where shipment_id = pg_temp.mu(65107);
select pg_temp.apply(65101, 're_65101', 'failed', 'lost_or_stolen_card');
select pg_temp.apply(65102, 're_65102', 'canceled');
select pg_temp.escalate(65103, 'refund_not_found');
select pg_temp.escalate(65104, 'refund_ambiguous');
select pg_temp.apply(65105, 're_65105', 'succeeded');
select pg_temp.apply(65106, 're_65106', 'pending');
select pg_temp.escalate(65109, 'refund_ambiguous');
select pg_temp.apply(65109, 're_65109', 'pending');
select pg_temp.apply(65110, 're_65110', 'failed', 'expired_or_canceled_card');
select pg_temp.resolve(65110);
select pg_temp.escalate(65111, 'refund_not_found');
select pg_temp.apply(65111, 're_65111', 'failed');
select pg_temp.apply(65112, 're_65112', 'succeeded');
select pg_temp.apply(65112, 're_65112', 'failed');
-- Fixed times: 65103 and 65102 tie, so the shipment id breaks it.
update public.shipment_cancellation_operations o set
  refund_status_updated_at = case when o.refund_status is null then null else v.t end,
  recovery_escalated_at = case when o.recovery_escalated_at is null then null else v.t end
from (values (65104, timestamptz '2026-01-01 00:00+00'), (65101, '2026-01-02 00:00+00'),
  (65102, '2026-01-03 00:00+00'), (65103, '2026-01-03 00:00+00'), (65111, '2026-01-04 00:00+00'),
  (65112, '2026-01-05 00:00+00')) v(n, t)
where o.shipment_id = pg_temp.mu(v.n);
update public.shipment_cancellation_operations set recovery_escalated_at = '2026-01-09 00:00+00'
where shipment_id = pg_temp.mu(65111);
create table pg_temp.problems as
select row_number() over () as i, p.* from public.fn_list_shipment_refund_problems() p
where p.shipment_id in (select pg_temp.mu(n) from generate_series(65101, 65112) n);
create function pg_temp.n_of(p_id uuid) returns text language sql as $$
  select right(p_id::text, 5)
$$;

select is(
  (select string_agg(pg_temp.n_of(shipment_id) || ':' || kind, ',' order by i) from pg_temp.problems),
  '65104:refund_ambiguous,65101:refund_failed,65102:refund_canceled,65103:refund_not_found,65111:refund_failed,65112:refund_failed',
  'list: the four problem kinds, oldest first with ties by shipment, an escalated failed refund once as refund_failed, and nothing else');
select is(
  (select row(order_id, buyer_id, shipment_status, refund_id, refund_failure_reason, amount_owed_cents, payment_intent_id, since)::text
   from pg_temp.problems where shipment_id = pg_temp.mu(65101)),
  row(pg_temp.mu(65151), pg_temp.mu(65002), 'paid', 're_65101', 'lost_or_stolen_card', 11000::bigint, 'pi_test_65151',
    timestamptz '2026-01-02 00:00+00')::text,
  'list: a failed refund row carries the order, buyer, refund, reason, frozen amount owed, payment intent and the status time');
select is(
  (select coalesce(refund_id, '-') || '|' || since::text from pg_temp.problems where shipment_id = pg_temp.mu(65103)),
  '-|' || timestamptz '2026-01-03 00:00+00',
  'list: an escalated operation without a refund is dated by its escalation');
select is(
  (select shipment_status || '|' || since::text from pg_temp.problems where shipment_id = pg_temp.mu(65111)),
  'paid|' || timestamptz '2026-01-04 00:00+00',
  'list: an escalated operation with a recorded refund is dated by the refund status');
select is((select shipment_status from pg_temp.problems where shipment_id = pg_temp.mu(65112)), 'cancelled',
  'list: a refund that failed after the cancellation shows the cancelled shipment');

-- 3. Events after a resolution ---------------------------------------------------
-- 65110: failed before success, then resolved. 65113: escalated without a refund, then resolved.
select pg_temp.money_shipment(65163, 65113, 65001, 65002, 'paid');
select pg_temp.start_cancel(65113);
select pg_temp.escalate(65113, 'refund_not_found');
select pg_temp.resolve(65113);
create table pg_temp.state_before as
select n, pg_temp.state(n) as v from unnest(array[65110, 65113]) n;

select is(pg_temp.apply(65110, 're_65110', 'failed', 'expired_or_canceled_card'),
  '{"refund_id": "re_65110", "refund_status": "failed", "refund_failure_reason": "expired_or_canceled_card", "amount_owed_cents": 11000, "outcome": "unchanged"}'::jsonb,
  'after resolution: a replay of the recorded failure is unchanged');
select is(pg_temp.apply(65110, 're_65110', 'succeeded'),
  '{"refund_id": "re_65110", "refund_status": "succeeded", "refund_failure_reason": null, "amount_owed_cents": 11000, "resolution_reference": "SPEI-65110", "outcome": "after_resolution"}'::jsonb,
  'after resolution: a new status of the recorded refund is reported as after_resolution with the reference');
select is(pg_temp.apply(65110, 're_other', 'succeeded')->>'outcome', 'after_resolution',
  'after resolution: another refund id is reported as after_resolution');
select throws_ok($$select pg_temp.apply(65110, 're_65110', 'succeeded', null, 11000, 'pi_other')$$, 'P0001',
  'REFUND_PAYMENT_INTENT_MISMATCH', 'after resolution: another payment intent still raises');
select throws_ok($$select pg_temp.apply(65110, 're_65110', 'succeeded', null, 10999)$$, 'P0001',
  'REFUND_AMOUNT_MISMATCH', 'after resolution: another amount still raises');
select throws_ok($$select pg_temp.apply(65110, ' ', 'succeeded')$$, 'P0001',
  'INVALID_REFUND_ID', 'after resolution: a blank refund id still raises');
select throws_ok($$select pg_temp.apply(65110, 're_65110', 'processing')$$, 'P0001',
  'INVALID_REFUND_STATUS', 'after resolution: an unknown status still raises');
select is(
  (select string_agg(r->>'outcome', ',') from (values (pg_temp.apply(65113, 're_65113', 'pending')),
    (pg_temp.apply(65113, 're_65113', 'requires_action')), (pg_temp.apply(65113, 're_65113', 'succeeded'))) v(r)),
  'after_resolution,after_resolution,after_resolution',
  'after resolution: a refund that appears for a resolved escalated operation is after_resolution');
select is(pg_temp.apply(65113, 're_65113', 'failed', 'lost_or_stolen_card')->>'refund_failure_reason', 'lost_or_stolen_card',
  'after resolution: a failure for a resolved escalated operation reports the event''s reason');
select is(
  (select count(*) from pg_temp.state_before where pg_temp.state(n) is distinct from v), 0::bigint,
  'after resolution: no event records a refund, changes the shipment or notifies anyone');

-- 4. Dispute refund notice --------------------------------------------------------
-- 65201 delivered, dispute waiting for the return; 65202 open dispute; 65203 paid
-- shipment; 65204 its notice fails; 65205 its notice and the warning log both fail.
select pg_temp.money_shipment(65251, 65201, 65001, 65002, 'delivered', interval '1 day');
select pg_temp.money_shipment(65252, 65202, 65001, 65002, 'delivered', interval '1 day');
select pg_temp.money_shipment(65253, 65203, 65001, 65002, 'paid');
select pg_temp.money_shipment(65254, 65204, 65001, 65002, 'delivered', interval '1 day');
select pg_temp.money_dispute(65301, 65201, 'waiting_return');
select pg_temp.money_dispute(65302, 65202, 'open');
select pg_temp.money_dispute(65303, 65203, 'waiting_return');
select pg_temp.money_dispute(65304, 65204, 'return_delivered');
select pg_temp.money_shipment(65255, 65205, 65001, 65002, 'delivered', interval '1 day');
select pg_temp.money_dispute(65305, 65205, 'return_delivered');
-- success:error_code of a dispute refund; an error comes back as ERR:<message>.
create function pg_temp.dispute_refund(p_n integer) returns text language plpgsql as $$
begin
  return (select r.success::text || ':' || coalesce(r.error_code, '-')
    from public.fn_record_dispute_refund(pg_temp.mu(p_n), 're_d' || p_n) r);
exception when others then
  return 'ERR:' || sqlerrm;
end $$;
create function pg_temp.refunded_notices(p_n integer) returns bigint language sql as $$
  select count(*) from public.notifications where event_kind = 'shipment.refunded'
    and event_payload->>'shipment_id' = pg_temp.mu(p_n)::text
$$;

select is(pg_temp.dispute_refund(65301), 'true:-', 'dispute refund: a refund for a dispute waiting for the return is recorded');
select is(
  (select string_agg(user_id || '|' || source_event_key || '|' || event_payload::text || '|' || type || '|' || title
     || '|' || message || '|' || action_path, ' ')
   from public.notifications where event_kind = 'shipment.refunded'
     and event_payload->>'shipment_id' = pg_temp.mu(65201)::text),
  pg_temp.mu(65002) || '|shipment.refunded:' || pg_temp.mu(65201) || '|'
    || jsonb_build_object('shipment_id', pg_temp.mu(65201), 'order_id', pg_temp.mu(65251), 'dispute_id', pg_temp.mu(65301),
      'recipient_role', 'buyer')::text
    || '|success|Te devolvimos tu dinero|Reembolsamos tu compra a tu método de pago. Puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.|/profile/orders/'
    || pg_temp.mu(65251) || '?shipment_id=' || pg_temp.mu(65201),
  'dispute refund: the buyer gets one shipment.refunded notice keyed by the shipment');
select is(pg_temp.dispute_refund(65301) || ':' || pg_temp.refunded_notices(65201), 'true:ALREADY_RECORDED:1',
  'dispute refund: a replay is ALREADY_RECORDED and sends no second notice');
select is(
  pg_temp.dispute_refund(65302) || ',' || pg_temp.dispute_refund(65303) || ','
  || (pg_temp.refunded_notices(65202) + pg_temp.refunded_notices(65203)),
  'false:INVALID_DISPUTE_STATUS,false:SHIPMENT_NOT_REFUNDABLE:paid,0',
  'dispute refund: a refused refund sends no notice');

create function pg_temp.fail_notice() returns trigger language plpgsql as $$
begin
  raise exception 'TEST_NOTICE_FAILURE';
end $$;
create trigger t3_fail_notice before insert on public.notifications
  for each row when (new.event_payload->>'shipment_id' in ('f0000000-0000-4000-8000-000000065204', 'f0000000-0000-4000-8000-000000065205'))
  execute function pg_temp.fail_notice();
select is(pg_temp.dispute_refund(65304), 'true:-', 'dispute refund: a failing notice does not fail the refund record');
create trigger t3_fail_log before insert on public.system_logs
  for each row when (new.metadata->>'shipment_id' = 'f0000000-0000-4000-8000-000000065205' and new.level = 'WARNING')
  execute function pg_temp.fail_notice();
create table pg_temp.refund_65305 as select pg_temp.dispute_refund(65305) as r;
select is(
  (select r from pg_temp.refund_65305) || ':' || (select status::text from public.shipments where id = pg_temp.mu(65205)),
  'true:-:refunded', 'dispute refund: when the warning log fails too, the refund is still recorded');
drop trigger t3_fail_log on public.system_logs;
drop trigger t3_fail_notice on public.notifications;
select is(
  (select s.status::text || ':' || d.status::text || ':' || coalesce(d.resolution_type, '-')
   from public.shipments s join public.disputes d on d.shipment_id = s.id where s.id = pg_temp.mu(65204))
  || ':' || pg_temp.refunded_notices(65204),
  'refunded:resolved:buyer:0', 'dispute refund: the refund stays recorded without the notice');
select is(
  (select count(*) from public.system_logs where level = 'WARNING' and message = 'Refund notice failed'
     and metadata = jsonb_build_object('dispute_id', pg_temp.mu(65304), 'shipment_id', pg_temp.mu(65204),
       'sqlstate', 'P0001', 'error', 'TEST_NOTICE_FAILURE')),
  1::bigint, 'dispute refund: the failed notice is logged as a WARNING with the dispute, shipment and error');

-- 5. Notice kinds and push policy ---------------------------------------------------
select is(
  (select string_agg(event_kind || ':' || recipient_role || ':' || channel, ' ' order by event_kind)
   from public.push_event_policy where event_kind in ('shipment.refunded', 'shipment.refund_failed')),
  'shipment.refund_failed:buyer:orders shipment.refunded:buyer:orders',
  'push policy: both refund notices are pushed to the buyer on the orders channel');
select throws_ok(
  format($$insert into public.notifications (user_id, event_kind, source_event_key, event_payload, type, title, message)
    values (%L, 'shipment.unknown', 'shipment.unknown:1', '{}', 'info', 't', 'm')$$, pg_temp.mu(65002)),
  '23514', null, 'catalogue: a notice kind outside the catalogue is rejected');

select * from finish();
rollback;
