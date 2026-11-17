-- Overdue held payouts (#549 Part B, odd/tasks/held-payout-overdue-refund.md
-- T1, S1 and S2): admin_connect_payout_release_view marks a completed, unpaid
-- shipment whose transfer never started and whose seller cannot be paid as
-- overdue 30 days after completed_at; fn_get_admin_payout_queue moves it from
-- ready to the overdue bucket, and back once the account is payable; an admin
-- keeps holding it with a note through fn_admin_record_payout_hold_note.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(53);
\ir ../fixtures/money.psql

create function pg_temp.complete(p_shipment integer, p_ago interval)
returns void language sql as $$
  update public.shipments set status = 'completed', completed_at = now() - p_ago, shipping_cost_cents = 1000
  where id = pg_temp.mu(p_shipment)
$$;
create function pg_temp.connect_seller(p_seller integer, p_status public.stripe_onboarding_status default 'complete')
returns void language sql as $$
  update public.profiles_private set stripe_account_id = 'acct_test_' || p_seller, stripe_onboarding_status = p_status
  where id = pg_temp.mu(p_seller)
$$;
create function pg_temp.overdue(p_shipment integer) returns boolean language sql as $$
  select is_payout_overdue from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(p_shipment)
$$;
-- eligible:reason of one shipment, to show the overdue flag never changes it.
create function pg_temp.gate(p_shipment integer) returns text language sql as $$
  select is_eligible || ':' || coalesce(ineligible_reason, '-')
  from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(p_shipment)
$$;
create function pg_temp.q(p_bucket text, p_scope text default 'page')
returns jsonb language sql as $$ select public.fn_get_admin_payout_queue('money_801', p_bucket, 0, p_scope) $$;
create function pg_temp.q_rows(p_result jsonb) returns integer[] language sql as $$
  select coalesce(array_agg(right(r ->> 'shipment_id', 4)::integer order by o), '{}')
  from jsonb_array_elements(p_result -> 'rows') with ordinality as e(r, o)
$$;
create function pg_temp.note(p_admin integer, p_shipment integer, p_note text)
returns public.shipment_payout_hold_notes language sql as $$
  select * from public.fn_admin_record_payout_hold_note(pg_temp.mu(p_admin), pg_temp.mu(p_shipment), p_note)
$$;
create function pg_temp.stored() returns text language sql as $$
  select (select count(*) from public.shipment_payout_hold_notes where shipment_id in (
      select pg_temp.mu(n) from generate_series(8101, 8108) as n)) || ':' ||
    (select count(*) from public.admin_audit_logs where action_type = 'PAYOUT_HOLD_NOTED'
      and target_id in (select pg_temp.mu(n) from generate_series(8101, 8108) as n))
$$;

-- Admin 8010, suspended admin 8018, buyer 8019. Seller 8011 finished
-- onboarding but Stripe disabled payouts; 8012 was rejected; 8013 is payable.
-- Shipment n belongs to order n + 100.
select pg_temp.money_user(8010, 'admin');
select pg_temp.money_user(8018, 'admin');
update public.profiles_private set status = 'suspended' where id = pg_temp.mu(8018);
select pg_temp.money_user(n) from generate_series(8011, 8013) as n;
select pg_temp.money_user(8019);
select pg_temp.connect_seller(8011);
select pg_temp.connect_seller(8012, 'rejected');
select pg_temp.connect_seller(8013);
insert into internal.connect_account_actionability (stripe_account_id, is_actionable, blocked_reason, stripe_created)
values ('acct_test_8011', false, 'payouts_disabled', now()),
  ('acct_test_8013', true, null, now());

