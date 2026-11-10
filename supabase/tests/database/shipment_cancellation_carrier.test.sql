-- Carrier cancellation outcome (#276 T4): fn_record_shipment_carrier_cancellation
-- records once what the carrier answered to a preparing-timeout label
-- cancellation and computes the label-cost loss in SQL;
-- fn_get_shipment_carrier_cancellation reads it back; the refund start of a
-- preparing timeout needs an accepted outcome (or an approved review, in
-- shipment_cancellation_carrier_review.test.sql); the private
-- fn_start_shipment_cancellation is unreachable for every client role.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(49);
\ir ../fixtures/money.psql

-- Users: 7001 seller, 7002 buyer.
select pg_temp.money_user(7001);
select pg_temp.money_user(7002);

-- A preparing shipment with a generated label that cost p_cost cents.
create function pg_temp.prep(p_order integer, p_ship integer, p_cost bigint default 8900)
returns uuid language plpgsql as $$
begin
  perform pg_temp.money_shipment(p_order, p_ship, 7001, 7002, 'preparing');
  update public.shipments set label_generation_state = 'generated', label_provider_cost_cents = p_cost
  where id = pg_temp.mu(p_ship);
  return pg_temp.mu(p_ship);
end $$;

-- The error message of a statement, or 'ok'. The exception block rolls the
-- statement back like a failed call.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

-- The violated constraint of a statement, or 'ok'. The statement is always rolled back.
create function pg_temp.chk(p_sql text) returns text language plpgsql as $$
declare
  v_name text;
begin
  execute p_sql;
  raise exception 'CHK_OK';
exception
  when check_violation then
    get stacked diagnostics v_name = constraint_name;
    return v_name;
  when raise_exception then
    if sqlerrm = 'CHK_OK' then return 'ok'; end if;
    raise;
end $$;

-- Claim tokens by shipment number.
create table pg_temp.tok (n integer primary key, t uuid);

-- The claim token of a new cancellation claim.
create function pg_temp.claim(p_ship integer, p_source text default 'preparing_timeout')
returns uuid language sql as $$
  select (public.fn_claim_shipment_cancellation(pg_temp.mu(p_ship), s.order_id, null, p_source,
    p_source || ' test') ->> 'claim_token')::uuid
  from public.shipments s where s.id = pg_temp.mu(p_ship)
$$;

create function pg_temp.rec(p_ship integer, p_outcome text, p_returned boolean default null,
  p_returned_at timestamptz default null)
returns jsonb language sql as $$
  select public.fn_record_shipment_carrier_cancellation(pg_temp.mu(p_ship),
    (select t from pg_temp.tok where n = p_ship), p_outcome, p_returned, p_returned_at)
$$;

-- The stored operation row, to prove a refusal changed nothing.
create function pg_temp.op(p_ship integer) returns text language sql as $$
  select row_to_json(o)::text from public.shipment_cancellation_operations o where o.shipment_id = pg_temp.mu(p_ship)
$$;

-- outcome|recorded|balance returned|balance date|label loss of an operation.
create function pg_temp.carrier(p_ship integer) returns text language sql as $$
  select coalesce(o.carrier_cancellation_outcome, '-') || '|' || (o.carrier_cancellation_recorded_at is not null)::text
    || '|' || coalesce(o.carrier_balance_returned::text, '-') || '|' || coalesce(o.carrier_balance_returned_at::text, '-')
    || '|' || coalesce(o.label_cost_loss_cents::text, '-')
  from public.shipment_cancellation_operations o where o.shipment_id = pg_temp.mu(p_ship)
$$;

-- The Stripe refund params fn_start_shipment_cancellation_refund accepts for an operation.
create function pg_temp.req(p_ship integer) returns jsonb language sql as $$
  select jsonb_build_object('payment_intent', s.stripe_payment_intent_id, 'amount', 100000,
    'reason', 'requested_by_customer',
    'metadata', jsonb_build_object('shipment_id', s.id, 'order_id', o.order_id,
      'caller_role', case when o.source in ('buyer', 'seller') then o.source else 'system' end,
      'reason', o.reason, 'seguro_share_cents', 0))
  from public.shipments s join public.shipment_cancellation_operations o on o.shipment_id = s.id
  where s.id = pg_temp.mu(p_ship)
$$;

create function pg_temp.start(p_ship integer, p_req jsonb default null, p_loss bigint default 0)
returns jsonb language sql as $$
  select public.fn_start_shipment_cancellation_refund(pg_temp.mu(p_ship),
    (select t from pg_temp.tok where n = p_ship), coalesce(p_req, pg_temp.req(p_ship)), p_loss)
$$;

create function pg_temp.grants(p_sig text) returns text language sql as $$
  select string_agg(r || ':' || has_function_privilege(r, p_sig, 'execute'), ' ' order by r)
  from unnest(array['anon', 'authenticated', 'service_role']) r
$$;

-- 1. Grants and security mode --------------------------------------------------------
select is(pg_temp.grants('public.fn_record_shipment_carrier_cancellation(uuid, uuid, text, boolean, timestamptz)'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_record_shipment_carrier_cancellation');
select is(pg_temp.grants('public.fn_get_shipment_carrier_cancellation(uuid)'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_get_shipment_carrier_cancellation');
select is(pg_temp.grants('public.fn_start_shipment_cancellation_refund(uuid, uuid, jsonb, bigint)'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_start_shipment_cancellation_refund');
select is(pg_temp.grants('public.fn_start_shipment_cancellation(uuid, uuid)'),
  'anon:false authenticated:false service_role:false',
  'no client role, not even service_role, can call the private start, so the carrier guard cannot be bypassed');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_record_shipment_carrier_cancellation', 'fn_get_shipment_carrier_cancellation',
       'fn_start_shipment_cancellation_refund', 'fn_start_shipment_cancellation')),
  'fn_get_shipment_carrier_cancellation:true:search_path="" fn_record_shipment_carrier_cancellation:true:search_path="" '
    || 'fn_start_shipment_cancellation:true:search_path="" fn_start_shipment_cancellation_refund:true:search_path=""',
  'the four functions are SECURITY DEFINER with an empty search_path');

-- Fixtures: one order per shipment.
select pg_temp.prep(7201, 7101);
select pg_temp.prep(7202, 7102);
select pg_temp.prep(7203, 7103, null);
select pg_temp.prep(7204, 7104);
select pg_temp.prep(7205, 7105);
select pg_temp.prep(7206, 7106);
select pg_temp.prep(7207, 7107);
select pg_temp.prep(7208, 7108);
select pg_temp.money_shipment(7209, 7109, 7001, 7002, 'paid');
select pg_temp.prep(7210, 7110);
select pg_temp.prep(7211, 7111);
select pg_temp.prep(7212, 7112);
select pg_temp.prep(7213, 7113);
select pg_temp.money_shipment(7215, 7115, 7001, 7002, 'paid');
select pg_temp.prep(7216, 7116);

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
insert into pg_temp.tok
select n, pg_temp.claim(n) from unnest(array[7101, 7102, 7103, 7104, 7105, 7106, 7107, 7108, 7110, 7111, 7113, 7116]) n;
insert into pg_temp.tok values (7109, pg_temp.claim(7109, 'paid_timeout')), (7115, pg_temp.claim(7115, 'paid_timeout'));

-- The body checks the role itself, so a definer call without service_role claims is refused.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select is(pg_temp.err($$select pg_temp.rec(7106, 'refused')$$), 'UNAUTHORIZED',
  'record: a caller without the service_role claim is UNAUTHORIZED');
select is(pg_temp.err($$select public.fn_get_shipment_carrier_cancellation(pg_temp.mu(7106))$$), 'UNAUTHORIZED',
  'get: a caller without the service_role claim is UNAUTHORIZED');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 2. Recording an outcome -------------------------------------------------------------
create table pg_temp.res (n integer primary key, r jsonb);
insert into pg_temp.res values
  (7101, pg_temp.rec(7101, 'accepted', true, '2026-10-23 10:00:00+00')),
  (7102, pg_temp.rec(7102, 'accepted', false)),
  (7103, pg_temp.rec(7103, 'accepted', false)),
  (7104, pg_temp.rec(7104, 'refused')),
  (7105, pg_temp.rec(7105, 'ambiguous'));

select is((select r - 'carrier_cancellation_recorded_at' from pg_temp.res where n = 7101),
  '{"changed": true, "label_cost_loss_cents": 0, "carrier_balance_returned": true, "carrier_balance_returned_at": "2026-10-23T10:00:00+00:00", "carrier_cancellation_outcome": "accepted"}'::jsonb,
  'record: accepted with the balance returned answers changed with a zero label loss');
select is(pg_temp.carrier(7101), 'accepted|true|true|2026-10-23 10:00:00+00|0',
  'record: accepted with the balance returned stores the outcome, its time, the balance date and a zero loss');
select is(
  (select coalesce(external_started_at::text, '-') || '|' || coalesce(cancellation_loss_cents::text, '-')
   from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(7101)),
  '-|-', 'record: the outcome starts nothing and leaves the Stripe fee loss empty');
select is((select r ->> 'label_cost_loss_cents' from pg_temp.res where n = 7102), '8900',
  'record: accepted without the balance returned answers the label provider cost as the loss');
select is(pg_temp.carrier(7102), 'accepted|true|false|-|8900',
  'record: accepted without the balance returned stores the label provider cost as the loss');
select is(pg_temp.carrier(7103), 'accepted|true|false|-|-',
  'record: accepted without the balance and with an unknown label cost stores a NULL loss, not zero');
select is(pg_temp.carrier(7104) || ' ' || pg_temp.carrier(7105), 'refused|true|-|-|- ambiguous|true|-|-|-',
  'record: refused and ambiguous store the outcome with no balance and no loss');
select is((select r ->> 'changed' || '|' || coalesce(r ->> 'label_cost_loss_cents', '-') from pg_temp.res where n = 7104),
  'true|-', 'record: refused answers changed with no loss');

-- 3. Invalid input and replays ----------------------------------------------------------
create table pg_temp.before (n integer primary key, v text);
insert into pg_temp.before select n, pg_temp.op(n) from unnest(array[7101, 7102, 7106]) n;
select is(
  pg_temp.err($$select pg_temp.rec(7106, 'refused', true)$$) || ',' ||
  pg_temp.err($$select pg_temp.rec(7106, 'ambiguous', null, now())$$) || ',' ||
  pg_temp.err($$select pg_temp.rec(7106, 'accepted', null)$$) || ',' ||
  pg_temp.err($$select pg_temp.rec(7106, 'accepted', false, now())$$) || ',' ||
  pg_temp.err($$select pg_temp.rec(7106, 'cancelled', false)$$) || ',' ||
  pg_temp.err($$select pg_temp.rec(7106, null, false)$$),
  'INVALID_CARRIER_CANCELLATION_OUTCOME,INVALID_CARRIER_CANCELLATION_OUTCOME,INVALID_CARRIER_CANCELLATION_OUTCOME,'
    || 'INVALID_CARRIER_CANCELLATION_OUTCOME,INVALID_CARRIER_CANCELLATION_OUTCOME,INVALID_CARRIER_CANCELLATION_OUTCOME',
  'record: refused or ambiguous with balance input, accepted without a balance flag, a date without a returned balance, '
    || 'and an unknown or NULL outcome are INVALID_CARRIER_CANCELLATION_OUTCOME');
select is(pg_temp.op(7106), (select v from pg_temp.before where n = 7106), 'record: invalid input changes nothing');
select is(pg_temp.rec(7101, 'accepted', true, '2026-10-23 10:00:00+00'),
  (select r || '{"changed": false}' from pg_temp.res where n = 7101),
  'record: an identical replay returns the stored outcome with changed false');
select is(pg_temp.op(7101), (select v from pg_temp.before where n = 7101), 'record: an identical replay changes nothing');
select is(
  pg_temp.err($$select pg_temp.rec(7102, 'refused')$$) || ',' ||
  pg_temp.err($$select pg_temp.rec(7102, 'accepted', true)$$),
  'CARRIER_CANCELLATION_ALREADY_RECORDED,CARRIER_CANCELLATION_ALREADY_RECORDED',
  'record: a different outcome or balance after a recorded one is CARRIER_CANCELLATION_ALREADY_RECORDED');
select is(pg_temp.op(7102), (select v from pg_temp.before where n = 7102), 'record: a different replay keeps the stored outcome');

-- 4. Refusals of the claim and shipment state ----------------------------------------------
update public.shipment_cancellation_operations set claim_expires_at = now() - interval '1 minute'
where shipment_id = pg_temp.mu(7108);
update public.shipments set status = 'shipped' where id = pg_temp.mu(7110);
update public.shipment_cancellation_operations set external_started_at = now() where shipment_id = pg_temp.mu(7111);
insert into pg_temp.before select n, pg_temp.op(n) from unnest(array[7107, 7108, 7109, 7110, 7111]) n;
select is(
  pg_temp.err($$select public.fn_record_shipment_carrier_cancellation(pg_temp.mu(7107), gen_random_uuid(), 'refused')$$) || ',' ||
  pg_temp.err($$select public.fn_record_shipment_carrier_cancellation(pg_temp.mu(7107), null, 'refused')$$) || ',' ||
  pg_temp.err($$select public.fn_record_shipment_carrier_cancellation(pg_temp.mu(7112), gen_random_uuid(), 'refused')$$),
  'STALE_CANCELLATION_CLAIM,STALE_CANCELLATION_CLAIM,STALE_CANCELLATION_CLAIM',
  'record: a wrong token, a NULL token and a shipment without an operation are STALE_CANCELLATION_CLAIM');
select is(pg_temp.err($$select public.fn_record_shipment_carrier_cancellation(gen_random_uuid(), gen_random_uuid(), 'refused')$$),
  'SHIPMENT_NOT_FOUND', 'record: an unknown shipment is SHIPMENT_NOT_FOUND');
select is(pg_temp.err($$select pg_temp.rec(7108, 'refused')$$), 'CANCELLATION_CLAIM_EXPIRED',
  'record: an expired claim is CANCELLATION_CLAIM_EXPIRED');
select is(pg_temp.err($$select pg_temp.rec(7109, 'refused')$$), 'INVALID_CARRIER_CANCELLATION_SOURCE',
  'record: a paid_timeout operation is INVALID_CARRIER_CANCELLATION_SOURCE');
select is(pg_temp.err($$select pg_temp.rec(7110, 'refused')$$), 'SHIPMENT_NOT_CANCELABLE',
  'record: a shipment that is no longer preparing is SHIPMENT_NOT_CANCELABLE');
select is(pg_temp.err($$select pg_temp.rec(7111, 'refused')$$), 'CANCELLATION_EXTERNAL_ALREADY_STARTED',
  'record: an operation whose external call started is CANCELLATION_EXTERNAL_ALREADY_STARTED');
select is(
  (select count(*) from pg_temp.before b where b.n between 7107 and 7111 and b.v is distinct from pg_temp.op(b.n)),
  0::bigint, 'record: every refusal leaves the operation unchanged');

-- 5. Reading the outcome ----------------------------------------------------------------
select is(public.fn_get_shipment_carrier_cancellation(pg_temp.mu(7102)),
  (select jsonb_build_object('carrier_cancellation_outcome', 'accepted',
     'carrier_cancellation_recorded_at', carrier_cancellation_recorded_at, 'carrier_balance_returned', false,
     'carrier_balance_returned_at', null, 'label_cost_loss_cents', 8900, 'review_reason', null,
     'review_required_at', null, 'review_resolution', null, 'review_resolved_at', null, 'review_resolved_by', null,
     'review_resolution_note', null)
   from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(7102)),
  'get: returns the outcome, balance, label loss and the empty review fields');
select is(pg_temp.err($$select public.fn_get_shipment_carrier_cancellation(gen_random_uuid())$$), 'SHIPMENT_NOT_FOUND',
  'get: an unknown shipment is SHIPMENT_NOT_FOUND');
select is(pg_temp.err($$select public.fn_get_shipment_carrier_cancellation(pg_temp.mu(7112))$$),
  'CANCELLATION_OPERATION_NOT_FOUND', 'get: a shipment without an operation is CANCELLATION_OPERATION_NOT_FOUND');

-- 6. The refund start of a preparing timeout needs an accepted outcome -----------------------
insert into pg_temp.before select n, pg_temp.op(n) from unnest(array[7113, 7104, 7105]) n
on conflict (n) do update set v = excluded.v;
select is(pg_temp.err($$select pg_temp.start(7113)$$), 'CARRIER_CANCELLATION_NOT_CONFIRMED',
  'start: a preparing timeout without a carrier outcome is CARRIER_CANCELLATION_NOT_CONFIRMED');
select is(pg_temp.err($$select pg_temp.start(7104)$$) || ',' || pg_temp.err($$select pg_temp.start(7105)$$),
  'CARRIER_CANCELLATION_NOT_CONFIRMED,CARRIER_CANCELLATION_NOT_CONFIRMED',
  'start: a refused or ambiguous carrier outcome is CARRIER_CANCELLATION_NOT_CONFIRMED');
select is(pg_temp.err($$select pg_temp.start(7113, '"not an object"'::jsonb)$$), 'CARRIER_CANCELLATION_NOT_CONFIRMED',
  'start: the carrier guard runs before the refund request is validated');
select is(
  (select count(*) from pg_temp.before b where b.n in (7113, 7104, 7105) and b.v is distinct from pg_temp.op(b.n)),
  0::bigint, 'start: a refused start leaves external_started_at, the refund request and the loss empty');
select pg_temp.rec(7116, 'accepted', true);
select is(pg_temp.err($$select pg_temp.start(7116, '"not an object"'::jsonb)$$), 'INVALID_CANCELLATION_REFUND_REQUEST',
  'start: with an accepted outcome a malformed refund request is still INVALID_CANCELLATION_REFUND_REQUEST');
select is(pg_temp.err($$select pg_temp.start(7116, null, -1)$$), 'INVALID_CANCELLATION_LOSS',
  'start: with an accepted outcome a negative Stripe fee loss is still INVALID_CANCELLATION_LOSS');
select is(pg_temp.start(7102),
  jsonb_build_object('operation_key', 'cancel_shipment_' || pg_temp.mu(7102), 'refund_request', pg_temp.req(7102),
    'cancellation_loss_cents', 0),
  'start: an accepted outcome starts the refund and returns the frozen request');
select is(
  (select (external_started_at is not null)::text || '|' || (refund_request = pg_temp.req(7102))::text || '|'
     || cancellation_loss_cents || '|' || carrier_cancellation_outcome || '|' || label_cost_loss_cents
   from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(7102)),
  'true|true|0|accepted|8900', 'start: the start fence and the request are stored and the carrier outcome and label loss stay');
select is(pg_temp.err($$select pg_temp.start(7115)$$), 'ok', 'start: a paid_timeout refund start does not need a carrier outcome');
select is(
  (select (external_started_at is not null)::text || '|' || coalesce(carrier_cancellation_outcome, '-')
   from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(7115)),
  'true|-', 'start: the paid_timeout start is stored without a carrier outcome');

-- 7. Constraints on the carrier columns ------------------------------------------------------
create function pg_temp.upd(p_set text) returns text language sql as $$
  select pg_temp.chk(format('update public.shipment_cancellation_operations set %s where shipment_id = %L',
    p_set, pg_temp.mu(7106)))
$$;
select is(pg_temp.upd($$carrier_cancellation_outcome = 'cancelled', carrier_cancellation_recorded_at = now()$$),
  'shipment_cancellation_operat_carrier_cancellation_outcome_check', 'check: the outcome is accepted, refused or ambiguous');
select is(pg_temp.upd($$carrier_cancellation_outcome = 'refused'$$),
  'shipment_cancellation_operations_carrier_outcome_recorded', 'check: an outcome needs its recorded time');
select is(pg_temp.upd($$carrier_cancellation_recorded_at = now()$$),
  'shipment_cancellation_operations_carrier_outcome_recorded', 'check: a recorded time needs an outcome');
select is(pg_temp.upd($$carrier_cancellation_outcome = 'accepted', carrier_cancellation_recorded_at = now()$$),
  'shipment_cancellation_operations_carrier_balance_consistent', 'check: an accepted outcome needs the balance flag');
select is(pg_temp.upd($$carrier_cancellation_outcome = 'refused', carrier_cancellation_recorded_at = now(), carrier_balance_returned = false$$),
  'shipment_cancellation_operations_carrier_balance_consistent', 'check: a refused outcome has no balance flag');
select is(pg_temp.upd($$carrier_cancellation_outcome = 'accepted', carrier_cancellation_recorded_at = now(), carrier_balance_returned = false, carrier_balance_returned_at = now()$$),
  'shipment_cancellation_operations_carrier_balance_date', 'check: a balance date needs the balance returned');
select is(pg_temp.upd($$carrier_cancellation_outcome = 'accepted', carrier_cancellation_recorded_at = now(), carrier_balance_returned = true, label_cost_loss_cents = 8900$$),
  'shipment_cancellation_operations_carrier_balance_no_loss', 'check: a returned balance means no label loss');
select is(pg_temp.upd($$carrier_cancellation_outcome = 'accepted', carrier_cancellation_recorded_at = now(), carrier_balance_returned = false, label_cost_loss_cents = -1$$),
  'shipment_cancellation_operations_label_cost_loss_cents_check', 'check: the label loss is not negative');

select * from finish();
rollback;
