-- Shipment tracking (#277 T12): the webhook and tracking-event dedupe keys,
-- fn_record_tracking_event moving a shipment only forward (preparing ->
-- shipped -> delivered) and never a cancelled one, row-level security on
-- shipment_tracking_events, and the admin
-- acknowledgement of late carrier activity. The behavior during a started
-- cancellation and the late-activity list order are in
-- shipment_cancellation_tracking.test.sql; grants are in function_grants and
-- schema_invariants. Buyer milestone notices are in shipment_milestones.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(36);
\ir ../fixtures/money.psql

-- Users: 12001 seller, 12002 buyer, 12003 admin, 12004 unrelated user,
-- 12005 suspended admin, 12006 second seller, 12007 second buyer.
select pg_temp.money_user(n) from unnest(array[12001, 12002, 12004, 12006, 12007]) n;
select pg_temp.money_user(n, 'admin') from unnest(array[12003, 12005]) n;
update public.profiles_private set status = 'suspended' where id = pg_temp.mu(12005);

-- The error message of a statement, or 'ok'. The exception block rolls the
-- statement back like a failed call.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.mu(p_n), 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "service_role"}', true)
$$;

-- A carrier scan of p_ship; p_raw keeps each scan distinct.
create function pg_temp.scan(
  p_ship integer, p_type text, p_transition text, p_raw text,
  p_at timestamptz default '2026-11-01 10:00:00+00', p_dispute uuid default null
) returns jsonb language sql as $$
  select public.fn_record_tracking_event(pg_temp.mu(p_ship), p_dispute, p_type::public.shipment_tracking_event_type,
    p_at, p_raw, 'CDMX', 'test scan', 'dhl', null, pg_temp.mu(12999), p_transition::public.order_status_enum)
$$;

-- The same scan, answering {"error": <message>} instead of raising.
create function pg_temp.try_scan(p_ship integer, p_type text, p_transition text, p_raw text, p_at timestamptz)
returns jsonb language plpgsql as $$
begin
  return pg_temp.scan(p_ship, p_type, p_transition, p_raw, p_at);
exception when others then
  return jsonb_build_object('error', sqlerrm);
end $$;

-- status|shipped_at|delivered_at of p_ship ('-' for NULL).
create function pg_temp.ship(p_ship integer) returns text language sql as $$
  select status::text || '|' || coalesce(shipped_at::text, '-') || '|' || coalesce(delivered_at::text, '-')
  from public.shipments where id = pg_temp.mu(p_ship)
$$;

create function pg_temp.event_dispute(p_ship integer) returns text language sql as $$
  select string_agg(coalesce(right(dispute_id::text, 5), '-'), ',') from public.shipment_tracking_events where shipment_id = pg_temp.mu(p_ship)
$$;

create function pg_temp.events(p_ship integer) returns bigint language sql as $$
  select count(*) from public.shipment_tracking_events where shipment_id = pg_temp.mu(p_ship)
$$;

-- 1. Ledger keys ------------------------------------------------------------------
insert into internal.webhook_deliveries (provider, delivery_id, event_name, payload_sha256)
values ('envia', 'dlv-12001', 'tracking', 'sha');
select throws_ok(
  $$insert into internal.webhook_deliveries (provider, delivery_id, event_name, payload_sha256)
    values ('envia', 'dlv-12001', 'tracking', 'sha2')$$,
  '23505', null, 'webhook_deliveries: a second delivery with the same provider and delivery id is refused');
select is(pg_temp.err($$insert into internal.webhook_deliveries (provider, delivery_id, event_name, payload_sha256)
    values ('stripe', 'dlv-12001', 'tracking', 'sha')$$), 'ok',
  'webhook_deliveries: the same delivery id under another provider is accepted');

