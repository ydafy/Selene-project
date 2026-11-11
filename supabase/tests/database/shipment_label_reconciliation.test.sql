-- Shipment label reconciliation (#277 T11): which shipments are stuck in label
-- generation (fn_shipment_label_is_stuck), the admin list of them, recording
-- a label found at Envia (fn_reconcile_shipment_label) and the admin
-- resolution (fn_resolve_shipment_label_reconciliation): label_found finishes
-- the label, no_label releases the shipment to unclaimed and touches nothing else.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(50);
\ir ../fixtures/money.psql

-- Users: 12001 seller, 12002 buyer, 12003 admin, 12004 suspended admin, 12005 another user.
select pg_temp.money_user(n) from unnest(array[12001, 12002, 12005]) n;
select pg_temp.money_user(n, 'admin') from unnest(array[12003, 12004]) n;
update public.profiles_private set status = 'suspended' where id = pg_temp.mu(12004);

update public.system_settings set envia_carrier = 'paquetexpress', envia_service = 'ground',
  envia_print_format = 'PDF', envia_print_size = 'STOCK_4X6',
  listing_quote_reference_destination = '{"name": "Ref", "phone": "5512345678", "street": "Reforma",
    "number": "1", "district": "Juarez", "city": "CDMX", "state": "CMX", "country": "MX", "postalCode": "06600"}'
where id = 1;

-- status|label state|claim token set|claim expiry set
create function pg_temp.row(p_ship integer) returns text language sql as $$
  select status::text || '|' || label_generation_state || '|' || (claim_token is not null) || '|' || (claim_expires_at is not null)
  from public.shipments where id = pg_temp.mu(p_ship)
$$;

create function pg_temp.set_state(p_ship integer, p_state text, p_expires interval default null)
returns void language sql as $$
  update public.shipments set label_generation_state = p_state,
    claim_token = case when p_state in ('claimed', 'generation_sent', 'orphan_pending') then gen_random_uuid() end,
    claim_expires_at = now() + p_expires
  where id = pg_temp.mu(p_ship)
$$;

create function pg_temp.event(p_ship integer, p_type text, p_ago interval) returns void language sql as $$
  insert into public.shipment_label_events (shipment_id, event_type, created_at) values (pg_temp.mu(p_ship), p_type, now() - p_ago)
$$;

-- The events of p_ship as type:actor number:metadata.
create function pg_temp.events(p_ship integer) returns text language sql as $$
  select coalesce(string_agg(e.event_type || ':' || coalesce(n::text, '-') || ':' || e.metadata::text, ',' order by e.event_type), '-')
  from public.shipment_label_events e
  left join generate_series(12001, 12005) n on pg_temp.mu(n) = e.actor_id
  where e.shipment_id = pg_temp.mu(p_ship)
$$;

create function pg_temp.reconcile(p_ship integer, p_actor integer, p_envia text default 'env-1', p_tracking text default 'TRK',
  p_label text default 'https://label.test/1', p_carrier text default 'Paquetexpress', p_service text default ' Ground ',
  p_format text default 'PDF', p_size text default 'STOCK_4X6', p_cost bigint default 15000, p_note text default null)
returns boolean language sql as $$
  select public.fn_reconcile_shipment_label(pg_temp.mu(p_ship), pg_temp.mu(p_actor), p_envia, p_tracking, p_label,
    p_carrier, p_service, p_format, p_size, p_cost, p_note)
$$;

create function pg_temp.resolve(p_ship integer, p_actor integer, p_resolution text, p_note text,
  p_tracking text default null, p_cost bigint default null)
returns jsonb language sql as $$
  select public.fn_resolve_shipment_label_reconciliation(pg_temp.mu(p_ship), pg_temp.mu(p_actor), p_resolution, p_note,
    case when p_tracking is not null then 'env-r' end, p_tracking, case when p_tracking is not null then 'https://label.test/r' end, p_cost)
$$;

-- Fixtures: one paid order per shipment of seller 12001.
select pg_temp.money_shipment(12200 + n, 12100 + n, 12001, 12002, 'paid') from generate_series(1, 8) n;
update public.shipments set status = 'preparing' where id = pg_temp.mu(12105);
update public.orders set shipping_address = '{"zip_code": "06600", "city": "CDMX"}' where id = pg_temp.mu(12201);
update public.shipments set origin_address = '{"zip_code": "72000", "city": "Puebla"}',
  label_quote_carrier = 'Paquetexpress', label_quote_service = 'Ground', label_quote_cost_cents = 16875,
  label_quote_rated_at = now() - interval '1 day' where id = pg_temp.mu(12101);