select pg_temp.money_shipment(n + 100, n, 8011, 8019) from generate_series(8101, 8102) as n;
select pg_temp.money_shipment(8203, 8103, 8012, 8019);
select pg_temp.money_shipment(8204, 8104, 8013, 8019);
select pg_temp.money_shipment(n + 100, n, 8011, 8019) from generate_series(8105, 8108) as n;
-- 8201 is a separate-charges order, so 8101 is eligible apart from the overdue flag.
update public.orders set stripe_transfer_group = 'tg_test_' || right(id::text, 4)
where id in (pg_temp.mu(8201), pg_temp.mu(8203));
select pg_temp.complete(8101, '30 days');
select pg_temp.complete(8102, '29 days 23 hours 59 minutes');
select pg_temp.complete(8103, '45 days');
select pg_temp.complete(n, '40 days') from generate_series(8104, 8107) as n;
-- 8105: a transfer was started in a run that later failed.
select pg_temp.money_payout_run(8305, 8011, 8010, array[8105], 'failed');
update public.connect_payout_run_shipments
set transfer_started_at = now() - interval '35 days', transfer_token = gen_random_uuid()
where run_id = pg_temp.mu(8305);
update public.shipments set stripe_transfer_id = 'tr_test_8106' where id = pg_temp.mu(8106);
update public.shipments set stripe_payout_id = 'po_test_8107' where id = pg_temp.mu(8107);
-- 8108 stays delivered.

-- The overdue flag.
select is(pg_temp.overdue(8101), true, 'a held shipment is overdue 30 days after completed_at');
select is(pg_temp.overdue(8102), false, 'a held shipment is not overdue one minute before 30 days');
select is(pg_temp.overdue(8103), true, 'a shipment of a rejected seller is overdue after 30 days');
select is(pg_temp.overdue(8104), false, 'a shipment of a payable seller is never overdue');
select is(
  (select seller_payout_block_reason from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(8105)),
  'payouts_disabled', 'the started transfer still shows the block reason');
select is(pg_temp.overdue(8105), false, 'a shipment whose transfer was ever started is never overdue');
select is(pg_temp.overdue(8106), false, 'a shipment with a Stripe transfer is never overdue');
select is(pg_temp.overdue(8107), false, 'a shipment with a Stripe payout is never overdue');
select is(pg_temp.overdue(8108), false, 'a shipment that is not completed is never overdue');
select is(pg_temp.gate(8101), 'true:-', 'overdue leaves eligibility as it was (the release path refuses the account)');
select is(pg_temp.gate(8103), 'false:seller_not_payout_ready', 'overdue leaves the ineligible reason as it was');
select is(
  (select latest_hold_note || latest_hold_noted_at::text || latest_hold_noted_by::text
   from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(8101)),
  null, 'a shipment without hold notes has no latest note');
select results_eq(
  $$select attname::text collate "default" from pg_attribute
    where attrelid = 'public.admin_connect_payout_release_view'::regclass and attnum > 0
    order by attnum desc limit 5$$,
  $$values ('latest_hold_noted_by'), ('latest_hold_noted_at'), ('latest_hold_note'), ('is_payout_overdue'), ('days_since_completed')$$,
  'the view appends is_payout_overdue and the latest hold note last');

-- The overdue bucket.
select is(pg_temp.q('ready') -> 'counts',
  '{"ready": 2, "processing": 0, "action-required": 1, "history": 0, "overdue": 2}'::jsonb,
  'overdue shipments form their own seller groups in the overdue bucket');
select is(pg_temp.q_rows(pg_temp.q('overdue')), array[8101, 8103], 'the overdue bucket lists the overdue shipments by seller name');
select is(pg_temp.q_rows(pg_temp.q('ready')), array[8106, 8107, 8102, 8108, 8104],
  'an overdue shipment leaves the ready group of its seller');
select is(pg_temp.q_rows(pg_temp.q('action-required')), array[8105], 'a shipment in a run stays with its run');
select is(pg_temp.q('overdue') - 'rows' - 'counts',
  '{"bucket": "overdue", "scope": "page", "page": 0, "pageSize": 20, "totalGroups": 2, "totalPages": 1, "selectedGroupCount": 0, "selectionComplete": false}'::jsonb,
  'an overdue page reports its bucket and totals');
