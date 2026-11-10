-- Shipment cancellation refund events (#276 T3): fn_record_shipment_cancellation_refund
-- records the Stripe refund of a started cancellation against its frozen request and
-- follows Stripe's refund lifecycle; fn_apply_shipment_cancellation_refund_event
-- records each event, completes the cancellation through fn_cancel_shipment when the
-- refund succeeded and notifies the buyer when it failed; fn_cancel_shipment refuses
-- to cancel without a succeeded refund.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(60);
\ir ../fixtures/money.psql

-- Users: 63001 seller, 63002 buyer.
select pg_temp.money_user(63001);
select pg_temp.money_user(63002);

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

-- The record RPC and the event RPC for shipment p_n; the payment intent defaults to the shipment's.
create function pg_temp.rec(p_n integer, p_refund text, p_status text, p_reason text default null,
  p_amount bigint default 11000, p_intent text default null)
returns jsonb language sql as $$
  select public.fn_record_shipment_cancellation_refund(pg_temp.mu(p_n), p_refund,
    coalesce(p_intent, (select stripe_payment_intent_id from public.shipments where id = pg_temp.mu(p_n)), 'pi_none'),
    p_amount, p_status, p_reason)
$$;
create function pg_temp.apply(p_n integer, p_refund text, p_status text, p_reason text default null,
  p_amount bigint default 11000, p_intent text default null)
returns jsonb language sql as $$
  select public.fn_apply_shipment_cancellation_refund_event(pg_temp.mu(p_n), p_refund,
    coalesce(p_intent, (select stripe_payment_intent_id from public.shipments where id = pg_temp.mu(p_n)), 'pi_none'),
    p_amount, p_status, p_reason)
$$;

-- shipment status|listing status|refund_id|refund_status|failure reason|status time|notices,
-- to prove a call changed nothing.
create function pg_temp.sig(p_n integer) returns text language sql as $$
  select s.status::text || '|' || p.status::text || '|' || coalesce(o.refund_id, '-') || '|'
    || coalesce(o.refund_status, '-') || '|' || coalesce(o.refund_failure_reason, '-') || '|'
    || coalesce(o.refund_status_updated_at::text, '-') || '|'
    || (select count(*) from public.notifications n where n.event_payload->>'shipment_id' = s.id::text)
  from public.shipments s
  join public.products p on p.id = s.id
  left join public.shipment_cancellation_operations o on o.shipment_id = s.id
  where s.id = pg_temp.mu(p_n)
$$;

create function pg_temp.notices(p_n integer, p_kind text) returns bigint language sql as $$
  select count(*) from public.notifications
  where event_kind = p_kind and event_payload->>'shipment_id' = pg_temp.mu(p_n)::text
$$;

-- 1. Grants and security mode ------------------------------------------------------
select is(
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')
     || ':' || has_function_privilege('authenticated', p.oid, 'execute')
     || ':' || has_function_privilege('service_role', p.oid, 'execute'), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_record_shipment_cancellation_refund', 'fn_apply_shipment_cancellation_refund_event')),
  'fn_apply_shipment_cancellation_refund_event:false:false:true fn_record_shipment_cancellation_refund:false:false:true',
  'only service_role can execute the record and event RPCs (anon, authenticated and PUBLIC cannot)');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_record_shipment_cancellation_refund', 'fn_apply_shipment_cancellation_refund_event')),
  'fn_apply_shipment_cancellation_refund_event:true:search_path="" fn_record_shipment_cancellation_refund:true:search_path=""',
  'both RPCs are SECURITY DEFINER with an empty search_path');

-- Fixtures for the record RPC: 63101 started, 63102 its started sibling on the same
-- payment intent, 63103 without an operation, 63104 claimed but not started.
select pg_temp.money_shipment(63201, 63101, 63001, 63002, 'paid');
select pg_temp.money_shipment(63201, 63102, 63001, 63002, 'paid');
select pg_temp.money_shipment(63203, 63103, 63001, 63002, 'paid');
select pg_temp.money_shipment(63204, 63104, 63001, 63002, 'paid');
select pg_temp.start_cancel(63101);
select pg_temp.start_cancel(63102);
select pg_temp.start_cancel(63104, 'buyer', 0, false);