select pg_temp.set_state(12101, 'orphan_pending');
select pg_temp.event(12101, 'claimed', interval '4 hours');
select pg_temp.event(12101, 'orphaned', interval '3 hours');
select pg_temp.event(12101, 'sent', interval '30 minutes');
select pg_temp.set_state(12102, 'claimed', interval '-2 hours');
select pg_temp.set_state(12103, 'generation_sent', interval '-1 hour');
select pg_temp.set_state(12104, 'claimed', interval '10 minutes');
select pg_temp.set_state(12105, 'orphan_pending');
select pg_temp.set_state(12107, 'orphan_pending');
update public.shipments set updated_at = now() - interval '5 hours' where id = pg_temp.mu(12107);
select pg_temp.set_state(12108, 'orphan_pending');

-- 1. Stuck rule ------------------------------------------------------------------------
select is((select string_agg(public.fn_shipment_label_is_stuck(st::public.order_status_enum, state, exp)::text, ',' order by i)
  from (values (1, 'paid', 'orphan_pending', null::timestamptz), (2, 'paid', 'claimed', clock_timestamp() - interval '1 second'),
    (3, 'paid', 'generation_sent', clock_timestamp() - interval '1 second'), (4, 'paid', 'claimed', clock_timestamp() + interval '1 minute'),
    (5, 'paid', 'claimed', null), (6, 'preparing', 'orphan_pending', null), (7, 'paid', 'unclaimed', null),
    (8, 'paid', 'retryable_rejected', clock_timestamp() - interval '1 second')) v(i, st, state, exp)),
  'true,true,true,false,false,false,false,false',
  'stuck: a paid orphan, or a paid claim or send whose claim expired, and nothing else');

-- 2. List -------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select * from public.fn_list_shipment_label_reconciliations()$$, 'P0001', 'UNAUTHORIZED',
  'list: a caller without service_role is UNAUTHORIZED');
select throws_ok($$select pg_temp.reconcile(12108, 12003)$$, 'P0001', 'UNAUTHORIZED',
  'reconcile: a caller without service_role is UNAUTHORIZED');
select throws_ok($$select pg_temp.resolve(12102, 12003, 'no_label', 'note')$$, 'P0001', 'UNAUTHORIZED',
  'resolve: a caller without service_role is UNAUTHORIZED');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

select is((select array_agg(l.shipment_id order by ord)
  from public.fn_list_shipment_label_reconciliations() with ordinality l(shipment_id, order_id, seller_id, seller_name, buyer_id,
    buyer_name, shipment_created_at, label_generation_state, stuck_at, claim_expires_at, last_label_event_at, quote_carrier,
    quote_service, quote_cost_cents, quote_rated_at, origin_postal_code, origin_city, destination_postal_code, destination_city, ord)
  where l.shipment_id in (select pg_temp.mu(n) from generate_series(12101, 12108) n)),
  array[pg_temp.mu(12107), pg_temp.mu(12101), pg_temp.mu(12102), pg_temp.mu(12103), pg_temp.mu(12108)],
  'list: only paid stuck shipments, oldest stuck first');
select is((select to_jsonb(l) from public.fn_list_shipment_label_reconciliations() l where l.shipment_id = pg_temp.mu(12101)),
  jsonb_build_object('shipment_id', pg_temp.mu(12101), 'order_id', pg_temp.mu(12201), 'seller_id', pg_temp.mu(12001),
    'seller_name', 'money_12001', 'buyer_id', pg_temp.mu(12002), 'buyer_name', 'money_12002', 'shipment_created_at', now(),
    'label_generation_state', 'orphan_pending', 'stuck_at', now() - interval '3 hours', 'claim_expires_at', null,
    'last_label_event_at', now() - interval '30 minutes', 'quote_carrier', 'Paquetexpress', 'quote_service', 'Ground',
    'quote_cost_cents', 16875, 'quote_rated_at', now() - interval '1 day', 'origin_postal_code', '72000', 'origin_city', 'Puebla',
    'destination_postal_code', '06600', 'destination_city', 'CDMX'),
  'list: an orphan is stuck since its orphaned event and carries the seller, buyer, quote and postal codes');
select is((select stuck_at from public.fn_list_shipment_label_reconciliations() l where l.shipment_id = pg_temp.mu(12102)),
  now() - interval '2 hours', 'list: an expired claim is stuck since its claim expiry');

