-- Opening a shipment dispute (#277 T9): fn_open_shipment_dispute is
-- service-role only, refuses in a fixed order without writing, and inserts one
-- open dispute with the seller taken from the shipment; the dispute.opened
-- trigger accepts only a service-role insert of an open dispute whose order,
-- shipment, buyer and seller match, and writes one keyed notice to the seller;
-- the _as_admin resolution functions need an admin actor.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(31);
\ir ../fixtures/money.psql

-- Users: 9101 seller, 9102 buyer, 9103 another user.
select pg_temp.money_user(9101);
select pg_temp.money_user(9102);
select pg_temp.money_user(9103);

-- A cancellation operation on shipment p_ship, started at the carrier or not.
create function pg_temp.t9_operation(p_ship integer, p_started boolean) returns void language sql as $$
  insert into public.shipment_cancellation_operations (
    shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at, external_started_at
  )
  select s.id, s.order_id, 'buyer', pg_temp.mu(9102), 'dispute test', gen_random_uuid(),
    now() + interval '15 minutes', case when p_started then now() end
  from public.shipments s where s.id = pg_temp.mu(p_ship)
$$;

-- The shipments 9300-9399 and their disputes, to prove a refusal wrote nothing.
create function pg_temp.t9_sig() returns text language sql as $$
  select coalesce((
      select string_agg(s.id::text || ':' || s.status::text || ':' || coalesce(s.updated_at::text, '-')
        || ':' || coalesce(s.delivered_at::text, '-'), ',' order by s.id)
      from public.shipments s where s.id between pg_temp.mu(9300) and pg_temp.mu(9399)), '')
    || '#' || coalesce((
      select string_agg(d.id::text || ':' || d.status::text || ':' || coalesce(d.updated_at::text, '-'), ',' order by d.id)
      from public.disputes d where d.shipment_id between pg_temp.mu(9300) and pg_temp.mu(9399)), '')
$$;

-- fn_open_shipment_dispute for buyer, order and shipment numbers: 'opened',
-- dispute_id:error_code or the raised error, then whether shipments and
-- disputes changed.
create function pg_temp.t9_open(p_buyer integer, p_order integer, p_ship integer) returns text language plpgsql as $$
declare
  v_before text := pg_temp.t9_sig();
  r record;
begin
  begin
    select * into r from public.fn_open_shipment_dispute(
      pg_temp.mu(p_buyer), pg_temp.mu(p_order), pg_temp.mu(p_ship),
      'damaged', 'T9 dispute', '{"images": ["t9.png"]}'::jsonb);
  exception when others then
    return 'raised:' || sqlstate || '|' || case when pg_temp.t9_sig() = v_before then 'unchanged' else 'changed' end;
  end;
  return case when r.dispute_id is not null and r.error_code is null then 'opened'
              else coalesce(r.dispute_id::text, '-') || ':' || coalesce(r.error_code, '-') end
    || '|' || case when pg_temp.t9_sig() = v_before then 'unchanged' else 'changed' end;
end $$;

-- Each refusal case also fails every later check, so the first refusal wins.
-- 9301: delivered 72 h ago, started cancellation, existing dispute.
select pg_temp.money_shipment(9201, 9301, 9101, 9102, 'delivered', interval '72 hours');
select pg_temp.t9_operation(9301, true);
select pg_temp.money_dispute(9401, 9301);
-- 9302: cancelled, started cancellation, existing dispute.
select pg_temp.money_shipment(9202, 9302, 9101, 9102, 'cancelled');
select pg_temp.t9_operation(9302, true);
select pg_temp.money_dispute(9402, 9302);
-- 9303: shipped, started cancellation, existing dispute.
select pg_temp.money_shipment(9203, 9303, 9101, 9102, 'shipped');
select pg_temp.t9_operation(9303, true);
select pg_temp.money_dispute(9403, 9303);
-- 9304: shipped, cancellation not started, existing dispute.
select pg_temp.money_shipment(9204, 9304, 9101, 9102, 'shipped');
select pg_temp.t9_operation(9304, false);
select pg_temp.money_dispute(9404, 9304);
-- Openable: 9305 shipped, 9306 delivered exactly 48 h ago, 9308 shipped with
-- an old delivered_at, 9309 cancellation not started. 9307 is 1 µs past 48 h.
select pg_temp.money_shipment(9205, 9305, 9101, 9102, 'shipped');
select pg_temp.money_shipment(9206, 9306, 9101, 9102, 'delivered', interval '48 hours');
select pg_temp.money_shipment(9207, 9307, 9101, 9102, 'delivered', interval '48 hours 1 microsecond');
select pg_temp.money_shipment(9208, 9308, 9101, 9102, 'shipped', interval '72 hours');
select pg_temp.money_shipment(9209, 9309, 9101, 9102, 'shipped');
select pg_temp.t9_operation(9309, false);
-- Statuses a dispute cannot open from, one shipment each.
select pg_temp.money_shipment(9210 + i::integer, 9310 + i::integer, 9101, 9102, st::public.order_status_enum)
from unnest(array['pending', 'paid', 'preparing', 'completed', 'cancelled', 'dispute', 'refunded']) with ordinality as t(st, i);

-- 1. fn_open_shipment_dispute ------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "f0000000-0000-4000-8000-000000009102", "role": "authenticated"}', true);
select throws_ok(
  $$select * from public.fn_open_shipment_dispute(pg_temp.mu(9102), pg_temp.mu(9205), pg_temp.mu(9305), 'damaged', 'x', '{}'::jsonb)$$,
  '42501', 'fn_open_shipment_dispute is service-role only',
  'open: a caller that is not service_role is refused');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(pg_temp.t9_open(9102, 9201, 9399), '-:SHIPMENT_NOT_FOUND|unchanged',
  'open: an unknown shipment is SHIPMENT_NOT_FOUND and writes nothing');
