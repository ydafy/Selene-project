-- Tracking during a shipment cancellation (#276 T4): once a cancellation
-- operation has external_started_at set (the refund was requested), a carrier
-- scan, fn_mark_shipment_delivered and fn_confirm_shipment_delivery leave the
-- shipment status alone (G_ProgressOp, G_ConfirmOp in
-- docs/formal/shipment-transfer-cancellation/README.md), the first scan that
-- would have moved it is recorded on the operation, and the cancellation can
-- still finish. A live claim without a start is not a guard.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(29);
\ir ../fixtures/money.psql

-- Users: 6001 seller, 6002 buyer.
select pg_temp.money_user(6001);
select pg_temp.money_user(6002);

-- A cancellation operation of p_ship, started (external_started_at set) or only claimed.
create function pg_temp.op_ins(p_ship integer, p_started boolean, p_source text default 'preparing_timeout')
returns void language sql as $$
  insert into public.shipment_cancellation_operations (
    shipment_id, order_id, source, reason, claim_token, claim_expires_at, external_started_at
  )
  select s.id, s.order_id, p_source, 'tracking test', gen_random_uuid(), now() + interval '15 minutes',
    case when p_started then now() end
  from public.shipments s where s.id = pg_temp.mu(p_ship)
$$;

-- The error message of a statement, or 'ok'. The exception block rolls the
-- statement back like a failed call.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

-- A carrier scan of p_ship with no dispute; p_raw keeps each scan distinct.
create function pg_temp.scan(p_ship integer, p_type text, p_transition text, p_raw text) returns jsonb language sql as $$
  select public.fn_record_tracking_event(pg_temp.mu(p_ship), null, p_type::public.shipment_tracking_event_type,
    now() - interval '1 hour', p_raw, 'CDMX', 'test scan', 'dhl', null, null, p_transition::public.order_status_enum)
$$;

create function pg_temp.status(p_ship integer) returns text language sql as $$
  select status::text from public.shipments where id = pg_temp.mu(p_ship)
$$;

-- late_carrier_activity_at is set|its event type.
create function pg_temp.late(p_ship integer) returns text language sql as $$
  select (late_carrier_activity_at is not null)::text || '|' || coalesce(late_carrier_activity_event_type::text, '-')
  from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(p_ship)
$$;

create function pg_temp.delivered(p_ship integer) returns text language sql as $$
  select d.success::text || ':' || coalesce(d.error_message, '-') from public.fn_mark_shipment_delivered(pg_temp.mu(p_ship)) d
$$;

create function pg_temp.confirm(p_ship integer, p_source text) returns text language sql as $$
  select c.success::text || ':' || coalesce(c.error, '-') || ':' || coalesce(c.completion_source, '-')
  from public.fn_confirm_shipment_delivery(pg_temp.mu(p_ship), p_source,
    case when p_source = 'buyer' then pg_temp.mu(6002) end,
    case when p_source = 'buyer' then 'confirm_shipment_' else 'auto_completion_' end || pg_temp.mu(p_ship)) c
$$;

create function pg_temp.grants(p_sig text) returns text language sql as $$
  select string_agg(r || ':' || has_function_privilege(r, p_sig, 'execute'), ' ' order by r)
  from unnest(array['anon', 'authenticated', 'service_role']) r
$$;

-- 1. Grants and security mode --------------------------------------------------------
select is(pg_temp.grants('public.fn_record_tracking_event(uuid, uuid, public.shipment_tracking_event_type, timestamptz, text, text, text, text, uuid, uuid, public.order_status_enum)'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_record_tracking_event');
select is(pg_temp.grants('public.fn_mark_shipment_delivered(uuid)'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_mark_shipment_delivered');
select is(pg_temp.grants('public.fn_confirm_shipment_delivery(uuid, text, uuid, text)'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_confirm_shipment_delivery');
select is(pg_temp.grants('public.fn_list_shipment_late_carrier_activity()'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_list_shipment_late_carrier_activity');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_record_tracking_event', 'fn_mark_shipment_delivered', 'fn_confirm_shipment_delivery',
       'fn_list_shipment_late_carrier_activity')),
  'fn_confirm_shipment_delivery:true:search_path="" fn_list_shipment_late_carrier_activity:true:search_path="" '
    || 'fn_mark_shipment_delivered:true:search_path=public, pg_temp fn_record_tracking_event:true:search_path=public, pg_temp',
  'the four functions are SECURITY DEFINER with a pinned search_path');
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select pg_temp.scan(6101, 'in_transit', 'shipped', 'S0')$$, 'P0001', 'UNAUTHORIZED',
  'record: a caller without the service_role claim is UNAUTHORIZED');
select throws_ok($$select * from public.fn_list_shipment_late_carrier_activity()$$, 'P0001', 'UNAUTHORIZED',
  'list: a caller without the service_role claim is UNAUTHORIZED');
select is(pg_temp.confirm(6109, 'auto'), 'false:SERVICE_ROLE_REQUIRED:-',
  'confirm: a caller without the service_role claim is SERVICE_ROLE_REQUIRED');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- Fixtures: one order per shipment.
select pg_temp.money_shipment(6200 + n, 6100 + n, 6001, 6002, 'preparing') from unnest(array[1, 3, 4, 6, 8]) n;
select pg_temp.money_shipment(6202, 6102, 6001, 6002, 'shipped');
select pg_temp.money_shipment(6207, 6107, 6001, 6002, 'paid');
select pg_temp.money_shipment(6200 + n, 6100 + n, 6001, 6002, 'delivered', interval '3 days') from unnest(array[9, 10]) n;
select pg_temp.op_ins(n, true) from unnest(array[6101, 6102, 6103, 6106, 6109]) n;
select pg_temp.op_ins(6107, true, 'paid_timeout');
select pg_temp.op_ins(n, false) from unnest(array[6104, 6108, 6110]) n;

-- 2. Carrier scans after the refund started -------------------------------------------------
select is(pg_temp.scan(6101, 'in_transit', 'shipped', 'S1') - 'event_id', '{"inserted": true, "shipment_status": "preparing"}'::jsonb,
  'record: a shipped scan after the start is stored and answers the unchanged status');
select is(pg_temp.status(6101), 'preparing', 'record: the preparing shipment does not move to shipped');
select is((select count(*) from public.shipment_tracking_events where shipment_id = pg_temp.mu(6101)), 1::bigint,
  'record: the tracking event is still stored');
select is(pg_temp.late(6101), 'true|in_transit', 'record: the first scan that would have moved the shipment is recorded on the operation');
create table pg_temp.before as
select late_carrier_activity_at from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(6101);
select pg_temp.scan(6101, 'delivered', 'delivered', 'S2');
select is(pg_temp.status(6101) || '|' || pg_temp.late(6101), 'preparing|true|in_transit',
  'record: a later delivered scan moves nothing and keeps the first recorded type');
select is((select late_carrier_activity_at from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(6101)),
  (select late_carrier_activity_at from pg_temp.before), 'record: the first recorded time stays');
select is(pg_temp.scan(6102, 'delivered', 'delivered', 'S3') ->> 'shipment_status', 'shipped',
  'record: a delivered scan does not move a shipped shipment whose refund started');
select is(pg_temp.status(6102) || '|' || pg_temp.late(6102), 'shipped|true|delivered',
  'record: the shipped shipment keeps its status and the scan is recorded');
select pg_temp.scan(6103, 'information', null, 'S4');
select is(pg_temp.late(6103), 'false|-', 'record: a scan without a status transition records no late activity');
select is(pg_temp.err($$select pg_temp.scan(6104, 'in_transit', 'shipped', 'S5')$$) || '|' || pg_temp.status(6104), 'ok|shipped',
  'record: a live claim without a start is not a guard: the scan moves the shipment to shipped');
select is(pg_temp.late(6104), 'false|-', 'record: an operation that has not started records no late activity');

-- 3. Delivery marking and confirmation -----------------------------------------------------------
select is(pg_temp.delivered(6106) || '|' || pg_temp.status(6106), 'false:SHIPMENT_CANCELLATION_OPERATION_ACTIVE|preparing',
  'mark delivered: a preparing shipment whose refund started is refused and stays preparing');
select is(pg_temp.delivered(6107), 'false:SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
  'mark delivered: the started operation is checked before the status of a paid shipment');
select is(pg_temp.delivered(6108) || '|' || pg_temp.status(6108), 'true:-|delivered',
  'mark delivered: a live claim without a start is not a guard');
select is(pg_temp.confirm(6109, 'buyer') || ' ' || pg_temp.confirm(6109, 'auto'),
  'false:SHIPMENT_CANCELLATION_OPERATION_ACTIVE:- false:SHIPMENT_CANCELLATION_OPERATION_ACTIVE:-',
  'confirm: a delivered shipment whose refund started is completed neither by the buyer nor automatically');
select is(pg_temp.status(6109) || '|' || (select count(*) from public.shipment_completion_events where shipment_id = pg_temp.mu(6109)),
  'delivered|0', 'confirm: the refused shipment stays delivered with no completion event');
select is(pg_temp.confirm(6110, 'auto'), 'true:-:auto', 'confirm: a live claim without a start is not a guard');

-- 4. The cancellation still finishes ---------------------------------------------------------
update public.shipment_cancellation_operations
set refund_id = 're_test_' || right(shipment_id::text, 4), refund_status = 'succeeded', refund_status_updated_at = now()
where shipment_id in (pg_temp.mu(6101), pg_temp.mu(6106));
select is(
  (select string_agg(c.success::text || ':' || coalesce(c.error_message, '-'), ',')
   from unnest(array[6101, 6106]) n, public.fn_cancel_shipment(pg_temp.mu(n), 'system', 'tracking test') c)
    || '|' || pg_temp.status(6101) || '|' || pg_temp.status(6106),
  'true:-,true:-|cancelled|cancelled',
  'cancel: after a scan or a refused delivery mid-cancellation, the shipment is cancelled once the refund succeeded');

-- 5. Late activity: constraint and admin list --------------------------------------------------------
select throws_ok(
  format($$update public.shipment_cancellation_operations set late_carrier_activity_at = now(),
    late_carrier_activity_event_type = 'in_transit' where shipment_id = %L$$, pg_temp.mu(6104)),
  '23514', null, 'check: late carrier activity needs a started operation');
update public.shipments set tracking_number = 'TRK6102', carrier = 'dhl' where id = pg_temp.mu(6102);
update public.shipment_cancellation_operations o set late_carrier_activity_at = now() - v.ago
from (values (6101, interval '1 hour'), (6102, interval '2 hours')) v(n, ago) where o.shipment_id = pg_temp.mu(v.n);
select is(
  (select array_agg(l.shipment_id) from public.fn_list_shipment_late_carrier_activity() l where l.seller_id = pg_temp.mu(6001)),
  array[pg_temp.mu(6102), pg_temp.mu(6101)], 'list: operations with late activity, oldest first; one without activity is left out');
select is(
  (select row(l.*)::text from public.fn_list_shipment_late_carrier_activity() l where l.shipment_id = pg_temp.mu(6102)),
  row(pg_temp.mu(6102), pg_temp.mu(6202), pg_temp.mu(6001), 'TRK6102', 'dhl', 'shipped'::public.order_status_enum,
    'preparing_timeout', null::text, now() - interval '2 hours', 'delivered'::public.shipment_tracking_event_type)::text,
  'list: a row carries the shipment, order, seller, tracking, carrier, status, source, refund status and the activity');

select * from finish();
rollback;