-- 3. Reconcile ----------------------------------------------------------------------------
select throws_ok($$select pg_temp.reconcile(12108, 12005)$$, 'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'reconcile: a user who is not an admin is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12004)$$, 'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'reconcile: a suspended admin is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12003, p_note => '  ')$$, 'P0001', 'INVALID_RESOLUTION_NOTE', 'reconcile: a blank note is refused');
select throws_ok(format('select pg_temp.reconcile(12108, 12003, p_note => %L)', repeat('n', 201)), 'P0001', 'INVALID_RESOLUTION_NOTE',
  'reconcile: a note over 200 characters is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12003, p_envia => null)$$, 'P0001', 'INVALID_PROVIDER_RESULT', 'reconcile: a missing Envia id is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12003, p_tracking => ' ')$$, 'P0001', 'INVALID_PROVIDER_RESULT', 'reconcile: a blank tracking number is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12003, p_label => null)$$, 'P0001', 'INVALID_PROVIDER_RESULT', 'reconcile: a missing label url is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12003, p_size => '')$$, 'P0001', 'INVALID_PROVIDER_RESULT', 'reconcile: a blank print size is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12003, p_carrier => 'Estafeta')$$, 'P0001', 'INVALID_PROVIDER_RESULT', 'reconcile: another carrier is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12003, p_service => 'express')$$, 'P0001', 'INVALID_PROVIDER_RESULT', 'reconcile: another service is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12003, p_cost => -1)$$, 'P0001', 'INVALID_PROVIDER_RESULT', 'reconcile: a negative cost is refused');
select throws_ok($$select pg_temp.reconcile(12108, 12003, p_cost => null)$$, 'P0001', 'INVALID_PROVIDER_RESULT', 'reconcile: a missing cost is refused');
select is(pg_temp.reconcile(12104, 12003), false, 'reconcile: a live claim is not stuck');
select is(pg_temp.row(12104) || '|' || pg_temp.events(12104), 'paid|claimed|true|true|-', 'reconcile: a shipment that is not stuck is unchanged');
select is(pg_temp.reconcile(12108, 12003, p_note => '  Found at Envia  '), true, 'reconcile: an admin records the label of a stuck shipment');
select is(pg_temp.row(12108), 'preparing|generated|false|false', 'reconcile: the shipment is preparing and generated with the claim cleared');
select is((select envia_shipment_id || '|' || tracking_number || '|' || label_url || '|' || carrier || '|' || service || '|' || print_format
    || '|' || print_size || '|' || label_provider_cost_cents || '|' || (label_generated_at is not null)
  from public.shipments where id = pg_temp.mu(12108)),
  'env-1|TRK|https://label.test/1|Paquetexpress| Ground |PDF|STOCK_4X6|15000|true', 'reconcile: the provider result is stored');
select is(pg_temp.events(12108), 'reconciled:12003:{"note": "Found at Envia", "from_state": "orphan_pending", "resolution": "label_found"}',
  'reconcile: a reconciled event keeps the admin, the previous state and the trimmed note');
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fn_reconcile_shipment_label'), 1::bigint,
  'reconcile: exactly one fn_reconcile_shipment_label exists');

-- 4. Resolve: refusals ---------------------------------------------------------------------
select throws_ok($$select pg_temp.resolve(12102, 12005, 'no_label', 'note')$$, 'P0001', 'ADMIN_REQUIRED', 'resolve: a user who is not an admin is refused');
select throws_ok($$select pg_temp.resolve(12102, 12004, 'no_label', 'note')$$, 'P0001', 'ADMIN_REQUIRED', 'resolve: a suspended admin is refused');
select throws_ok($$select pg_temp.resolve(12102, 12003, 'retry', 'note')$$, 'P0001', 'INVALID_RESOLUTION', 'resolve: an unknown resolution is refused');
select throws_ok($$select pg_temp.resolve(12102, 12003, null, 'note')$$, 'P0001', 'INVALID_RESOLUTION', 'resolve: a missing resolution is refused');
select throws_ok($$select pg_temp.resolve(12102, 12003, 'no_label', null)$$, 'P0001', 'INVALID_RESOLUTION_NOTE', 'resolve: a missing note is refused');
select throws_ok($$select pg_temp.resolve(12102, 12003, 'no_label', '   ')$$, 'P0001', 'INVALID_RESOLUTION_NOTE', 'resolve: a blank note is refused');
select throws_ok(format('select pg_temp.resolve(12102, 12003, %L, %L)', 'no_label', repeat('n', 201)), 'P0001', 'INVALID_RESOLUTION_NOTE',
  'resolve: a note over 200 characters is refused');
select throws_ok($$select pg_temp.resolve(12102, 12003, 'no_label', 'note', 'TRK')$$, 'P0001', 'UNEXPECTED_PROVIDER_FIELDS',
  'resolve: no_label with provider fields is refused');