select is(pg_temp.t9_open(9103, 9202, 9301), '-:SHIPMENT_ORDER_MISMATCH|unchanged',
  'open: another order is SHIPMENT_ORDER_MISMATCH before the buyer check, and writes nothing');
select is(pg_temp.t9_open(9103, 9201, 9301), '-:ORDER_BUYER_MISMATCH|unchanged',
  'open: another buyer is ORDER_BUYER_MISMATCH before the window check, and writes nothing');
select is(pg_temp.t9_open(9103, 9202, 9302), '-:ORDER_BUYER_MISMATCH|unchanged',
  'open: another buyer is ORDER_BUYER_MISMATCH before the status check');
select is(pg_temp.t9_open(9102, 9202, 9302), '-:DISPUTE_STATUS_NOT_ALLOWED:cancelled|unchanged',
  'open: a cancelled shipment is DISPUTE_STATUS_NOT_ALLOWED before the cancellation check, and writes nothing');
select is(
  (select string_agg(pg_temp.t9_open(9102, 9210 + i, 9310 + i), ' ' order by i)
   from generate_series(1, 7) as i),
  '-:DISPUTE_STATUS_NOT_ALLOWED:pending|unchanged -:DISPUTE_STATUS_NOT_ALLOWED:paid|unchanged '
  || '-:DISPUTE_STATUS_NOT_ALLOWED:preparing|unchanged -:DISPUTE_STATUS_NOT_ALLOWED:completed|unchanged '
  || '-:DISPUTE_STATUS_NOT_ALLOWED:cancelled|unchanged -:DISPUTE_STATUS_NOT_ALLOWED:dispute|unchanged '
  || '-:DISPUTE_STATUS_NOT_ALLOWED:refunded|unchanged',
  'open: only shipped and delivered shipments are allowed; the code names the status');
select is(pg_temp.t9_open(9102, 9201, 9301), '-:DISPUTE_WINDOW_EXPIRED|unchanged',
  'open: delivered 72 h ago is DISPUTE_WINDOW_EXPIRED before the cancellation check, and writes nothing');
select is(pg_temp.t9_open(9102, 9207, 9307), '-:DISPUTE_WINDOW_EXPIRED|unchanged',
  'open: delivered 48 h and 1 µs ago is DISPUTE_WINDOW_EXPIRED');
select is(pg_temp.t9_open(9102, 9203, 9303), '-:SHIPMENT_CANCELLATION_OPERATION_ACTIVE|unchanged',
  'open: a started cancellation is SHIPMENT_CANCELLATION_OPERATION_ACTIVE before the existing dispute, and writes nothing');
select is(pg_temp.t9_open(9102, 9204, 9304), '-:DISPUTE_ALREADY_EXISTS|unchanged',
  'open: a shipment with a dispute is DISPUTE_ALREADY_EXISTS and writes nothing');
select is(pg_temp.t9_open(9102, 9206, 9306), 'opened|changed',
  'open: delivered exactly 48 h ago is still inside the window');
select is(pg_temp.t9_open(9102, 9208, 9308), 'opened|changed',
  'open: the window applies only to a delivered shipment');
select is(pg_temp.t9_open(9102, 9209, 9309), 'opened|changed',
  'open: a cancellation that has not started does not block the dispute');
select is(pg_temp.t9_open(9102, 9205, 9305), 'opened|changed',
  'open: a shipped shipment opens a dispute');
