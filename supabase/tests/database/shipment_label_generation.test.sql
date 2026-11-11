-- Shipment label generation (#277 T11): the seller's label claim with its
-- origin snapshot, the sent, finalize, rejected and orphan transitions, the
-- label state and event constraints, the pinned Envia settings, and the
-- seller reminder before the paid timeout (fn_notify_label_deadline_reminders).
-- Reconciliation of stuck labels is in shipment_label_reconciliation.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(80);
\ir ../fixtures/money.psql

-- Users: 11001 seller, 11002 buyer, 11003 another user.
select pg_temp.money_user(n) from unnest(array[11001, 11002, 11003]) n;

update public.system_settings set envia_carrier = 'paquetexpress', envia_service = 'ground',
  envia_print_format = 'PDF', envia_print_size = 'STOCK_4X6', order_expiration_hours = 48,
  listing_quote_reference_destination = '{"name": "Ref", "phone": "5512345678", "street": "Reforma",
    "number": "1", "district": "Juarez", "city": "CDMX", "state": "CMX", "country": "MX", "postalCode": "06600"}'
where id = 1;

create function pg_temp.addr(p_n integer, p_user integer, p_number text default '12', p_deleted boolean default false)
returns uuid language sql as $$
  insert into public.addresses (id, user_id, full_name, phone, street_line1, street_number, district,
    city, state, zip_code, country, label, deleted_at)
  values (pg_temp.mu(p_n), pg_temp.mu(p_user), 'Name ' || p_n, '5511111111', 'Calle ' || p_n, p_number,
    'Centro', 'Puebla', 'PUE', '72000', 'MX', 'Casa', case when p_deleted then now() end)
  returning id
$$;

create function pg_temp.claim(p_ship integer, p_seller integer, p_addr integer) returns jsonb language sql as $$
  select public.fn_claim_shipment_label(pg_temp.mu(p_ship), pg_temp.mu(p_seller), pg_temp.mu(p_addr))
$$;

-- status|label state|claim token set|claim expiry set
create function pg_temp.row(p_ship integer) returns text language sql as $$
  select status::text || '|' || label_generation_state || '|' || (claim_token is not null) || '|' || (claim_expires_at is not null)
  from public.shipments where id = pg_temp.mu(p_ship)
$$;

create function pg_temp.events(p_ship integer) returns text language sql as $$
  select coalesce(string_agg(event_type || coalesce(':' || (metadata ->> 'errorClass'), ''), ',' order by event_type), '-')
  from public.shipment_label_events where shipment_id = pg_temp.mu(p_ship)
$$;

create function pg_temp.token(p_ship integer) returns uuid language sql as $$
  select claim_token from public.shipments where id = pg_temp.mu(p_ship)
$$;

-- Moves p_ship to p_state with a token when the state needs one; p_expires is
-- the claim expiry relative to now.
create function pg_temp.set_state(p_ship integer, p_state text, p_expires interval default interval '10 minutes')
returns void language sql as $$
  update public.shipments set label_generation_state = p_state,
    claim_token = case when p_state in ('claimed', 'generation_sent', 'orphan_pending') then gen_random_uuid() end,
    claim_expires_at = case when p_state in ('claimed', 'generation_sent') then clock_timestamp() + p_expires end
  where id = pg_temp.mu(p_ship)
$$;

create function pg_temp.quote(p_ship integer, p_carrier text default 'Paquetexpress') returns void language sql as $$
  update public.shipments set label_quote_carrier = p_carrier, label_quote_service = 'Ground',
    label_quote_cost_cents = 16875, label_quote_input_hash = 'hash', label_quote_rated_at = now()
  where id = pg_temp.mu(p_ship)
$$;

create function pg_temp.sent(p_ship integer, p_token uuid) returns boolean language sql as $$
  select public.fn_mark_shipment_label_sent(pg_temp.mu(p_ship), p_token)
$$;

create function pg_temp.finalize(p_ship integer, p_token uuid, p_carrier text default 'Paquetexpress',
  p_service text default ' Ground ', p_cost bigint default 16875, p_tracking text default 'TRK')
returns boolean language sql as $$
  select public.fn_finalize_shipment_label(pg_temp.mu(p_ship), p_token, 'env-' || p_ship, p_tracking,
    'https://label.test/' || p_ship, p_carrier, p_service, 'PDF', 'STOCK_4X6', p_cost)
