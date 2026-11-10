-- Payout run ledger tables: connect_payout_runs, connect_payout_run_shipments
-- and the append-only connect_payout_events with fn_append_connect_payout_event.
-- Proves their keys, constraints, partial unique indexes, the append-only
-- trigger, RLS and grants (#275, T3). The release view and the admin queue are
-- in payout_runs_view.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(55);
\ir ../fixtures/money.psql

-- Admin 10, buyer 19, seller 11; shipments 101-104 (orders 201-204).
select pg_temp.money_user(10, 'admin');
select pg_temp.money_user(11);
select pg_temp.money_user(19);
select pg_temp.money_shipment(201, 101, 11, 19);
select pg_temp.money_shipment(202, 102, 11, 19);
select pg_temp.money_shipment(203, 103, 11, 19);
select pg_temp.money_shipment(204, 104, 11, 19);
select pg_temp.money_payout_run(301, 11, 10, array[101]);
select pg_temp.money_payout_run(302, 11, 10, array[102], 'failed');

-- Inserts a run row directly; p_retry_of is the parent run number.
create function pg_temp.run_row(p_run integer, p_key text, p_seller uuid, p_amount integer,
  p_status text default 'pending_reconciliation', p_retry_of integer default null)
returns void language sql as $$
  insert into public.connect_payout_runs (id, idempotency_key, seller_id, amount, status, actor_id, retry_of_run_id)
  values (pg_temp.mu(p_run), p_key, p_seller, p_amount, p_status, pg_temp.mu(10), pg_temp.mu(p_retry_of))
$$;

create function pg_temp.map_row(p_run integer, p_shipment uuid, p_net integer, p_status text)
returns void language sql as $$
  insert into public.connect_payout_run_shipments (run_id, shipment_id, net_payout, status)
  values (pg_temp.mu(p_run), p_shipment, p_net, p_status)
$$;

-- Shape with no behavior to observe: column types and nullability, the
-- lookup indexes and RLS.
select results_eq(
  $$select attname::text collate "default", format_type(atttypid, atttypmod), attnotnull from pg_attribute
    where attrelid = 'public.connect_payout_runs'::regclass
      and attname in ('id', 'idempotency_key', 'seller_id', 'amount', 'actor_id', 'stripe_payout_id', 'retry_of_run_id')
    order by attnum$$,
  $$values ('id', 'uuid', true), ('idempotency_key', 'text', true), ('seller_id', 'uuid', true),
    ('amount', 'integer', true), ('actor_id', 'uuid', true), ('stripe_payout_id', 'text', false),
    ('retry_of_run_id', 'uuid', false)$$,
  'connect_payout_runs keeps its key, money and actor columns'
);
select results_eq(
  $$select attname::text collate "default", format_type(atttypid, atttypmod), attnotnull from pg_attribute
    where attrelid = 'public.connect_payout_run_shipments'::regclass
      and attname in ('run_id', 'shipment_id', 'net_payout', 'status')
    order by attnum$$,
  $$values ('run_id', 'uuid', true), ('shipment_id', 'uuid', true), ('net_payout', 'integer', true),
    ('status', 'text', true)$$,
  'connect_payout_run_shipments maps a run to shipments with an integer net_payout'
);
select results_eq(
  $$select attname::text collate "default", format_type(atttypid, atttypmod), attnotnull from pg_attribute
    where attrelid = 'public.connect_payout_events'::regclass and attnum > 0 and not attisdropped
      and attname <> 'id'
    order by attnum$$,
  $$values ('stripe_event_id', 'text', true), ('event_type', 'text', true),
    ('stripe_payout_id', 'text', true), ('connect_payout_run_id', 'uuid', false),
    ('stripe_created', 'timestamp with time zone', true), ('received_at', 'timestamp with time zone', true),
    ('observed_payout_status', 'text', true), ('failure_code', 'text', false),
    ('failure_message', 'text', false), ('failure_balance_transaction', 'text', false)$$,
  'connect_payout_events records Stripe time, receipt time, observed state and failure evidence'
);
select has_index('public', 'connect_payout_runs', 'idx_connect_payout_runs_seller_id', array['seller_id'], 'runs are indexed by seller');
select has_index('public', 'connect_payout_run_shipments', 'idx_connect_payout_run_shipments_run_id', array['run_id'], 'mappings are indexed by run');
select has_index('public', 'connect_payout_run_shipments', 'idx_connect_payout_run_shipments_shipment_id', array['shipment_id'], 'mappings are indexed by shipment');
select has_index('public', 'connect_payout_events', 'idx_connect_payout_events_stripe_payout_id', array['stripe_payout_id', 'stripe_created'], 'events are indexed by payout in occurrence order');
select has_index('public', 'connect_payout_events', 'idx_connect_payout_events_run_id', array['connect_payout_run_id'], 'events are indexed by run');
select has_index('public', 'connect_payout_events', 'idx_connect_payout_events_event_type', array['event_type'], 'events are indexed by type');
select results_eq(
  $$select relname::text collate "default" from pg_class
    where oid in ('public.connect_payout_runs'::regclass, 'public.connect_payout_run_shipments'::regclass,
      'public.connect_payout_events'::regclass) and relrowsecurity order by relname$$,
  $$values ('connect_payout_events'), ('connect_payout_run_shipments'), ('connect_payout_runs')$$,
  'RLS is on for the three payout ledger tables'
);
select ok(
  obj_description('public.connect_payout_events'::regclass, 'pg_class') is not null
    and col_description('public.connect_payout_events'::regclass, 2) is not null
    and col_description('public.connect_payout_events'::regclass, 11) is not null,
  'connect_payout_events documents the table, stripe_event_id and failure_balance_transaction'
);

-- connect_payout_runs
select throws_ok($$select pg_temp.run_row(391, 'test-run-301', pg_temp.mu(11), 100)$$,
  '23505', null, 'an idempotency key starts one run only');
select throws_ok($$select pg_temp.run_row(392, 'k-392', pg_temp.mu(11), -1)$$,
  '23514', null, 'a run amount cannot be negative');
select throws_ok($$select pg_temp.run_row(393, 'k-393', pg_temp.mu(11), 100, 'processing')$$,
  '23514', null, 'a run status outside the five run states is rejected');
select throws_ok($$select pg_temp.run_row(394, 'k-394', pg_temp.mu(999), 100)$$,
  '23503', null, 'a run belongs to an existing seller profile');
select throws_ok($$select pg_temp.run_row(395, 'k-395', pg_temp.mu(11), 100, 'pending_reconciliation', 999)$$,
  '23503', null, 'a retry points to an existing run');
select lives_ok($$select pg_temp.run_row(303, 'k-303', pg_temp.mu(11), 100, 'pending_reconciliation', 302)$$,
  'a failed run gets a retry child');
select throws_ok($$select pg_temp.run_row(396, 'k-396', pg_temp.mu(11), 100, 'pending_reconciliation', 302)$$,
  '23505', null, 'a failed run gets one retry child only');
select lives_ok($$select pg_temp.run_row(304, 'k-304', pg_temp.mu(11), 100); select pg_temp.run_row(305, 'k-305', pg_temp.mu(11), 100)$$,
  'runs that retry nothing do not collide on the one-retry index');
select throws_ok($$delete from public.connect_payout_runs where id = pg_temp.mu(302)$$,
  '23503', null, 'a run with a retry child cannot be deleted');

-- connect_payout_run_shipments
select throws_ok($$select pg_temp.map_row(304, pg_temp.mu(101), 100, 'pending_reconciliation')$$,
  '23505', null, 'a shipment pending in one run cannot be mapped pending in another');
update public.connect_payout_run_shipments set status = 'paid' where run_id = pg_temp.mu(301);
select throws_ok($$select pg_temp.map_row(305, pg_temp.mu(101), 100, 'reconciliation_needed')$$,
  '23505', null, 'a paid shipment cannot be mapped again as reconciliation_needed');
select lives_ok($$select pg_temp.map_row(304, pg_temp.mu(102), 100, 'pending_reconciliation')$$,
  'a shipment whose earlier run failed can be mapped to a new run');
select throws_ok($$select pg_temp.map_row(304, pg_temp.mu(102), 100, 'failed')$$,
  '23505', null, 'a run maps each shipment once');
select throws_ok($$select pg_temp.map_row(305, pg_temp.mu(104), -1, 'failed')$$,
  '23514', null, 'a mapping net_payout cannot be negative');
select throws_ok($$select pg_temp.map_row(304, pg_temp.mu(104), 100, 'released')$$,
  '23514', null, 'a mapping status outside the five run states is rejected');
select throws_ok($$select pg_temp.map_row(305, pg_temp.mu(999), 100, 'pending_reconciliation')$$,
  '23503', null, 'a mapping points to an existing shipment');
select throws_ok($$select pg_temp.map_row(999, pg_temp.mu(104), 100, 'pending_reconciliation')$$,
  '23503', null, 'a mapping points to an existing run');
select pg_temp.map_row(305, pg_temp.mu(103), 100, 'pending_reconciliation');
delete from public.connect_payout_runs where id = pg_temp.mu(305);
select is((select count(*)::integer from public.connect_payout_run_shipments where shipment_id = pg_temp.mu(103)),
  0, 'deleting a run deletes its shipment mappings');
delete from public.order_items where shipment_id = pg_temp.mu(101);
select throws_like($$delete from public.shipments where id = pg_temp.mu(101)$$,
  '%connect_payout_run_shipments_shipment_id_fkey%', 'a shipment mapped to a run cannot be deleted');

-- connect_payout_events and fn_append_connect_payout_event
create function pg_temp.append_event(p_event text, p_type text default 'payout.paid', p_status text default 'paid')
returns boolean language sql as $$
  select public.fn_append_connect_payout_event(p_event, p_type, 'po_test_301', pg_temp.mu(301),
    now() - interval '1 minute', p_status, null, null, null)
$$;
select is(pg_temp.append_event('evt_test_1'), true, 'the first delivery of a Stripe event is recorded');
select is(pg_temp.append_event('evt_test_1'), false, 'a repeated delivery of the same Stripe event records nothing');
select results_eq(
  $$select event_type, stripe_payout_id, connect_payout_run_id, observed_payout_status, received_at = now()
    from public.connect_payout_events where stripe_event_id = 'evt_test_1'$$,
  $$values ('payout.paid', 'po_test_301', pg_temp.mu(301), 'paid', true)$$,
  'the Stripe event is stored once, with the receipt time of the first delivery'
);
select throws_ok($$select pg_temp.append_event('evt_test_2', 'payout.reversed')$$,
  'P0001', 'UNSUPPORTED_PAYOUT_EVENT_TYPE', 'the append RPC rejects an unsupported event type');
select throws_ok($$select pg_temp.append_event('evt_test_2', 'payout.paid', 'reversed')$$,
  'P0001', 'UNSUPPORTED_OBSERVED_PAYOUT_STATUS', 'the append RPC rejects an unsupported payout state');

create function pg_temp.event_row(p_event text, p_type text, p_status text, p_run integer default 301)
returns void language sql as $$
  insert into public.connect_payout_events (stripe_event_id, event_type, stripe_payout_id, connect_payout_run_id, stripe_created, observed_payout_status)
  values (p_event, p_type, 'po_test_301', pg_temp.mu(p_run), now(), p_status)
$$;
select throws_ok($$select pg_temp.event_row('evt_test_3', 'payout.reversed', 'paid')$$,
  '23514', null, 'the table rejects an unsupported event type');
select throws_ok($$select pg_temp.event_row('evt_test_3', 'payout.paid', 'reversed')$$,
  '23514', null, 'the table rejects an unsupported observed payout state');
select throws_ok($$select pg_temp.event_row('evt_test_1', 'payout.paid', 'paid')$$,
  '23505', null, 'the table keeps one row per Stripe event');
select throws_ok($$select pg_temp.event_row('evt_test_3', 'payout.paid', 'paid', 999)$$,
  '23503', null, 'an event points to an existing run or none');
select throws_ok($$update public.connect_payout_events set observed_payout_status = 'failed' where stripe_event_id = 'evt_test_1'$$,
  'P0001', 'connect_payout_events is append-only and immutable', 'an event cannot be updated');
select throws_ok($$delete from public.connect_payout_events where stripe_event_id = 'evt_test_1'$$,
  'P0001', 'connect_payout_events is append-only and immutable', 'an event cannot be deleted');

-- Grants. Clients reach none of the payout tables or RPCs; service_role
-- works through them.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok('select 1 from public.connect_payout_runs', '42501', null, 'anon cannot read payout runs');
select throws_ok('select 1 from public.connect_payout_run_shipments', '42501', null, 'anon cannot read payout run shipments');
select throws_ok('select 1 from public.connect_payout_events', '42501', null, 'anon cannot read payout events');
select throws_ok($$select public.fn_append_connect_payout_event('evt_test_4', 'payout.paid', 'po', null, now(), 'paid')$$,
  '42501', null, 'anon cannot append payout events');
reset role;
select set_config('request.jwt.claims', '{"sub": "' || pg_temp.mu(11) || '", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok('select 1 from public.connect_payout_runs', '42501', null, 'a seller cannot read payout runs');
select throws_ok('select 1 from public.connect_payout_run_shipments', '42501', null, 'a seller cannot read payout run shipments');
select throws_ok('select 1 from public.connect_payout_events', '42501', null, 'a seller cannot read payout events');
select throws_ok($$select public.fn_append_connect_payout_event('evt_test_4', 'payout.paid', 'po', null, now(), 'paid')$$,
  '42501', null, 'a seller cannot append payout events');
reset role;
select is(
  (select count(*)::integer from (values ('anon'), ('authenticated')) r(role)
    cross join (values ('public.connect_payout_runs'), ('public.connect_payout_run_shipments'), ('public.connect_payout_events')) t(tbl)
    cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)),
  0, 'anon and authenticated hold no privilege on the payout ledger tables'
);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is((select count(*)::integer from public.connect_payout_runs where seller_id = pg_temp.mu(11)),
  4, 'service_role reads payout runs');
select lives_ok($$update public.connect_payout_run_shipments set updated_at = now() where run_id = pg_temp.mu(301)$$,
  'service_role writes payout run shipments');
select is(public.fn_append_connect_payout_event('evt_test_4', 'payout.paid', 'po_test_301', null, now(), 'paid'),
  true, 'service_role appends payout events through the RPC');
-- Like the remote project, service_role has no table privilege on the events:
-- it writes them only through the RPC (#367, fixed by the privilege parity of #365).
select throws_ok($$update public.connect_payout_events set failure_code = 'x' where stripe_event_id = 'evt_test_4'$$,
  '42501', null, 'service_role has no table privilege on payout events');
reset role;
select is_definer('public', 'fn_append_connect_payout_event',
  array['text', 'text', 'text', 'uuid', 'timestamp with time zone', 'text', 'text', 'text', 'text'],
  'the append RPC runs as its owner, so callers need no table privilege');

select * from finish();
rollback;