select set_config('request.jwt.claims', '{"sub": "f0000000-0000-4000-8000-000000063002", "role": "authenticated"}', true);
select throws_ok($$select pg_temp.rec(63101, 're_1', 'pending')$$, 'P0001', 'UNAUTHORIZED',
  'record: a caller without the service_role claim is refused by the body');
select throws_ok($$select pg_temp.apply(63103, 're_1', 'pending')$$, 'P0001', 'UNAUTHORIZED',
  'event: a caller without the service_role claim is refused by the body, before any lookup');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 2. fn_record_shipment_cancellation_refund ---------------------------------------
select throws_ok($$select public.fn_record_shipment_cancellation_refund(gen_random_uuid(), 're_1', 'pi_x', 11000, 'pending')$$,
  'P0001', 'SHIPMENT_NOT_FOUND', 'record: an unknown shipment is SHIPMENT_NOT_FOUND');
select throws_ok($$select pg_temp.rec(63103, 're_1', 'pending')$$, 'P0001', 'CANCELLATION_NOT_STARTED',
  'record: a shipment without a cancellation operation is CANCELLATION_NOT_STARTED');
select throws_ok($$select pg_temp.rec(63104, 're_1', 'pending')$$, 'P0001', 'CANCELLATION_NOT_STARTED',
  'record: a claimed but not started operation is CANCELLATION_NOT_STARTED');
select throws_ok($$select pg_temp.rec(63101, 're_1', 'processing')$$, 'P0001', 'INVALID_REFUND_STATUS',
  'record: a status outside Stripe''s refund lifecycle is INVALID_REFUND_STATUS');
select throws_ok($$select pg_temp.rec(63101, '  ', 'pending')$$, 'P0001', 'INVALID_REFUND_ID',
  'record: a blank refund id is INVALID_REFUND_ID');
select throws_ok($$select pg_temp.rec(63101, null, 'pending')$$, 'P0001', 'INVALID_REFUND_ID',
  'record: a NULL refund id is INVALID_REFUND_ID');
select is(pg_temp.sig(63101), 'paid|SOLD|-|-|-|-|0', 'record: the rejected calls left the operation without a refund');

select is(pg_temp.rec(63101, 're_1', 'pending'),
  '{"refund_id": "re_1", "refund_status": "pending", "refund_failure_reason": null, "changed": true}'::jsonb,
  'record: a pending refund on a started operation is recorded');
select isnt((select refund_status_updated_at from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(63101)),
  null, 'record: recording stamps refund_status_updated_at');
create table pg_temp.sig_before (n integer primary key, v text);
insert into pg_temp.sig_before values (63101, pg_temp.sig(63101)), (63102, pg_temp.sig(63102));
select is(pg_temp.rec(63101, 're_1', 'pending')->>'changed', 'false', 'record: a replay of the same status reports changed false');
select throws_ok($$select pg_temp.rec(63101, 're_1', 'succeeded', null, 11000, 'pi_other')$$, 'P0001',
  'REFUND_PAYMENT_INTENT_MISMATCH', 'record: another payment intent is REFUND_PAYMENT_INTENT_MISMATCH');
select throws_ok($$select pg_temp.rec(63101, 're_1', 'succeeded', null, 11001)$$, 'P0001',
  'REFUND_AMOUNT_MISMATCH', 'record: one cent more than the frozen amount is REFUND_AMOUNT_MISMATCH');
select throws_ok($$select pg_temp.rec(63101, 're_1', 'succeeded', null, 10999)$$, 'P0001',
  'REFUND_AMOUNT_MISMATCH', 'record: one cent less than the frozen amount is REFUND_AMOUNT_MISMATCH');
select throws_ok($$select pg_temp.rec(63101, 're_2', 'failed')$$, 'P0001',
  'REFUND_ID_MISMATCH', 'record: another refund id on a recorded refund is REFUND_ID_MISMATCH, even when failed');
select throws_ok($$select pg_temp.rec(63102, 're_1', 'succeeded')$$, 'P0001',
  'REFUND_ID_ALREADY_LINKED', 'record: a sibling with the same payment intent and amount cannot take this shipment''s refund');
select is(
  (select string_agg(pg_temp.sig(n), ' ' order by n) from pg_temp.sig_before),
  (select string_agg(v, ' ' order by n) from pg_temp.sig_before),
  'record: the replay and the rejected calls changed neither the operation nor its sibling');

