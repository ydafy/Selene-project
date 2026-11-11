-- Buyer shipment milestone notices (#277 T12): fn_record_tracking_event
-- notifies the buyer only on the status it moves (shipped -> shipment.in_transit,
-- delivered -> shipment.delivered), never for a shipment whose cancellation
-- refund started or for a dispute scan; fn_mark_shipment_delivered sends the
-- delivered notice; fn_notify_shipment_milestone writes one buyer notice per
-- shipment and kind, linked to the shipment; both kinds are pushed to the buyer
-- on the orders channel. Grants are in function_grants.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(14);
\ir ../fixtures/money.psql

-- Users: 13001 seller, 13002 buyer.
select pg_temp.money_user(13001);
select pg_temp.money_user(13002);

-- 13101 preparing, 13102 shipped, 13103 preparing with a started cancellation
-- refund, 13104 shipped with an open dispute, 13105 in dispute status,
-- 13106 shipped (marked delivered), 13107 shipped (helper calls).
select pg_temp.money_shipment(13201, 13101, 13001, 13002, 'preparing');
select pg_temp.money_shipment(13202, 13102, 13001, 13002, 'shipped');
select pg_temp.money_shipment(13203, 13103, 13001, 13002, 'preparing');
select pg_temp.money_shipment(13204, 13104, 13001, 13002, 'shipped');
select pg_temp.money_shipment(13205, 13105, 13001, 13002, 'dispute');
select pg_temp.money_shipment(13206, 13106, 13001, 13002, 'shipped');
select pg_temp.money_shipment(13207, 13107, 13001, 13002, 'shipped');
select pg_temp.money_dispute(13301, 13104);
insert into public.shipment_cancellation_operations (
  shipment_id, order_id, source, reason, claim_token, claim_expires_at, external_started_at
)
select s.id, s.order_id, 'preparing_timeout', 'milestone test', gen_random_uuid(), now() + interval '15 minutes', now()
from public.shipments s where s.id = pg_temp.mu(13103);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

create function pg_temp.scan(p_ship integer, p_type text, p_transition text, p_raw text, p_dispute uuid default null)
returns jsonb language sql as $$
  select public.fn_record_tracking_event(pg_temp.mu(p_ship), p_dispute, p_type::public.shipment_tracking_event_type,
    now() - interval '1 hour', p_raw, 'CDMX', 'test scan', 'dhl', null, null, p_transition::public.order_status_enum)
$$;

-- Every milestone notice of p_ship, one line each:
-- user|kind|key|payload|type|title|message|link.
create function pg_temp.notices(p_ship integer) returns text language sql as $$
  select coalesce(string_agg(concat_ws('|', user_id, event_kind, source_event_key, event_payload::text, type, title,
    message, action_path), E'\n' order by event_kind), '')
  from public.notifications
  where event_kind in ('shipment.in_transit', 'shipment.delivered')
    and event_payload ->> 'shipment_id' = pg_temp.mu(p_ship)::text
$$;
-- The notice fn_notify_shipment_milestone should write for p_ship and p_kind.
create function pg_temp.expected(p_ship integer, p_order integer, p_kind text) returns text language sql as $$
  select concat_ws('|', pg_temp.mu(13002), p_kind, p_kind || ':' || pg_temp.mu(p_ship),
    jsonb_build_object('order_id', pg_temp.mu(p_order), 'shipment_id', pg_temp.mu(p_ship), 'recipient_role', 'buyer')::text,
    case p_kind when 'shipment.in_transit' then 'info' else 'success' end,
    case p_kind when 'shipment.in_transit' then 'Tu envío va en camino' else 'Tu envío fue entregado' end,
    case p_kind when 'shipment.in_transit'
      then 'La paquetería ya lleva un envío de tu pedido. Puedes seguirlo desde tu pedido.'
      else 'Revisa tus productos. Tienes 48 horas desde la entrega para reportar un problema.' end,
    '/profile/orders/' || pg_temp.mu(p_order) || '?shipment_id=' || pg_temp.mu(p_ship))
$$;
create function pg_temp.count_of(p_ship integer) returns bigint language sql as $$
  select count(*) from public.notifications
  where event_kind in ('shipment.in_transit', 'shipment.delivered')
    and event_payload ->> 'shipment_id' = pg_temp.mu(p_ship)::text
$$;

-- 1. Carrier scans -----------------------------------------------------------------
select pg_temp.scan(13101, 'in_transit', 'shipped', 'M1');
select is(pg_temp.notices(13101), pg_temp.expected(13101, 13201, 'shipment.in_transit'),
  'scan: a shipped scan on a preparing shipment writes exactly one in-transit notice to the buyer, linked to the shipment');
select pg_temp.scan(13102, 'delivered', 'delivered', 'M2');
select is(pg_temp.notices(13102), pg_temp.expected(13102, 13202, 'shipment.delivered'),
  'scan: a delivered scan on a shipped shipment writes exactly one delivered notice to the buyer');
select pg_temp.scan(13103, 'in_transit', 'shipped', 'M3');
select is(pg_temp.count_of(13103), 0::bigint,
  'scan: a shipment whose cancellation refund started gets no milestone notice');
select pg_temp.scan(13104, 'delivered', 'delivered', 'M4', pg_temp.mu(13301));
select is(pg_temp.count_of(13104), 0::bigint, 'scan: a dispute scan writes no milestone notice');
select pg_temp.scan(13105, 'delivered', 'delivered', 'M5');
select is(pg_temp.count_of(13105), 0::bigint, 'scan: a shipment in dispute status gets no milestone notice');

-- 2. fn_mark_shipment_delivered ----------------------------------------------------------------
select is((select d.success::text || ':' || coalesce(d.error_message, '-') from public.fn_mark_shipment_delivered(pg_temp.mu(13106)) d)
    || E'\n' || pg_temp.notices(13106),
  'true:-' || E'\n' || pg_temp.expected(13106, 13206, 'shipment.delivered'),
  'mark delivered: marking a shipped shipment delivered writes exactly one delivered notice to the buyer');

-- 3. fn_notify_shipment_milestone ------------------------------------------------------------------
select throws_ok(format($$select public.fn_notify_shipment_milestone(%L, 'shipment.cancelled')$$, pg_temp.mu(13107)),
  'P0001', 'INVALID_SHIPMENT_MILESTONE', 'helper: a kind other than the two milestones is INVALID_SHIPMENT_MILESTONE');
select throws_ok(format($$select public.fn_notify_shipment_milestone(%L, null)$$, pg_temp.mu(13107)),
  'P0001', 'INVALID_SHIPMENT_MILESTONE', 'helper: a NULL kind is INVALID_SHIPMENT_MILESTONE');
select throws_ok($$select public.fn_notify_shipment_milestone(gen_random_uuid(), 'shipment.delivered')$$,
  'P0001', 'SHIPMENT_NOT_FOUND', 'helper: an unknown shipment is SHIPMENT_NOT_FOUND');
select public.fn_notify_shipment_milestone(pg_temp.mu(13107), 'shipment.in_transit');
select public.fn_notify_shipment_milestone(pg_temp.mu(13107), 'shipment.in_transit');
select public.fn_notify_shipment_milestone(pg_temp.mu(13107), 'shipment.delivered');
select is(pg_temp.notices(13107),
  pg_temp.expected(13107, 13207, 'shipment.delivered') || E'\n' || pg_temp.expected(13107, 13207, 'shipment.in_transit'),
  'helper: one buyer notice per shipment and kind; a repeat writes nothing');
select public.fn_notify_shipment_milestone(pg_temp.mu(13102), 'shipment.delivered');
select is(pg_temp.count_of(13102), 1::bigint,
  'helper: the delivered notice a scan already wrote is not written again');
select is((select count(*) from public.notifications
   where user_id = pg_temp.mu(13001) and event_kind in ('shipment.in_transit', 'shipment.delivered')), 0::bigint,
  'no milestone notice reaches the seller');
select is((select count(*) from public.notifications
   where user_id = pg_temp.mu(13002) and event_kind in ('shipment.in_transit', 'shipment.delivered')), 5::bigint,
  'the buyer has exactly the five milestone notices written above');

-- 4. Push policy ---------------------------------------------------------------------------------
select results_eq(
  $$select event_kind, recipient_role, channel from public.push_event_policy
    where event_kind in ('shipment.in_transit', 'shipment.delivered') order by event_kind$$,
  $$values ('shipment.delivered', 'buyer', 'orders'), ('shipment.in_transit', 'buyer', 'orders')$$,
  'push: both milestone kinds are pushed to the buyer only, on the orders channel');

select * from finish();
rollback;