reset role;

select is(
  (select string_agg(d.order_id || '|' || d.shipment_id || '|' || d.buyer_id || '|' || d.seller_id || '|'
     || d.reason || '|' || d.description || '|' || d.buyer_evidence::text || '|' || d.status, ' ')
   from public.disputes d where d.shipment_id = pg_temp.mu(9305)),
  pg_temp.mu(9205) || '|' || pg_temp.mu(9305) || '|' || pg_temp.mu(9102) || '|' || pg_temp.mu(9101)
    || '|damaged|T9 dispute|{"images": ["t9.png"]}|open',
  'open: one open dispute with the order, shipment, buyer, the shipment''s seller, reason, description and evidence');
select is(
  (select string_agg(n.user_id || '|' || n.source_event_key, ' ')
   from public.notifications n join public.disputes d on n.source_event_key = 'dispute.opened:' || d.id
   where d.shipment_id = pg_temp.mu(9305)),
  pg_temp.mu(9101) || '|dispute.opened:' || (select id from public.disputes where shipment_id = pg_temp.mu(9305)),
  'open: the new dispute notifies the seller once');

-- 2. dispute.opened trigger ----------------------------------------------------------
select pg_temp.money_shipment(9220, 9320, 9101, 9102, 'shipped');
select pg_temp.money_shipment(9221, 9321, 9101, 9102, 'shipped');
select pg_temp.money_shipment(9222, 9322, 9102, 9102, 'shipped');
select pg_temp.money_shipment(9223, 9323, 9101, 9102, 'shipped');

-- 'ok' when the statement runs, else the raised SQLSTATE.
create function pg_temp.t9_try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'raised:' || sqlstate;
end $$;

-- What each t9_try call returned, read by a later statement that sees its writes.
create temp table t9_runs (n integer primary key, result text);

-- Insert dispute 9420 on shipment 9320 with one field overridden.
create function pg_temp.t9_insert(p_order integer, p_ship integer, p_buyer integer, p_seller integer,
  p_status public.dispute_status default 'open') returns void language sql as $$
  insert into public.disputes (id, order_id, buyer_id, seller_id, reason, description, status, shipment_id)
  values (pg_temp.mu(9420), pg_temp.mu(p_order), pg_temp.mu(p_buyer), pg_temp.mu(p_seller),
    'damaged', 'Trigger test', p_status, case when p_ship is null then null else pg_temp.mu(p_ship) end)
$$;

select set_config('request.jwt.claims', '{"sub": "f0000000-0000-4000-8000-000000009102", "role": "authenticated"}', true);
select throws_ok($$select pg_temp.t9_insert(9220, 9320, 9102, 9101)$$,
  'P0001', 'Invalid dispute opened notification authority or state',
  'trigger: an insert outside service_role is refused');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select throws_ok($$select pg_temp.t9_insert(9220, 9320, 9102, 9101, 'under_review')$$,
  'P0001', 'Invalid dispute opened notification authority or state',
  'trigger: a dispute that is not open is refused');
select throws_ok($$select pg_temp.t9_insert(9220, null, 9102, 9101)$$,
  'P0001', 'Invalid dispute opened notification authority or state',
  'trigger: a dispute without a shipment is refused');
select throws_ok($$select pg_temp.t9_insert(9221, 9320, 9102, 9101)$$,
  'P0001', 'Dispute order, shipment, buyer or seller relationship invalid',
  'trigger: a shipment of another order is refused');
select throws_ok($$select pg_temp.t9_insert(9220, 9320, 9103, 9101)$$,
  'P0001', 'Dispute order, shipment, buyer or seller relationship invalid',
  'trigger: a buyer that is not the order''s buyer is refused');
select throws_ok($$select pg_temp.t9_insert(9220, 9320, 9102, 9103)$$,
  'P0001', 'Dispute order, shipment, buyer or seller relationship invalid',
  'trigger: a seller that is not the shipment''s seller is refused');
select is((select count(*) from public.disputes where id = pg_temp.mu(9420)), 0::bigint,
  'trigger: no refused dispute was stored');

insert into t9_runs values (9421, pg_temp.t9_try('select pg_temp.money_dispute(9421, 9321)'));
select is(
  (select result from t9_runs where n = 9421) || ' ' || (select string_agg(n.user_id || '|' || n.event_kind || '|' || n.source_event_key || '|' || n.event_payload::text, ' ')
   from public.notifications n where n.source_event_key = 'dispute.opened:' || pg_temp.mu(9421)),
  'ok ' || pg_temp.mu(9101) || '|dispute.opened|dispute.opened:' || pg_temp.mu(9421) || '|'
    || jsonb_build_object('dispute_id', pg_temp.mu(9421), 'order_id', pg_temp.mu(9221), 'recipient_role', 'seller')::text,
  'trigger: one dispute.opened notice keyed by the dispute with the dispute, order and seller role');