-- Stripe's lifecycle: one fresh operation per (from, to) pair, 63300 + 10*from + to.
create table pg_temp.lifecycle (i integer, s text);
insert into pg_temp.lifecycle values (1, 'requires_action'), (2, 'pending'), (3, 'succeeded'), (4, 'failed'), (5, 'canceled');
select pg_temp.money_shipment(63400 + 10 * a.i + b.i, 63300 + 10 * a.i + b.i, 63001, 63002, 'paid')
from pg_temp.lifecycle a, pg_temp.lifecycle b;
select pg_temp.start_cancel(63300 + 10 * a.i + b.i) from pg_temp.lifecycle a, pg_temp.lifecycle b;
create table pg_temp.transitions as
select a.i as from_i, b.i as to_i, b.s as to_s,
  (pg_temp.rec(63300 + 10 * a.i + b.i, 're_' || (63300 + 10 * a.i + b.i), a.s)->>'changed')
  || '>' || (pg_temp.rec(63300 + 10 * a.i + b.i, 're_' || (63300 + 10 * a.i + b.i), b.s)->>'changed') as r
from pg_temp.lifecycle a, pg_temp.lifecycle b;
create function pg_temp.row_of(p_from integer) returns text language sql as $$
  select string_agg(to_s || '=' || split_part(r, '>', 2), ',' order by to_i) from pg_temp.transitions where from_i = p_from
$$;
select is(pg_temp.row_of(1), 'requires_action=false,pending=true,succeeded=true,failed=true,canceled=true',
  'record: requires_action moves to pending, succeeded, failed or canceled');
select is(pg_temp.row_of(2), 'requires_action=false,pending=false,succeeded=true,failed=true,canceled=true',
  'record: pending moves to succeeded, failed or canceled, never back to requires_action');
select is(pg_temp.row_of(3), 'requires_action=false,pending=false,succeeded=false,failed=true,canceled=false',
  'record: succeeded moves only to failed');
select is(pg_temp.row_of(4) || ' ' || pg_temp.row_of(5),
  'requires_action=false,pending=false,succeeded=false,failed=false,canceled=false requires_action=false,pending=false,succeeded=false,failed=false,canceled=false',
  'record: failed and canceled are terminal');
select is((select count(*) from pg_temp.transitions where split_part(r, '>', 1) <> 'true'), 0::bigint,
  'record: a first status of any kind is recorded');
select is(
  (select string_agg(o.refund_status, ',' order by t.from_i)
   from pg_temp.transitions t join public.shipment_cancellation_operations o
     on o.shipment_id = pg_temp.mu(63300 + 10 * t.from_i + t.to_i)
   where t.to_i = 1),
  'requires_action,pending,succeeded,failed,canceled', 'record: a refused transition keeps the stored status');

-- Failure reasons: kept, trimmed, only for failed.
select pg_temp.money_shipment(63460 + n, 63360 + n, 63001, 63002, 'paid') from generate_series(1, 3) n;
select pg_temp.start_cancel(63360 + n) from generate_series(1, 3) n;
select is(pg_temp.rec(63361, 're_63361', 'failed', '  lost_or_stolen_card '),
  '{"refund_id": "re_63361", "refund_status": "failed", "refund_failure_reason": "lost_or_stolen_card", "changed": true}'::jsonb,
  'record: a failed refund keeps Stripe''s failure reason, trimmed');
select is(
  coalesce(pg_temp.rec(63362, 're_63362', 'canceled', 'expired_or_canceled_card')->>'refund_failure_reason', '-')
  || ',' || coalesce(pg_temp.rec(63363, 're_63363', 'failed', '   ')->>'refund_failure_reason', '-'),
  '-,-', 'record: a canceled refund stores no reason, and a blank reason is stored as NULL');
select is(pg_temp.rec(63361, 're_63361', 'canceled', 'other')->>'refund_failure_reason', 'lost_or_stolen_card',
  'record: a refused transition keeps the stored failure reason');