select throws_ok($$select pg_temp.q('overdue', 'selection')$$, 'P0001', 'QUEUE_SELECTION_NOT_ALLOWED',
  'overdue groups cannot be selected for release');

-- The note RPC refuses, and stores nothing.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select throws_ok($$select pg_temp.note(8019, 8101, 'Seguimos esperando la cuenta')$$, 'P0001', 'ADMIN_REQUIRED',
  'a user who is not an admin cannot record a hold note');
select throws_ok($$select pg_temp.note(8018, 8101, 'Seguimos esperando la cuenta')$$, 'P0001', 'ADMIN_REQUIRED',
  'a suspended admin cannot record a hold note');
select throws_ok(
  format('select public.fn_admin_record_payout_hold_note(null, %L, %L)', pg_temp.mu(8101), 'Nota'),
  'P0001', 'ADMIN_REQUIRED', 'a missing admin cannot record a hold note');
select throws_ok($$select pg_temp.note(8010, 8102, 'Seguimos esperando la cuenta')$$, 'P0001', 'PAYOUT_NOT_OVERDUE',
  'a shipment that is not overdue yet takes no hold note');
select throws_ok($$select pg_temp.note(8010, 8104, 'Seguimos esperando la cuenta')$$, 'P0001', 'PAYOUT_NOT_OVERDUE',
  'a shipment of a payable seller takes no hold note');
select throws_ok($$select pg_temp.note(8010, 8105, 'Seguimos esperando la cuenta')$$, 'P0001', 'PAYOUT_NOT_OVERDUE',
  'a shipment whose transfer started takes no hold note');
select throws_ok($$select pg_temp.note(8010, 8999, 'Seguimos esperando la cuenta')$$, 'P0001', 'SHIPMENT_NOT_FOUND',
  'an unknown shipment takes no hold note');
select throws_ok($$select pg_temp.note(8010, 8101, '')$$, 'P0001', 'INVALID_HOLD_NOTE', 'an empty note is rejected');
select throws_ok($$select pg_temp.note(8010, 8101, E'  \n ')$$, 'P0001', 'INVALID_HOLD_NOTE', 'a blank note is rejected');
select throws_ok($$select pg_temp.note(8010, 8101, null)$$, 'P0001', 'INVALID_HOLD_NOTE', 'a missing note is rejected');
select throws_ok($$select pg_temp.note(8010, 8101, repeat('a', 1001))$$, 'P0001', 'INVALID_HOLD_NOTE',
  'a note longer than 1000 characters is rejected');
select is(pg_temp.stored(), '0:0', 'a refused note leaves no note and no audit row');

-- The note RPC records.
select is(
  (select row(n.shipment_id, n.admin_id, n.note)::text from pg_temp.note(8010, 8101, '  Vendedor contactado, esperamos su banco  ') n),
  row(pg_temp.mu(8101), pg_temp.mu(8010), 'Vendedor contactado, esperamos su banco')::text,
  'an admin records a trimmed hold note and gets the row back');
select is(
  (select row(a.admin_id, a.details ->> 'note', a.details ->> 'note_id', a.details ->> 'seller_payout_block_reason',
     (a.details ->> 'days_since_completed')::integer)::text
   from public.admin_audit_logs a where a.action_type = 'PAYOUT_HOLD_NOTED' and a.target_id = pg_temp.mu(8101)),
  (select row(pg_temp.mu(8010), 'Vendedor contactado, esperamos su banco', n.id::text, 'payouts_disabled', 30)::text
   from public.shipment_payout_hold_notes n where n.shipment_id = pg_temp.mu(8101)),
  'the note is audited with the admin, the note, its id, the block reason and the days held');