$$;

create function pg_temp.op_ins(p_ship integer, p_started boolean, p_expires interval default interval '15 minutes')
returns void language sql as $$
  insert into public.shipment_cancellation_operations (
    shipment_id, order_id, source, reason, claim_token, claim_expires_at, external_started_at
  )
  select s.id, s.order_id, 'paid_timeout', 'label test', gen_random_uuid(), now() + p_expires,
    case when p_started then now() end
  from public.shipments s where s.id = pg_temp.mu(p_ship)
$$;

-- Fixtures: one order per shipment, all of seller 11001.
select pg_temp.money_shipment(11200 + n, 11100 + n, 11001, 11002, 'paid')
from generate_series(1, 18) n where n <> 7;
select pg_temp.money_shipment(11207, 11107, 11001, 11002, 'preparing');
select pg_temp.addr(11301, 11001);
select pg_temp.addr(11302, 11003);
select pg_temp.addr(11303, 11001, null);
select pg_temp.addr(11304, 11001, '  ');
select pg_temp.addr(11305, 11001, '9', true);

-- 1. Writers need the service role -------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select pg_temp.claim(11101, 11001, 11301)$$, 'P0001', 'UNAUTHORIZED', 'claim: a caller without service_role is UNAUTHORIZED');
select throws_ok($$select pg_temp.sent(11101, null)$$, 'P0001', 'UNAUTHORIZED', 'sent: a caller without service_role is UNAUTHORIZED');
select throws_ok($$select pg_temp.finalize(11101, null)$$, 'P0001', 'UNAUTHORIZED', 'finalize: a caller without service_role is UNAUTHORIZED');
select throws_ok($$select public.fn_mark_shipment_label_rejected(pg_temp.mu(11101), null, 'x')$$, 'P0001', 'UNAUTHORIZED',
  'rejected: a caller without service_role is UNAUTHORIZED');
select throws_ok($$select public.fn_mark_shipment_label_orphan(pg_temp.mu(11101), null, 'x')$$, 'P0001', 'UNAUTHORIZED',
  'orphan: a caller without service_role is UNAUTHORIZED');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 2. Claim and origin snapshot ------------------------------------------------------------
select throws_ok($$select pg_temp.claim(11102, 11003, 11302)$$, 'P0001', 'UNAUTHORIZED', 'claim: another seller is UNAUTHORIZED');
select throws_ok($$select pg_temp.claim(11103, 11001, 11302)$$, 'P0001', 'SELLER_ORIGIN_CORRECTION_REQUIRED',
  'claim: an origin address of another user needs a correction');
select throws_ok($$select pg_temp.claim(11104, 11001, 11303)$$, 'P0001', 'SELLER_ORIGIN_CORRECTION_REQUIRED',
  'claim: an origin address without a street number needs a correction');
select throws_ok($$select pg_temp.claim(11104, 11001, 11304)$$, 'P0001', 'SELLER_ORIGIN_CORRECTION_REQUIRED',
  'claim: a blank street number needs a correction');
select throws_ok($$select pg_temp.claim(11105, 11001, null)$$, 'P0001', 'SELLER_ORIGIN_CORRECTION_REQUIRED',
  'claim: no origin snapshot and no address needs a correction');
select throws_ok($$select pg_temp.claim(11106, 11001, 11305)$$, 'P0001', 'SELLER_ORIGIN_CORRECTION_REQUIRED',
  'claim: a deleted address needs a correction');

create table pg_temp.c1 as select pg_temp.claim(11101, 11001, 11301) as r;
select is((select r - 'claim_token' from pg_temp.c1),
  jsonb_build_object('status', 'claimed', 'origin_address', jsonb_build_object('full_name', 'Name 11301',
    'phone', '5511111111', 'street_line1', 'Calle 11301', 'street_number', '12', 'district', 'Centro',
    'city', 'Puebla', 'state', 'PUE', 'country', 'MX', 'zip_code', '72000')),
  'claim: answers claimed with the origin snapshot of the seller address');
select is((select (r ->> 'claim_token')::uuid from pg_temp.c1), pg_temp.token(11101), 'claim: the returned token is the stored one');
select is(pg_temp.row(11101), 'paid|claimed|true|true', 'claim: the shipment is claimed with a token and an expiry');
select ok((select claim_expires_at > now() + interval '14 minutes' and claim_expires_at <= clock_timestamp() + interval '15 minutes'
  from public.shipments where id = pg_temp.mu(11101)), 'claim: the claim expires 15 minutes later');