-- 3. fn_apply_shipment_cancellation_refund_event ---------------------------------
-- 63501 started by the buyer with a frozen loss of 120 cents on an order with a
-- 500-cent Stripe fee; 63502 its started sibling; 63503 no operation; 63504 claimed only.
select pg_temp.money_shipment(63601, 63501, 63001, 63002, 'paid');
select pg_temp.money_shipment(63601, 63502, 63001, 63002, 'paid');
select pg_temp.money_shipment(63603, 63503, 63001, 63002, 'paid');
select pg_temp.money_shipment(63604, 63504, 63001, 63002, 'paid');
update public.orders set actual_stripe_fee_cents = 500 where id = pg_temp.mu(63601);
select pg_temp.start_cancel(63501, 'buyer', 120);
select pg_temp.start_cancel(63502);
select pg_temp.start_cancel(63504, 'buyer', 0, false);
insert into pg_temp.sig_before values (63502, pg_temp.sig(63502)), (63503, pg_temp.sig(63503)), (63504, pg_temp.sig(63504));

select is(
  public.fn_apply_shipment_cancellation_refund_event(gen_random_uuid(), 're_1', 'pi_x', 11000, 'succeeded')::text
  || pg_temp.apply(63503, 're_1', 'succeeded')::text || pg_temp.apply(63504, 're_1', 'succeeded')::text,
  '{"outcome": "ignored"}{"outcome": "ignored"}{"outcome": "ignored"}',
  'event: an unknown shipment, one without an operation and a claimed-only one are ignored');
select is(
  (select string_agg(pg_temp.sig(n) || '=' || v, ' ') from pg_temp.sig_before where n in (63503, 63504) and pg_temp.sig(n) <> v),
  null, 'event: an ignored event writes nothing');

select is(pg_temp.apply(63501, 're_63501', 'pending'),
  '{"refund_id": "re_63501", "refund_status": "pending", "refund_failure_reason": null, "amount_owed_cents": 11000, "outcome": "recorded"}'::jsonb,
  'event: a pending refund is recorded with the frozen amount owed');
select is(split_part(pg_temp.sig(63501), '|', 1) || '|' || split_part(pg_temp.sig(63501), '|', 2), 'paid|SOLD',
  'event: a pending refund leaves the shipment open and its listing sold');
select throws_ok($$select pg_temp.apply(63501, 're_63501', 'succeeded', null, 11000, 'pi_other')$$, 'P0001',
  'REFUND_PAYMENT_INTENT_MISMATCH', 'event: an event for another payment intent raises through the record RPC');
select throws_ok($$select pg_temp.apply(63502, 're_63501', 'succeeded')$$, 'P0001',
  'REFUND_ID_ALREADY_LINKED', 'event: the sibling cannot take this shipment''s refund');
select is(pg_temp.apply(63501, 're_63501', 'succeeded'),
  '{"refund_id": "re_63501", "refund_status": "succeeded", "refund_failure_reason": null, "amount_owed_cents": 11000, "outcome": "completed"}'::jsonb,
  'event: a succeeded refund completes the cancellation');
select is(split_part(pg_temp.sig(63501), '|', 1) || '|' || split_part(pg_temp.sig(63501), '|', 2), 'cancelled|VERIFIED',
  'event: completion cancels the shipment and puts its listing back on sale');
select is((select cancellation_loss_cents from public.orders where id = pg_temp.mu(63601)), 120::bigint,
  'event: completion books the frozen loss of the operation on the order');
delete from pg_temp.sig_before where n = 63501;
insert into pg_temp.sig_before values (63501, pg_temp.sig(63501));
select is(pg_temp.apply(63501, 're_63501', 'succeeded')->>'outcome' || ',' || (pg_temp.apply(63501, 're_63501', 'pending')->>'outcome'),
  'unchanged,unchanged', 'event: a replayed or stale event on a completed cancellation is unchanged');
select is(pg_temp.sig(63501), (select v from pg_temp.sig_before where n = 63501),
  'event: unchanged events write nothing and cancel nothing twice');

select is(pg_temp.apply(63501, 're_63501', 'failed', 'expired_or_canceled_card'),
  '{"refund_id": "re_63501", "refund_status": "failed", "refund_failure_reason": "expired_or_canceled_card", "amount_owed_cents": 11000, "outcome": "failed_after_cancellation"}'::jsonb,
  'event: a refund that fails after success is failed_after_cancellation');
select is(split_part(pg_temp.sig(63501), '|', 1) || '|' || split_part(pg_temp.sig(63501), '|', 2), 'cancelled|VERIFIED',
  'event: a late failure keeps the shipment cancelled');