select pg_temp.money_shipment(12200, 12100, 12001, 12002, 'preparing');
insert into public.shipment_tracking_events (shipment_id, event_type, event_at, raw_status)
values (pg_temp.mu(12100), 'information', '2026-11-01 09:00:00+00', 'RAW0');
select throws_ok(
  format($$insert into public.shipment_tracking_events (shipment_id, event_type, event_at, raw_status)
    values (%L, 'information', '2026-11-01 09:00:00+00', 'RAW0')$$, pg_temp.mu(12100)),
  '23505', null, 'dedupe key: an event equal in shipment, raw status and time, with NULL dispute and location, is a duplicate');
select is(pg_temp.err(format($$insert into public.shipment_tracking_events (shipment_id, event_type, event_at, raw_status, location)
    values (%L, 'information', '2026-11-01 09:00:00+00', 'RAW0', 'MTY')$$, pg_temp.mu(12100))), 'ok',
  'dedupe key: the same event at another location is a new event');

-- 2. fn_record_tracking_event -------------------------------------------------------
-- 12101 preparing, 12102 shipped, 12103 cancelled, 12104 delivered,
-- 12105 preparing (skipped transition), 12106 shipped with a dispute,
-- 12107 preparing (scan without a transition), 12108 of the second seller and buyer.
select pg_temp.money_shipment(12201, 12101, 12001, 12002, 'preparing');
select pg_temp.money_shipment(12202, 12102, 12001, 12002, 'shipped');
select pg_temp.money_shipment(12203, 12103, 12001, 12002, 'cancelled');
select pg_temp.money_shipment(12204, 12104, 12001, 12002, 'delivered', interval '2 days');
select pg_temp.money_shipment(12205, 12105, 12001, 12002, 'preparing');
select pg_temp.money_shipment(12206, 12106, 12001, 12002, 'shipped');
select pg_temp.money_shipment(12207, 12107, 12001, 12002, 'preparing');
select pg_temp.money_shipment(12208, 12108, 12006, 12007, 'preparing');
select pg_temp.money_dispute(12301, 12106);
create table pg_temp.delivered_before as
select delivered_at from public.shipments where id = pg_temp.mu(12104);
select pg_temp.as_service();

select throws_ok($$select public.fn_record_tracking_event(gen_random_uuid(), null, 'in_transit', now(), 'X', null, null, null,
    null, null, 'shipped')$$, 'P0001', 'SHIPMENT_NOT_FOUND', 'record: an unknown shipment is SHIPMENT_NOT_FOUND');

create table pg_temp.first_scan as
select pg_temp.scan(12101, 'in_transit', 'shipped', 'R1', '2026-11-01 10:00:00+00') as r;
select is((select r - 'event_id' from pg_temp.first_scan), '{"inserted": true, "shipment_status": "shipped"}'::jsonb,
  'record: a shipped scan on a preparing shipment is stored and answers shipped');
select is(pg_temp.ship(12101), 'shipped|2026-11-01 10:00:00+00|-',
  'record: preparing moves to shipped with shipped_at set to the event time');
select is(
  (select row(e.id, e.dispute_id, e.event_type, e.event_at, e.raw_status, e.location, e.status_description,
     e.carrier_name, e.webhook_delivery_id, e.polling_run_id)::text
   from public.shipment_tracking_events e where e.shipment_id = pg_temp.mu(12101)),
  row((select (r ->> 'event_id')::uuid from pg_temp.first_scan), null::uuid,
    'in_transit'::public.shipment_tracking_event_type, '2026-11-01 10:00:00+00'::timestamptz, 'R1', 'CDMX',
    'test scan', 'dhl', null::uuid, pg_temp.mu(12999))::text,
  'record: the stored event carries every field it was given and its id is returned');
select is(pg_temp.try_scan(12101, 'in_transit', 'shipped', 'R1', '2026-11-01 10:00:00+00')::text
    || '|' || pg_temp.events(12101) || '|' || pg_temp.ship(12101),
  '{"inserted": false, "shipment_status": "shipped"}|1|shipped|2026-11-01 10:00:00+00|-',
  'record: a repeated event is a no-op that answers the current status');

select is(pg_temp.scan(12102, 'delivered', 'delivered', 'R2', '2026-11-02 12:00:00+00') ->> 'shipment_status'
    || '|' || pg_temp.ship(12102),
  'delivered|delivered|-|2026-11-02 12:00:00+00',
  'record: a delivered scan moves shipped to delivered with delivered_at set to the event time');