select lives_ok($$select pg_temp.note(8010, 8101, repeat('b', 1000))$$, 'a note of exactly 1000 characters is accepted');
select lives_ok($$select pg_temp.note(8010, 8103, 'Cuenta rechazada, evaluar reembolso')$$, 'a rejected seller''s shipment takes a hold note');
select is(pg_temp.stored(), '3:3', 'each note has its audit row');
select is(
  (select latest_hold_note || ':' || latest_hold_noted_by from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(8101)),
  repeat('b', 1000) || ':' || pg_temp.mu(8010), 'the view shows the latest note and its admin');
select is(
  (select latest_hold_noted_at from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(8101)),
  (select max(created_at) from public.shipment_payout_hold_notes where shipment_id = pg_temp.mu(8101)),
  'the view shows when the latest note was written');
select throws_ok(
  format('insert into public.shipment_payout_hold_notes (shipment_id, admin_id, note) values (%L, %L, %L)',
    pg_temp.mu(8101), pg_temp.mu(8010), ' padded '),
  '23514', null, 'the table refuses an untrimmed note even from the server');
reset role;

-- A payable account sends the shipment back to ready, with its notes kept.
update internal.connect_account_actionability set is_actionable = true, blocked_reason = null
where stripe_account_id = 'acct_test_8011';
select is(pg_temp.overdue(8101), false, 'a shipment whose seller is payable again is no longer overdue');
select is(pg_temp.q('ready') -> 'counts',
  '{"ready": 2, "processing": 0, "action-required": 1, "history": 0, "overdue": 1}'::jsonb,
  'the shipment leaves the overdue bucket');
select is(pg_temp.q_rows(pg_temp.q('ready')), array[8106, 8107, 8101, 8102, 8108, 8104],
  'the shipment is back in the ready group of its seller');
select is(
  (select latest_hold_note from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(8101)),
  repeat('b', 1000), 'the hold notes stay with the shipment');

-- Clients reach neither the table nor the RPC.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok('select 1 from public.shipment_payout_hold_notes', '42501', null, 'anon cannot read hold notes');
select throws_ok(
  format('insert into public.shipment_payout_hold_notes (shipment_id, admin_id, note) values (%L, %L, %L)',
    pg_temp.mu(8101), pg_temp.mu(8010), 'x'),
  '42501', null, 'anon cannot write hold notes');
select throws_ok(
  format('select public.fn_admin_record_payout_hold_note(%L, %L, %L)', pg_temp.mu(8010), pg_temp.mu(8103), 'x'),
  '42501', null, 'anon cannot run the hold note RPC');
reset role;
select set_config('request.jwt.claims', '{"sub": "' || pg_temp.mu(8010) || '", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok('select 1 from public.shipment_payout_hold_notes', '42501', null, 'not even an admin session reads hold notes directly');
select throws_ok(
  format('insert into public.shipment_payout_hold_notes (shipment_id, admin_id, note) values (%L, %L, %L)',
    pg_temp.mu(8101), pg_temp.mu(8010), 'x'),
  '42501', null, 'not even an admin session writes hold notes directly');
select throws_ok(
  format('select public.fn_admin_record_payout_hold_note(%L, %L, %L)', pg_temp.mu(8010), pg_temp.mu(8103), 'x'),
  '42501', null, 'not even an admin session runs the hold note RPC directly');
reset role;
select is(pg_temp.stored(), '3:3', 'denied clients stored nothing');
select ok((select relrowsecurity from pg_class where oid = 'public.shipment_payout_hold_notes'::regclass),
  'hold notes keep RLS on');
select isnt_definer('public', 'fn_admin_record_payout_hold_note', array['uuid', 'uuid', 'text'],
  'the hold note RPC runs with the caller''s privileges');
select ok(
  has_function_privilege('service_role', 'public.fn_admin_record_payout_hold_note(uuid, uuid, text)', 'EXECUTE'),
  'service_role runs the hold note RPC');

select * from finish();
rollback;