insert into t9_runs values (9422, pg_temp.t9_try('select pg_temp.money_dispute(9422, 9322)'));
select is(
  (select result from t9_runs where n = 9422) || '|'
    || (select count(*) from public.disputes where id = pg_temp.mu(9422)) || '|'
    || (select count(*) from public.notifications where source_event_key = 'dispute.opened:' || pg_temp.mu(9422)),
  'ok|1|0', 'trigger: a seller who is also the buyer gets no notice');

insert into public.notifications (user_id, type, title, message, event_kind, source_event_key, event_payload)
values (pg_temp.mu(9101), 'info', 'Prior notice', 'Prior', 'dispute.opened',
  'dispute.opened:' || pg_temp.mu(9423), '{}'::jsonb);
insert into t9_runs values (9423, pg_temp.t9_try('select pg_temp.money_dispute(9423, 9323)'));
select is(
  (select result from t9_runs where n = 9423) || '|'
    || (select count(*) || '|' || string_agg(title, ',') from public.notifications
        where source_event_key = 'dispute.opened:' || pg_temp.mu(9423)),
  'ok|1|Prior notice', 'trigger: a notice with the same key makes the insert a no-op');

-- 3. _as_admin resolution: the actor rule ---------------------------------------------
-- success:error_message, or the raised error; then whether dispute 9421
-- changed; then the errors of the ERROR system_logs rows the call wrote for it.
create function pg_temp.t9_resolve(p_to text, p_actor uuid) returns text language plpgsql as $$
declare
  v_before text := (select d::text from public.disputes d where d.id = pg_temp.mu(9421));
  v_logs bigint := (select count(*) from public.system_logs l
    where l.level = 'ERROR' and l.metadata ->> 'dispute_id' = pg_temp.mu(9421)::text);
  v_result text;
begin
  begin
    if p_to = 'buyer' then
      select r.success || ':' || coalesce(r.error_message, '-') into v_result
      from public.fn_resolve_dispute_to_buyer_as_admin(pg_temp.mu(9421), 'T9 note', p_actor) r;
    else
      select r.success || ':' || coalesce(r.error_message, '-') into v_result
      from public.fn_resolve_dispute_to_seller_as_admin(pg_temp.mu(9421), 'T9 note', p_actor) r;
    end if;
  exception when others then
    v_result := 'raised:' || sqlstate || ':' || sqlerrm;
  end;
  return v_result || '|' || case when (select d::text from public.disputes d where d.id = pg_temp.mu(9421)) = v_before
    then 'unchanged' else 'changed' end
    || '|' || case when (select count(*) from public.system_logs l
                         where l.level = 'ERROR' and l.metadata ->> 'dispute_id' = pg_temp.mu(9421)::text) = v_logs
              then 'no log'
              else (select 'log ' || string_agg(distinct l.metadata ->> 'error', ',') from public.system_logs l
                    where l.level = 'ERROR' and l.metadata ->> 'dispute_id' = pg_temp.mu(9421)::text) end;
end $$;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
-- The function's own handler catches UNAUTHORIZED_NO_ACTOR: the caller gets
-- INTERNAL_SERVER_ERROR and the error is logged.
select is(pg_temp.t9_resolve('buyer', null), 'false:INTERNAL_SERVER_ERROR|unchanged|log UNAUTHORIZED_NO_ACTOR',
  'fn_resolve_dispute_to_buyer_as_admin: a NULL actor is refused with UNAUTHORIZED_NO_ACTOR logged');
select is(pg_temp.t9_resolve('buyer', pg_temp.mu(9102)), 'false:UNAUTHORIZED_ADMIN_ONLY|unchanged|no log',
  'fn_resolve_dispute_to_buyer_as_admin: an actor who is not an admin is refused');
select is(pg_temp.t9_resolve('seller', null), 'false:INTERNAL_SERVER_ERROR|unchanged|log UNAUTHORIZED_NO_ACTOR',
  'fn_resolve_dispute_to_seller_as_admin: a NULL actor is refused with UNAUTHORIZED_NO_ACTOR logged');
select is(pg_temp.t9_resolve('seller', pg_temp.mu(9101)), 'false:UNAUTHORIZED_ADMIN_ONLY|unchanged|no log',
  'fn_resolve_dispute_to_seller_as_admin: an actor who is not an admin is refused');
reset role;

select * from finish();
rollback;