select is((pg_temp.scan(12103, 'in_transit', 'shipped', 'R3') - 'event_id')::text || '|' || pg_temp.ship(12103),
  '{"inserted": true, "shipment_status": "cancelled"}|cancelled|-|-',
  'record: a scan on a cancelled shipment is stored and does not move it');
select is(pg_temp.scan(12104, 'in_transit', 'shipped', 'R4') ->> 'shipment_status' || '|'
    || ((select delivered_at from public.shipments where id = pg_temp.mu(12104))
        = (select delivered_at from pg_temp.delivered_before))::text,
  'delivered|true', 'record: a shipped scan never moves a delivered shipment back');
select is(pg_temp.scan(12105, 'delivered', 'delivered', 'R5') ->> 'shipment_status' || '|' || pg_temp.ship(12105),
  'preparing|preparing|-|-', 'record: a delivered scan does not skip a preparing shipment to delivered');
select is(pg_temp.scan(12106, 'delivered', 'delivered', 'R6', '2026-11-02 12:00:00+00', pg_temp.mu(12301)) ->> 'shipment_status'
    || '|' || pg_temp.ship(12106)
    || '|' || pg_temp.event_dispute(12106),
  'shipped|shipped|-|-|12301', 'record: a dispute scan is stored with its dispute and does not move the shipment');
select is(pg_temp.scan(12107, 'information', null, 'R7') ->> 'shipment_status' || '|' || pg_temp.ship(12107),
  'preparing|preparing|-|-', 'record: a scan without a transition does not move the shipment');
select pg_temp.scan(12108, 'information', null, 'R8');

-- 3. Row-level security on shipment_tracking_events --------------------------------
-- Events: 12101 (buyer 12002, seller 12001) and 12108 (buyer 12007, seller 12006).
create function pg_temp.visible() returns text language sql as $$
  select coalesce(string_agg(right(shipment_id::text, 5), ',' order by shipment_id), '')
  from public.shipment_tracking_events where shipment_id in (pg_temp.mu(12101), pg_temp.mu(12108))
$$;
select pg_temp.as_user(12002);
set local role authenticated;
select is(pg_temp.visible(), '12101', 'rls: the buyer reads the events of their shipment only');
reset role;
select pg_temp.as_user(12006);
set local role authenticated;
select is(pg_temp.visible(), '12108', 'rls: the seller reads the events of their shipment only');
reset role;
select pg_temp.as_user(12003);
set local role authenticated;
select is(pg_temp.visible(), '12101,12108', 'rls: an admin reads every shipment''s events');
reset role;
select pg_temp.as_user(12004);
set local role authenticated;
select is(pg_temp.visible(), '', 'rls: an unrelated user reads no event');
reset role;
select results_eq(
  $$select cmd::text collate "default", roles::text collate "default" from pg_policies where schemaname = 'public' and tablename = 'shipment_tracking_events'$$,
  $$values ('SELECT', '{authenticated}')$$,
  'rls: shipment_tracking_events has one policy, SELECT for authenticated, and no client write policy');
select is(
  (select string_agg(c.relname || ':' || c.relrowsecurity, ' ' order by c.relname) from pg_class c
   where c.oid in ('public.shipment_tracking_events'::regclass, 'internal.webhook_deliveries'::regclass))
    || ' policies:' || (select count(*) from pg_policies where schemaname = 'internal' and tablename = 'webhook_deliveries'),
  'shipment_tracking_events:true webhook_deliveries:true policies:0',
  'rls: both ledgers have RLS on, and webhook_deliveries has no policy');