select is(
  (select string_agg(user_id || '|' || source_event_key || '|' || event_payload::text || '|' || type || '|' || title
     || '|' || message || '|' || action_path, ' ')
   from public.notifications where event_kind = 'shipment.refund_failed'
     and event_payload->>'shipment_id' = pg_temp.mu(63501)::text),
  pg_temp.mu(63002) || '|shipment.refund_failed:' || pg_temp.mu(63501) || ':re_63501|'
    || jsonb_build_object('order_id', pg_temp.mu(63601), 'shipment_id', pg_temp.mu(63501), 'refund_id', 're_63501', 'recipient_role', 'buyer')::text
    || '|error|Reembolso con problemas|No pudimos completar el reembolso de un envío cancelado de tu pedido. Nuestro equipo se pondrá en contacto contigo para devolverte tu dinero.|/profile/orders/'
    || pg_temp.mu(63601) || '?shipment_id=' || pg_temp.mu(63501),
  'event: the buyer gets one refund_failed notice with the cancelled-shipment copy, keyed by shipment and refund');
select is(pg_temp.apply(63501, 're_63501', 'failed', 'expired_or_canceled_card')->>'outcome', 'failed_after_cancellation',
  'event: a redelivered failure reports again while the operation is unresolved');
select is(pg_temp.apply(63501, 're_63501', 'succeeded')->>'outcome', 'unchanged',
  'event: a succeeded event after the failure is unchanged');
select is(pg_temp.notices(63501, 'shipment.refund_failed'), 1::bigint,
  'event: the redelivery adds no second buyer notice');
select is(
  (select string_agg(n || ':' || pg_temp.sig(n), ' ') from pg_temp.sig_before where n = 63502 and pg_temp.sig(n) <> v),
  null, 'event: completing and failing a shipment leaves its sibling on the same payment intent untouched');

-- 63505 fails before success; 63506 is canceled before success.
select pg_temp.money_shipment(63605, 63505, 63001, 63002, 'paid');
select pg_temp.money_shipment(63606, 63506, 63001, 63002, 'paid');
select pg_temp.start_cancel(63505);
select pg_temp.start_cancel(63506);
select is(pg_temp.apply(63505, 're_63505', 'failed', 'lost_or_stolen_card'),
  '{"refund_id": "re_63505", "refund_status": "failed", "refund_failure_reason": "lost_or_stolen_card", "amount_owed_cents": 11000, "outcome": "failed_before_cancellation"}'::jsonb,
  'event: a refund that fails before success is failed_before_cancellation');
select is(
  split_part(pg_temp.sig(63505), '|', 1) || '|' || split_part(pg_temp.sig(63505), '|', 2)
  || '|' || pg_temp.notices(63505, 'shipment.cancelled'),
  'paid|SOLD|0', 'event: a failure before success cancels nothing and sends no cancellation notice');
select is(
  (select message || '|' || source_event_key from public.notifications
   where event_kind = 'shipment.refund_failed' and event_payload->>'shipment_id' = pg_temp.mu(63505)::text),
  'El reembolso de la cancelación de un envío de tu pedido no se completó. Nuestro equipo lo está revisando y se pondrá en contacto contigo.|shipment.refund_failed:'
    || pg_temp.mu(63505) || ':re_63505',
  'event: the buyer notice of a failure before success uses the open-shipment copy');
select is(pg_temp.apply(63505, 're_63505', 'succeeded')->>'outcome' || '|' || split_part(pg_temp.sig(63505), '|', 1),
  'unchanged|paid', 'event: a succeeded event after the failure neither records nor cancels');
select is(
  pg_temp.apply(63506, 're_63506', 'canceled')::text || '|' || pg_temp.notices(63506, 'shipment.refund_failed'),
  '{"outcome": "failed_before_cancellation", "refund_id": "re_63506", "refund_status": "canceled", "amount_owed_cents": 11000, "refund_failure_reason": null}|1',
  'event: a canceled refund is reported like a failure and notifies the buyer');

-- 63507 paid_timeout and 63508 seller operations complete with the stored winner.
select pg_temp.money_shipment(63607, 63507, 63001, 63002, 'paid');
select pg_temp.money_shipment(63608, 63508, 63001, 63002, 'paid');
select pg_temp.start_cancel(63507, 'paid_timeout');
select pg_temp.start_cancel(63508, 'seller');
select is(
  (pg_temp.apply(63507, 're_63507', 'succeeded')->>'outcome') || ',' || (pg_temp.apply(63508, 're_63508', 'succeeded')->>'outcome')
  || ',' || split_part(pg_temp.sig(63507), '|', 1) || ',' || split_part(pg_temp.sig(63508), '|', 1),
  'completed,completed,cancelled,cancelled',
  'event: a timeout operation completes as system and a seller operation as seller');