select throws_ok($$select public.fn_resolve_shipment_label_reconciliation(gen_random_uuid(), pg_temp.mu(12003), 'no_label', 'note')$$,
  'P0001', 'SHIPMENT_NOT_FOUND', 'resolve: an unknown shipment is SHIPMENT_NOT_FOUND');
select is(pg_temp.resolve(12106, 12003, 'no_label', 'note'),
  jsonb_build_object('result', 'already_resolved', 'shipment_id', pg_temp.mu(12106), 'status', 'paid', 'label_generation_state', 'unclaimed'),
  'resolve: a shipment that is not stuck is already_resolved');
select is(pg_temp.row(12106) || '|' || pg_temp.events(12106), 'paid|unclaimed|false|false|-', 'resolve: already_resolved changes nothing');

-- 5. Resolve: no_label ---------------------------------------------------------------------
create table pg_temp.before as select
  (select ctid::text || status::text from public.orders where id = pg_temp.mu(12202)) as order_row,
  (select count(*) from public.notifications where user_id in (pg_temp.mu(12001), pg_temp.mu(12002))) as notices;
select is(pg_temp.resolve(12102, 12003, 'no_label', repeat('n', 200)),
  jsonb_build_object('result', 'resolved', 'resolution', 'no_label', 'shipment_id', pg_temp.mu(12102), 'status', 'paid',
    'label_generation_state', 'unclaimed'), 'resolve: no_label with a 200-character note is resolved');
select is(pg_temp.row(12102), 'paid|unclaimed|false|false', 'resolve: no_label releases the shipment to unclaimed, still paid');
select is(pg_temp.events(12102), 'released:12003:' || jsonb_build_object('note', repeat('n', 200), 'from_state', 'claimed', 'resolution', 'no_label')::text,
  'resolve: a released event keeps the admin, the previous state and the note');
select is((select ctid::text || status::text from public.orders where id = pg_temp.mu(12202)), (select order_row from pg_temp.before),
  'resolve: no_label leaves the order untouched');
select is((select count(*) from public.notifications where user_id in (pg_temp.mu(12001), pg_temp.mu(12002))), (select notices from pg_temp.before),
  'resolve: no_label writes no notice');
select is((select count(*) from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(12102)), 0::bigint,
  'resolve: no_label starts no cancellation');

-- 6. Resolve: label_found ------------------------------------------------------------------
select is(pg_temp.resolve(12101, 12003, 'label_found', 'Found', 'TRK-F', 17000),
  jsonb_build_object('result', 'resolved', 'resolution', 'label_found', 'shipment_id', pg_temp.mu(12101), 'status', 'preparing',
    'label_generation_state', 'generated'), 'resolve: label_found finishes the label');
select is((select tracking_number || '|' || carrier || '|' || service || '|' || print_format || '|' || print_size || '|' || label_provider_cost_cents
  from public.shipments where id = pg_temp.mu(12101)), 'TRK-F|Paquetexpress|Ground|PDF|STOCK_4X6|17000',
  'resolve: label_found stores the quoted carrier and service and the configured print settings');
select is((select metadata::text || ':' || (actor_id = pg_temp.mu(12003)) from public.shipment_label_events
  where shipment_id = pg_temp.mu(12101) and event_type = 'reconciled'),
  '{"note": "Found", "from_state": "orphan_pending", "resolution": "label_found"}:true', 'resolve: label_found logs a reconciled event');
select is(pg_temp.resolve(12101, 12003, 'label_found', 'Again', 'TRK-G', 1) ->> 'result', 'already_resolved',
  'resolve: a second resolution is already_resolved');
update public.shipments set label_quote_carrier = null, label_quote_service = null where id = pg_temp.mu(12103);
select is(pg_temp.resolve(12103, 12003, 'label_found', 'Found', 'TRK-H', 100) ->> 'result', 'resolved',
  'resolve: without a frozen quote label_found uses the configured carrier and service');
select is((select carrier || '|' || service from public.shipments where id = pg_temp.mu(12103)), 'paquetexpress|ground',
  'resolve: the configured carrier and service are stored');
update public.system_settings set envia_carrier = null, envia_service = null, envia_print_format = null,
  envia_print_size = null, listing_quote_reference_destination = null where id = 1;
select throws_ok($$select pg_temp.resolve(12107, 12003, 'label_found', 'Found', 'TRK-I', 100)$$, 'P0001', 'LABEL_SETTINGS_MISSING',
  'resolve: label_found without print settings is refused');

select * from finish();
rollback;