-- 5. Acknowledging late carrier activity ----------------------------------------------------
-- 12111 started operation with late activity (2 h ago), 12114 the same (1 h ago),
-- 12112 started operation without late activity, 12113 no operation.
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.money_shipment(12210 + n, 12110 + n, 12001, 12002, 'preparing') from unnest(array[1, 2, 3, 4]) n;
insert into public.shipment_cancellation_operations (
  shipment_id, order_id, source, reason, claim_token, claim_expires_at, external_started_at
)
select s.id, s.order_id, 'preparing_timeout', 'ack test', gen_random_uuid(), now() + interval '15 minutes', now()
from public.shipments s where s.id in (pg_temp.mu(12111), pg_temp.mu(12112), pg_temp.mu(12114));
update public.shipment_cancellation_operations o
set late_carrier_activity_at = now() - v.ago, late_carrier_activity_event_type = 'in_transit'
from (values (12111, interval '2 hours'), (12114, interval '1 hour')) v(n, ago)
where o.shipment_id = pg_temp.mu(v.n);

create function pg_temp.ack(p_ship integer, p_admin uuid, p_note text) returns jsonb language sql as $$
  select public.fn_acknowledge_shipment_late_carrier_activity(pg_temp.mu(p_ship), p_admin, p_note)
$$;
-- The same call, answering {"error": <message>} instead of raising.
create function pg_temp.try_ack(p_ship integer, p_admin uuid, p_note text) returns jsonb language plpgsql as $$
begin
  return pg_temp.ack(p_ship, p_admin, p_note);
exception when others then
  return jsonb_build_object('error', sqlerrm);
end $$;
-- The three acknowledgement columns of p_ship.
create function pg_temp.ack_cols(p_ship integer) returns text language sql as $$
  select coalesce(late_carrier_activity_acknowledged_at::text, '-') || '|' || coalesce(late_carrier_activity_acknowledged_by::text, '-')
    || '|' || coalesce(late_carrier_activity_acknowledged_note, '-')
  from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(p_ship)
$$;
-- The operation without the acknowledgement columns, its shipment and its order.
create function pg_temp.ack_rest(p_ship integer) returns text language sql as $$
  select (to_jsonb(o) - 'late_carrier_activity_acknowledged_at' - 'late_carrier_activity_acknowledged_by'
           - 'late_carrier_activity_acknowledged_note')::text
    || to_jsonb(s)::text || to_jsonb(r)::text
  from public.shipment_cancellation_operations o
  join public.shipments s on s.id = o.shipment_id
  join public.orders r on r.id = s.order_id
  where o.shipment_id = pg_temp.mu(p_ship)
$$;
create table pg_temp.rest_before as select pg_temp.ack_rest(12111) as v;

select pg_temp.as_user(12003);
select is(pg_temp.err($$select pg_temp.ack(12111, pg_temp.mu(12003), 'seen')$$), 'UNAUTHORIZED',
  'ack: a caller without the service_role claim is UNAUTHORIZED');
select pg_temp.as_service();
select is(pg_temp.err($$select pg_temp.ack(12111, null, 'seen')$$)
    || ' ' || pg_temp.err($$select pg_temp.ack(12111, pg_temp.mu(12004), 'seen')$$)
    || ' ' || pg_temp.err($$select pg_temp.ack(12111, pg_temp.mu(12005), 'seen')$$),
  'ADMIN_REQUIRED ADMIN_REQUIRED ADMIN_REQUIRED',
  'ack: a NULL admin, a plain user and a suspended admin are ADMIN_REQUIRED');
select is(pg_temp.err($$select pg_temp.ack(12111, pg_temp.mu(12003), null)$$)
    || ' ' || pg_temp.err($$select pg_temp.ack(12111, pg_temp.mu(12003), '   ')$$)
    || ' ' || pg_temp.err($$select pg_temp.ack(12111, pg_temp.mu(12003), repeat('x', 201))$$),
  'INVALID_ACKNOWLEDGEMENT_NOTE INVALID_ACKNOWLEDGEMENT_NOTE INVALID_ACKNOWLEDGEMENT_NOTE',
  'ack: a NULL, blank or 201-character note is INVALID_ACKNOWLEDGEMENT_NOTE');
select throws_ok($$select public.fn_acknowledge_shipment_late_carrier_activity(gen_random_uuid(), pg_temp.mu(12003), 'seen')$$,
  'P0001', 'SHIPMENT_NOT_FOUND', 'ack: an unknown shipment is SHIPMENT_NOT_FOUND');