select is((select origin_address_id from public.shipments where id = pg_temp.mu(11101)), pg_temp.mu(11301),
  'claim: the origin address id is stored with the snapshot');
select is((select string_agg(event_type || ':' || (actor_id = pg_temp.mu(11001)), ',') from public.shipment_label_events
  where shipment_id = pg_temp.mu(11101)), 'claimed:true', 'claim: one claimed event with the seller as actor');
select is(pg_temp.claim(11101, 11001, 11301), '{"status": "claimed_conflict"}'::jsonb, 'claim: a live claim answers claimed_conflict');
select is((select claim_token from public.shipments where id = pg_temp.mu(11101)), (select (r ->> 'claim_token')::uuid from pg_temp.c1),
  'claim: claimed_conflict keeps the first token');

select throws_ok($$update public.shipments set origin_address = '{"city": "Other"}' where id = pg_temp.mu(11101)$$,
  'P0001', 'ORIGIN_SNAPSHOT_IMMUTABLE', 'origin: a stored snapshot cannot change');
select throws_ok($$update public.shipments set origin_address_id = pg_temp.mu(11302) where id = pg_temp.mu(11101)$$,
  'P0001', 'ORIGIN_SNAPSHOT_IMMUTABLE', 'origin: the stored origin address id cannot change');

update public.shipments set origin_address = '{"city": "Kept"}', origin_address_id = pg_temp.mu(11301),
  label_generation_state = 'retryable_rejected' where id = pg_temp.mu(11113);
select is(pg_temp.claim(11113, 11001, 11302) -> 'origin_address', '{"city": "Kept"}'::jsonb,
  'claim: a retry keeps the stored snapshot and ignores the new address');

select is(pg_temp.claim(11107, 11001, 11301), '{"status": "ineligible"}'::jsonb, 'claim: a shipment that is not paid is ineligible');
select is(pg_temp.row(11107) || '|' || pg_temp.events(11107), 'preparing|unclaimed|false|false|-',
  'claim: an ineligible shipment stays unclaimed with no event');
select pg_temp.op_ins(11108, true, interval '-1 minute');
select throws_ok($$select pg_temp.claim(11108, 11001, 11301)$$, 'P0001', 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
  'claim: a started cancellation blocks the claim');
select pg_temp.op_ins(11117, false, interval '-1 minute');
select is(pg_temp.claim(11117, 11001, 11301) ->> 'status', 'claimed', 'claim: an expired cancellation claim that never started does not block');

update public.shipments set label_generation_state = 'generated' where id = pg_temp.mu(11109);
select pg_temp.set_state(11110, 'orphan_pending');
select is(pg_temp.claim(11109, 11001, 11301), '{"status": "generated"}'::jsonb, 'claim: a generated label answers generated');
select is(pg_temp.claim(11110, 11001, 11301), '{"status": "orphan_pending"}'::jsonb, 'claim: an orphan answers orphan_pending');

select pg_temp.set_state(11111, 'claimed', interval '-1 second');
select pg_temp.set_state(11112, 'generation_sent', interval '-1 second');
select is(pg_temp.claim(11111, 11001, 11301), '{"status": "orphan_pending", "reconciliation_required": true}'::jsonb,
  'claim: an expired claim becomes orphan_pending and needs reconciliation');
select is(pg_temp.row(11111) || '|' || pg_temp.events(11111), 'paid|orphan_pending|true|false|orphaned:stale_claim_requires_reconciliation',
  'claim: the expired claim keeps its token, drops the expiry and logs the stale orphan');
select is(pg_temp.claim(11112, 11001, 11301), '{"status": "orphan_pending", "reconciliation_required": true}'::jsonb,
  'claim: an expired sent claim becomes orphan_pending and needs reconciliation');
select is(pg_temp.row(11112), 'paid|orphan_pending|true|false', 'claim: the expired sent claim is orphan_pending');