-- 63509: the succeeded refund was recorded without completing; the next event completes it.
select pg_temp.money_shipment(63609, 63509, 63001, 63002, 'paid');
select pg_temp.start_cancel(63509);
select pg_temp.rec(63509, 're_63509', 'succeeded');
select is(split_part(pg_temp.sig(63509), '|', 1) || ',' || (pg_temp.apply(63509, 're_63509', 'succeeded')->>'outcome')
  || ',' || split_part(pg_temp.sig(63509), '|', 1),
  'paid,completed,cancelled', 'event: a recorded succeeded refund on an open shipment converges on the next event');

-- 63510: the shipment moved on (shipped) after the refund started.
select pg_temp.money_shipment(63610, 63510, 63001, 63002, 'paid');
select pg_temp.start_cancel(63510);
update public.shipments set status = 'shipped' where id = pg_temp.mu(63510);
select is(
  (pg_temp.apply(63510, 're_63510', 'failed')->>'outcome') || ',' || (pg_temp.apply(63510, 're_63510', 'succeeded')->>'outcome')
  || ',' || split_part(pg_temp.sig(63510), '|', 1) || ',' || pg_temp.notices(63510, 'shipment.refund_failed'),
  'failed_before_cancellation,unchanged,shipped,1',
  'event: a failure on a shipment that moved on is reported but never cancels it');

-- 63511: fn_cancel_shipment fails inside the event; nothing is recorded.
select pg_temp.money_shipment(63611, 63511, 63001, 63002, 'paid');
select pg_temp.start_cancel(63511);
create function pg_temp.fail_cancel() returns trigger language plpgsql as $$
begin
  raise exception 'TEST_CANCEL_FAILURE';
end $$;
create trigger t3_fail_cancel before update on public.shipments
  for each row when (new.id = 'f0000000-0000-4000-8000-000000063511'::uuid)
  execute function pg_temp.fail_cancel();
select throws_ok($$select pg_temp.apply(63511, 're_63511', 'succeeded')$$, 'P0001',
  'CANCELLATION_COMPLETE_FAILED: INTERNAL_SERVER_ERROR', 'event: a failed completion raises CANCELLATION_COMPLETE_FAILED');
drop trigger t3_fail_cancel on public.shipments;
select is(pg_temp.sig(63511), 'paid|SOLD|-|-|-|-|0', 'event: a failed completion records no refund');

-- 4. fn_cancel_shipment refuses without a succeeded refund -------------------------
-- 63503 no operation, 63504 claimed only, 63512 started without a refund, 63513 pending,
-- 63505 failed (unresolved).
select pg_temp.money_shipment(63612, 63512, 63001, 63002, 'paid');
select pg_temp.money_shipment(63613, 63513, 63001, 63002, 'paid');
select pg_temp.start_cancel(63512);
select pg_temp.start_cancel(63513);
select pg_temp.rec(63513, 're_63513', 'pending');
create function pg_temp.cancel(p_n integer) returns text language sql as $$
  select c.success::text || ':' || coalesce(c.error_message, '-')
  from public.fn_cancel_shipment(pg_temp.mu(p_n), 'buyer', 'Changed my mind') c
$$;
select is(
  (select string_agg(pg_temp.cancel(n), ',' order by n) from unnest(array[63503, 63504, 63505, 63512, 63513]) n),
  'false:REFUND_NOT_SUCCEEDED,false:REFUND_NOT_SUCCEEDED,false:REFUND_NOT_SUCCEEDED,false:REFUND_NOT_SUCCEEDED,false:REFUND_NOT_SUCCEEDED',
  'cancel: no operation, a claim, a started operation without a refund, a pending and a failed refund are REFUND_NOT_SUCCEEDED');
select is(
  (select string_agg(split_part(pg_temp.sig(n), '|', 1), ',' order by n) from unnest(array[63503, 63504, 63505, 63512, 63513]) n),
  'paid,paid,paid,paid,paid', 'cancel: a refused cancellation leaves the shipment open');
select is(pg_temp.cancel(63501), 'true:ALREADY_CANCELLED', 'cancel: a cancelled shipment returns ALREADY_CANCELLED');

select * from finish();
rollback;