select is(pg_temp.err($$select pg_temp.ack(12113, pg_temp.mu(12003), 'seen')$$)
    || ' ' || pg_temp.err($$select pg_temp.ack(12112, pg_temp.mu(12003), 'seen')$$),
  'LATE_CARRIER_ACTIVITY_NOT_FOUND LATE_CARRIER_ACTIVITY_NOT_FOUND',
  'ack: a shipment without an operation, or whose operation has no late activity, is LATE_CARRIER_ACTIVITY_NOT_FOUND');
select is(pg_temp.ack_cols(12111) || ' ' || pg_temp.ack_cols(12112), '-|-|- -|-|-',
  'ack: every refusal leaves the acknowledgement columns empty');

create table pg_temp.ack1 as select pg_temp.try_ack(12111, pg_temp.mu(12003), '  ' || repeat('n', 200) || '  ') as r;
select is((select r - 'acknowledged_at' from pg_temp.ack1),
  jsonb_build_object('acknowledged_by', pg_temp.mu(12003), 'acknowledged_note', repeat('n', 200), 'already_acknowledged', false),
  'ack: a 200-character note after trimming is accepted; the answer names the admin and the trimmed note');
select is(pg_temp.ack_cols(12111),
  (select (r ->> 'acknowledged_at')::timestamptz::text from pg_temp.ack1) || '|' || pg_temp.mu(12003) || '|' || repeat('n', 200),
  'ack: the time, admin and trimmed note are stored');
select is(pg_temp.ack_rest(12111), (select v from pg_temp.rest_before),
  'ack: nothing else changes on the operation, the shipment or the order');
select is((select r from pg_temp.ack1) - 'already_acknowledged' || '{"already_acknowledged": true}'::jsonb,
  pg_temp.try_ack(12111, pg_temp.mu(12003), 'second note'),
  'ack: a repeat returns the stored acknowledgement and already_acknowledged true');
select is(pg_temp.ack_cols(12111),
  (select (r ->> 'acknowledged_at')::timestamptz::text from pg_temp.ack1) || '|' || pg_temp.mu(12003) || '|' || repeat('n', 200),
  'ack: a repeat keeps the first acknowledgement');
select is(
  (select array_agg(right(l.shipment_id::text, 5) order by l.late_carrier_activity_at) from public.fn_list_shipment_late_carrier_activity() l
   where l.shipment_id in (pg_temp.mu(12111), pg_temp.mu(12114))),
  array['12114'], 'list: an acknowledged operation is no longer listed');

reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  format($$update public.shipment_cancellation_operations set late_carrier_activity_acknowledged_at = now()
    where shipment_id = %L$$, pg_temp.mu(12114)),
  '23514', 'new row for relation "shipment_cancellation_operations" violates check constraint "shipment_cancellation_operations_late_activity_ack_recorded"',
  'check: the acknowledgement time, admin and note are set together');
select throws_ok(
  format($$update public.shipment_cancellation_operations set late_carrier_activity_acknowledged_at = now(),
    late_carrier_activity_acknowledged_by = %L, late_carrier_activity_acknowledged_note = 'x' where shipment_id = %L$$,
    pg_temp.mu(12003), pg_temp.mu(12112)),
  '23514', 'new row for relation "shipment_cancellation_operations" violates check constraint "shipment_cancellation_operations_late_activity_ack_after_activi"',
  'check: an acknowledgement needs recorded late activity');
select throws_ok(
  format($$update public.shipment_cancellation_operations set late_carrier_activity_acknowledged_at = now(),
    late_carrier_activity_acknowledged_by = %L, late_carrier_activity_acknowledged_note = ' x' where shipment_id = %L$$,
    pg_temp.mu(12003), pg_temp.mu(12114)),
  '23514', 'new row for relation "shipment_cancellation_operations" violates check constraint "shipment_cancellation_operations_late_activity_ack_note_format"',
  'check: a stored note is trimmed');

select * from finish();
rollback;