-- 3. Sent and finalize -------------------------------------------------------------------
select pg_temp.quote(11101, 'Estafeta');
select is(pg_temp.sent(11101, pg_temp.token(11101)), false, 'sent: a quote from another carrier is refused');
select pg_temp.quote(11101);
select is(pg_temp.sent(11101, gen_random_uuid()), false, 'sent: another token is refused');
select is(pg_temp.row(11101) || '|' || pg_temp.events(11101), 'paid|claimed|true|true|claimed', 'sent: refusals change nothing');
select pg_temp.op_ins(11114, false);
select pg_temp.set_state(11114, 'claimed');
select pg_temp.quote(11114);
select is(pg_temp.sent(11114, pg_temp.token(11114)), false, 'sent: a live cancellation claim blocks the send');
select is(pg_temp.sent(11101, pg_temp.token(11101)), true, 'sent: the claim owner marks the label sent');
select is(pg_temp.row(11101) || '|' || pg_temp.events(11101), 'paid|generation_sent|true|true|claimed,sent',
  'sent: the shipment is generation_sent and a sent event is logged');

select throws_ok(format('select pg_temp.finalize(11101, %L, %L)', pg_temp.token(11101), 'Estafeta'), 'P0001', 'INVALID_PROVIDER_RESULT',
  'finalize: another carrier is INVALID_PROVIDER_RESULT');
select throws_ok(format('select pg_temp.finalize(11101, %L, %L, %L)', pg_temp.token(11101), 'paquetexpress', 'express'), 'P0001',
  'INVALID_PROVIDER_RESULT', 'finalize: another service is INVALID_PROVIDER_RESULT');
select throws_ok(format('select pg_temp.finalize(11101, %L, p_cost => -1)', pg_temp.token(11101)), 'P0001', 'INVALID_PROVIDER_RESULT',
  'finalize: a negative cost is INVALID_PROVIDER_RESULT');
select throws_ok(format('select pg_temp.finalize(11101, %L, p_tracking => null)', pg_temp.token(11101)), 'P0001', 'INVALID_PROVIDER_RESULT',
  'finalize: a missing tracking number is INVALID_PROVIDER_RESULT');
select is(pg_temp.finalize(11101, gen_random_uuid()), false, 'finalize: another token is refused');
select pg_temp.set_state(11115, 'claimed');
select is(pg_temp.finalize(11115, pg_temp.token(11115)), false, 'finalize: a claim that was never sent is refused');
select is(pg_temp.row(11115) || '|' || pg_temp.events(11115), 'paid|claimed|true|true|-', 'finalize: refusals change nothing');
select is(pg_temp.finalize(11101, pg_temp.token(11101)), true, 'finalize: the sent claim is finalized');
select is(pg_temp.row(11101) || '|' || pg_temp.events(11101), 'preparing|generated|false|false|claimed,generated,sent',
  'finalize: the shipment is preparing and generated, the claim is cleared and a generated event is logged');
select is((select envia_shipment_id || '|' || tracking_number || '|' || carrier || '|' || label_provider_cost_cents
  || '|' || (label_generated_at is not null) from public.shipments where id = pg_temp.mu(11101)),
  'env-11101|TRK|Paquetexpress|16875|true', 'finalize: the provider result is stored');

-- 4. Rejected and orphan need the original claim -----------------------------------------
select pg_temp.set_state(11116, 'generation_sent');
select is(public.fn_mark_shipment_label_rejected(pg_temp.mu(11116), gen_random_uuid(), 'carrier_error'), false,
  'rejected: another token is refused');
select is(public.fn_mark_shipment_label_rejected(pg_temp.mu(11116), pg_temp.token(11116), 'carrier_error'), true,
  'rejected: the claim owner marks the label rejected');
select is(pg_temp.row(11116) || '|' || pg_temp.events(11116), 'paid|retryable_rejected|false|false|rejected:carrier_error',
  'rejected: the shipment is retryable and the claim is cleared');
select pg_temp.set_state(11118, 'claimed');
select is(public.fn_mark_shipment_label_orphan(pg_temp.mu(11118), gen_random_uuid(), 'timeout'), false, 'orphan: another token is refused');
select is(pg_temp.row(11118) || '|' || pg_temp.events(11118), 'paid|claimed|true|true|-', 'orphan: a refusal changes nothing');
select is(public.fn_mark_shipment_label_orphan(pg_temp.mu(11118), pg_temp.token(11118), 'timeout'), true,
  'orphan: the claim owner marks the label orphaned');
select is(pg_temp.row(11118) || '|' || pg_temp.events(11118), 'paid|orphan_pending|true|false|orphaned:timeout',
  'orphan: the shipment is orphan_pending, keeps the token and drops the expiry');
select is(public.fn_mark_shipment_label_rejected(pg_temp.mu(11118), pg_temp.token(11118), 'late'), false,
  'rejected: an orphan cannot become retryable');

-- 5. Label state and event constraints ---------------------------------------------------
select throws_ok($$update public.shipments set label_generation_state = 'claimed', claim_token = null where id = pg_temp.mu(11102)$$,
  '23514', null, 'check: a claimed shipment needs a claim token');
select throws_ok($$update public.shipments set label_generation_state = 'orphan_pending', claim_token = null where id = pg_temp.mu(11102)$$,
  '23514', null, 'check: an orphan needs a claim token');
select throws_ok($$update public.shipments set claim_token = gen_random_uuid() where id = pg_temp.mu(11102)$$,
  '23514', null, 'check: an unclaimed shipment has no claim token');
select throws_ok($$update public.shipments set label_generation_state = 'lost' where id = pg_temp.mu(11102)$$,
  '23514', null, 'check: an unknown label state is rejected');
select lives_ok($$insert into public.shipment_label_events (shipment_id, event_type) values (pg_temp.mu(11102), 'released')$$,
  'events: released is a known event type');
select throws_ok($$insert into public.shipment_label_events (shipment_id, event_type) values (pg_temp.mu(11102), 'deleted')$$,
  '23514', null, 'events: an unknown event type is rejected');
select throws_ok($$insert into public.shipment_label_events (shipment_id, event_type, metadata)
  values (pg_temp.mu(11102), 'sent', '{"raw_provider_response": {}}')$$, '23514', null, 'events: metadata never holds the raw provider response');
select set_config('request.jwt.claims', format('{"sub": "%s", "role": "authenticated"}', pg_temp.mu(11001)), true);
set local role authenticated;
select throws_ok($$insert into public.shipment_label_events (shipment_id, event_type) values (pg_temp.mu(11102), 'sent')$$,
  '42501', null, 'events: a client cannot insert an event');
select is((select count(*) from public.shipment_label_events), 0::bigint, 'events: a client reads no event');
update public.shipment_label_events set event_type = 'sent' where shipment_id = pg_temp.mu(11101);
delete from public.shipment_label_events where shipment_id = pg_temp.mu(11101);
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(pg_temp.events(11101), 'claimed,generated,sent', 'events: a client update or delete changes nothing');

-- 6. Envia settings are pinned to Paquetexpress ground ------------------------------------
select throws_ok($$update public.system_settings set envia_carrier = 'estafeta' where id = 1$$, '23514', null,
  'settings: another carrier is rejected');
select throws_ok($$update public.system_settings set envia_carrier = 'Paquetexpress' where id = 1$$, '23514', null,
  'settings: the carrier is stored lowercase');
select throws_ok($$update public.system_settings set envia_service = 'express' where id = 1$$, '23514', null,
  'settings: another service is rejected');
select lives_ok($$update public.system_settings set envia_service = ' Ground ' where id = 1$$,
  'settings: the service matches ground ignoring case and spaces');

-- 7. Label deadline reminder --------------------------------------------------------------
-- Sets each shipment's created_at so its deadline (created_at + 48 h) is the
-- given offset after this statement's timestamp, the function's "now".
create function pg_temp.notify_at(p_offsets jsonb) returns integer language plpgsql as $$
declare k text; v text;
begin
  for k, v in select * from jsonb_each_text(p_offsets) loop
    update public.shipments set created_at = statement_timestamp() - interval '48 hours' + v::interval
    where id = pg_temp.mu(k::integer);
  end loop;
  return public.fn_notify_label_deadline_reminders();
end $$;

-- 11401 unclaimed 12 h left, 11402 retryable 1 µs left, 11403 12 h + 1 µs, 11404 deadline now,
-- 11405 preparing, 11406 tracking number, 11407 generated, 11408 started cancellation,
-- 11409 live cancellation claim, 11410 expired unstarted cancellation claim.
select pg_temp.money_shipment(11500 + n, 11400 + n, 11001, 11002, case when n = 5 then 'preparing' else 'paid' end::public.order_status_enum)
from generate_series(1, 10) n;
update public.shipments set label_generation_state = 'retryable_rejected' where id = pg_temp.mu(11402);
update public.shipments set tracking_number = 'TRK' where id = pg_temp.mu(11406);
update public.shipments set label_generation_state = 'generated' where id = pg_temp.mu(11407);
select pg_temp.op_ins(11408, true, interval '-1 minute');
select pg_temp.op_ins(11409, false);
select pg_temp.op_ins(11410, false, interval '-1 minute');

create function pg_temp.deadline_shipments() returns jsonb language sql as $$
  select '{"11401": "12 hours", "11402": "0.000001 seconds", "11403": "12:00:00.000001", "11404": "0",
    "11405": "6 hours", "11406": "6 hours", "11407": "6 hours", "11408": "6 hours", "11409": "6 hours", "11410": "6 hours"}'::jsonb
$$;
create function pg_temp.notices() returns bigint language sql as $$
  select count(*) from public.notifications where event_kind = 'shipment.label_deadline'
$$;

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select public.fn_notify_label_deadline_reminders()$$, '42501', null,
  'deadline: a caller without service_role is refused');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

create table pg_temp.before as select pg_temp.notices() as n;
create table pg_temp.run1 as select pg_temp.notify_at(pg_temp.deadline_shipments()) as n;
select is((select n from pg_temp.run1)::bigint, pg_temp.notices() - (select n from pg_temp.before), 'deadline: returns the number of notices written');
select is((select string_agg(n::text, ',' order by n) from generate_series(11401, 11410) n
  where exists (select 1 from public.notifications where source_event_key = 'shipment.label_deadline:' || pg_temp.mu(n))),
  '11401,11402,11410', 'deadline: only paid, untracked, unclaimed or retryable shipments due within 12 hours without an active cancellation');
select is((select jsonb_build_object('user', user_id = pg_temp.mu(11001), 'payload', event_payload - 'deadline_at',
    'deadline', (event_payload ->> 'deadline_at')::timestamptz = s.created_at + interval '48 hours',
    'type', type, 'title', title, 'message', message, 'path', action_path)
  from public.notifications n join public.shipments s on s.id = pg_temp.mu(11401)
  where n.source_event_key = 'shipment.label_deadline:' || pg_temp.mu(11401)),
  jsonb_build_object('user', true, 'payload', jsonb_build_object('shipment_id', pg_temp.mu(11401), 'order_id', pg_temp.mu(11501),
    'recipient_role', 'seller'), 'deadline', true, 'type', 'warning', 'title', 'Genera la guía de tu venta',
    'message', 'Si no generas la guía en 12 horas, cancelaremos la venta y reembolsaremos al comprador.',
    'path', '/profile/orders/' || pg_temp.mu(11501) || '?shipment_id=' || pg_temp.mu(11401)),
  'deadline: the seller notice names the shipment, its deadline and the hours left');
select is((select message from public.notifications where source_event_key = 'shipment.label_deadline:' || pg_temp.mu(11402)),
  'Si no generas la guía en 1 hora, cancelaremos la venta y reembolsaremos al comprador.', 'deadline: under one hour reads 1 hora');
select is(pg_temp.notify_at(pg_temp.deadline_shipments()), 0, 'deadline: a second run writes nothing');
select is((select count(*) from public.notifications where source_event_key like 'shipment.label_deadline:%'
  and source_event_key in (select 'shipment.label_deadline:' || pg_temp.mu(n) from generate_series(11401, 11410) n)), 3::bigint,
  'deadline: one notice per shipment');
select is((select string_agg(recipient_role || ':' || channel, ',') from public.push_event_policy where event_kind = 'shipment.label_deadline'),
  'seller:orders', 'deadline: the reminder is pushed to the seller on the orders channel');
update public.system_settings set order_expiration_hours = 0 where id = 1;
select throws_ok($$select public.fn_notify_label_deadline_reminders()$$, 'P0001', 'AUTO_CANCEL_SETTINGS_INVALID',
  'deadline: a zero expiration is AUTO_CANCEL_SETTINGS_INVALID');
update public.system_settings set order_expiration_hours = null where id = 1;
select throws_ok($$select public.fn_notify_label_deadline_reminders()$$, 'P0001', 'AUTO_CANCEL_SETTINGS_INVALID',
  'deadline: a missing expiration is AUTO_CANCEL_SETTINGS_INVALID');

select * from finish();
rollback;
