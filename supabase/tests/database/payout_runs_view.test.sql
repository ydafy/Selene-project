-- admin_connect_payout_release_view and fn_get_admin_payout_queue: which
-- shipments the admin can release and why not, the selected run with its
-- paid_at, retry and manual-review flags, and how the queue groups, counts,
-- pages and selects them (#275, T3). The tables are in payout_runs.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(70);
\ir ../fixtures/money.psql

-- A completed shipment: completed p_ago ago with p_shipping_cost cents of label.
create function pg_temp.complete(p_shipment integer, p_shipping_cost integer, p_ago interval default '1 day')
returns void language sql as $$
  update public.shipments set status = 'completed', completed_at = now() - p_ago, shipping_cost = p_shipping_cost
  where id = pg_temp.mu(p_shipment)
$$;
create function pg_temp.connect_seller(p_seller integer, p_status public.stripe_onboarding_status default 'complete')
returns void language sql as $$
  update public.profiles_private set stripe_account_id = 'acct_test_' || p_seller, stripe_onboarding_status = p_status
  where id = pg_temp.mu(p_seller)
$$;
-- eligible:reason:release_amount_cents of one shipment.
create function pg_temp.gate(p_shipment integer) returns text language sql as $$
  select is_eligible || ':' || coalesce(ineligible_reason, '-') || ':' || release_amount_cents
  from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(p_shipment)
$$;
-- run status:retryable:manual review of one shipment.
create function pg_temp.run_flags(p_shipment integer) returns text language sql as $$
  select coalesce(payout_run_status, '-') || ':' || is_retryable || ':' || requires_manual_review
  from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(p_shipment)
$$;

-- Admin 10, buyer 19; seller 11 is payout-ready, 12 has no Stripe account,
-- 13 has not finished onboarding. Shipment n belongs to order n + 100.
select pg_temp.money_user(10, 'admin');
select pg_temp.money_user(19);
select pg_temp.money_user(11);
select pg_temp.money_user(12);
select pg_temp.money_user(13);
select pg_temp.connect_seller(11);
select pg_temp.connect_seller(13, 'pending');

select pg_temp.money_shipment(n + 100, n, 11, 19) from generate_series(101, 115) as n;
select pg_temp.money_shipment(216, 116, 12, 19);
select pg_temp.money_shipment(217, 117, 13, 19);
select pg_temp.money_shipment(n + 100, n, 11, 19) from generate_series(118, 119) as n;
update public.order_items set net_payout_cents = 470000 where shipment_id in (pg_temp.mu(101), pg_temp.mu(102), pg_temp.mu(103));
update public.order_items set net_payout_cents = 10000 where shipment_id = pg_temp.mu(104);
select pg_temp.complete(101, 28700);
select pg_temp.complete(102, 0);
select pg_temp.complete(103, null);
select pg_temp.complete(104, 12000);
-- 105 stays delivered.
select pg_temp.complete(106, 1000);
update public.shipments set completed_at = null where id = pg_temp.mu(106);
select pg_temp.complete(n, 1000) from generate_series(107, 117) as n;
update public.shipments set stripe_payment_intent_id = null where id = pg_temp.mu(107);
select pg_temp.money_dispute(401, 108);
select pg_temp.money_payout_run(301, 11, 10, array[109]);
select pg_temp.money_payout_run(302, 11, 10, array[110], 'reconciliation_needed');
select pg_temp.money_payout_run(303, 11, 10, array[111], 'failed');
select pg_temp.money_payout_run(304, 11, 10, array[112], 'failed');
insert into public.connect_payout_runs (id, idempotency_key, seller_id, amount, status, actor_id, retry_of_run_id)
values (pg_temp.mu(305), 'test-run-305', pg_temp.mu(11), 0, 'failed', pg_temp.mu(10), pg_temp.mu(304));
select pg_temp.money_payout_run(306, 11, 10, array[113], 'canceled');
select pg_temp.money_payout_run(307, 11, 10, array[114], 'paid');
update public.connect_payout_runs set paid_at = '2026-11-01 12:00+00' where id = pg_temp.mu(307);
-- 115: its run is still open but the mapping failed, so nothing protects it.
select pg_temp.money_payout_run(308, 11, 10, array[115], 'reconciliation_needed');
update public.connect_payout_run_shipments set status = 'failed' where run_id = pg_temp.mu(308);
-- 118 and 119: separate-charges orders (transfer group), with no label cost
-- recorded and with one.
select pg_temp.complete(118, null);
select pg_temp.complete(119, 1000);
update public.orders set stripe_transfer_group = 'tg_test_' || right(id::text, 3) where id in (pg_temp.mu(218), pg_temp.mu(219));

-- Eligibility gates, in the order the view reports them.
select is(pg_temp.gate(101), 'true:-:441300', 'a completed, paid, undisputed shipment of a ready seller is releasable for its net payout minus the label');
select is(pg_temp.gate(102), 'false:missing_shipping_cost:470000', 'a zero label cost blocks release');
select is(pg_temp.gate(103), 'false:missing_shipping_cost:470000', 'a missing label cost blocks release');
select is(pg_temp.gate(104), 'false:missing_release_amount:0', 'a label that eats the whole payout leaves nothing to release');
select is(pg_temp.gate(105), 'false:shipment_not_completed:90000', 'a shipment that is not completed is not releasable');
select is(pg_temp.gate(106), 'false:missing_completed_at:89000', 'a completed shipment without completed_at is not releasable');
select is(pg_temp.gate(107), 'false:missing_connect_payment_intent:89000', 'a shipment without a Connect payment intent is not releasable');
select is(pg_temp.gate(108), 'false:active_dispute:89000', 'an open dispute blocks release');
select is(pg_temp.gate(109), 'false:already_released:89000', 'a shipment pending in a run is not released twice');
select is(pg_temp.gate(110), 'false:already_released:89000', 'a shipment awaiting reconciliation is not released twice');
select is(pg_temp.gate(114), 'false:already_released:89000', 'a paid shipment is not released twice');
select is(pg_temp.gate(111), 'false:payout_failed_retry_required:89000', 'a failed run sends its shipment to retry');
select is(pg_temp.gate(113), 'false:payout_canceled_manual_review:89000', 'a canceled run sends its shipment to manual review');
select is(pg_temp.gate(115), 'false:payout_run_history_requires_review:89000', 'any other run history blocks release until reviewed');
select is(pg_temp.gate(116), 'false:missing_stripe_account:89000', 'a seller without a Stripe account cannot be paid');
select is(pg_temp.gate(117), 'false:seller_not_payout_ready:89000', 'a seller who has not finished onboarding cannot be paid');
select is(pg_temp.gate(118), 'true:-:90000', 'a transfer-group order needs no label cost');
select is(pg_temp.gate(119), 'true:-:90000', 'a transfer-group order releases the full net payout, label not deducted');
update public.disputes set status = 'rejected' where id = pg_temp.mu(401);
select is(pg_temp.gate(108), 'true:-:89000', 'a rejected dispute no longer blocks release');
update public.shipments set status = 'delivered', stripe_payment_intent_id = null where id = pg_temp.mu(116);
select is(pg_temp.gate(116), 'false:shipment_not_completed:89000', 'the first failing gate is the one reported');

-- Why the seller's account cannot be paid (#549), and how long the shipment
-- has been held. Seller 14 was rejected; 15, 16 and 17 finished onboarding
-- but Stripe disabled payouts, the bank account errored, or a refresh is open.
-- The reason never changes eligibility: the release path refuses the account.
create function pg_temp.block(p_shipment integer) returns text language sql as $$
  select coalesce(seller_payout_block_reason, '-')
  from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(p_shipment)
$$;
create function pg_temp.days(p_shipment integer) returns integer language sql as $$
  select days_since_completed from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(p_shipment)
$$;
select pg_temp.money_user(n) from generate_series(14, 17) as n;
select pg_temp.connect_seller(14, 'rejected');
select pg_temp.connect_seller(n) from generate_series(15, 17) as n;
insert into internal.connect_account_actionability (stripe_account_id, is_actionable, blocked_reason, stripe_created, refresh_pending)
values ('acct_test_15', false, 'payouts_disabled', now(), false),
  ('acct_test_16', false, 'errored', now(), false),
  ('acct_test_17', true, null, now(), true);
select pg_temp.money_shipment(220, 120, 14, 19);
select pg_temp.money_shipment(221, 121, 15, 19);
select pg_temp.money_shipment(222, 122, 16, 19);
select pg_temp.money_shipment(223, 123, 17, 19);
select pg_temp.money_shipment(224, 124, 15, 19);
select pg_temp.complete(120, 1000, '10 days 3 hours');
select pg_temp.complete(n, 1000) from generate_series(121, 123) as n;
-- 124 stays delivered.
select is(pg_temp.block(117), 'onboarding_pending', 'a seller who has not finished onboarding is blocked by pending onboarding');
select is(pg_temp.block(120), 'onboarding_rejected', 'a seller Stripe rejected is blocked by the rejection');
select is(pg_temp.block(121), 'payouts_disabled', 'a seller whose payouts Stripe disabled shows that reason');
select is(pg_temp.gate(121), 'true:-:89000', 'the block reason leaves eligibility as it was');
select is(pg_temp.block(122), 'errored', 'a seller whose bank account errored shows the bank status');
select is(pg_temp.block(123), 'account_refresh_pending', 'an open account refresh shows as pending');
select is(pg_temp.block(101), '-', 'a payout-ready seller has no block reason');
select is(pg_temp.block(124), '-', 'a shipment that is not completed has no block reason');
select is(pg_temp.days(120), 10, 'days since completed_at count whole days');
select is(pg_temp.days(101), 1, 'a shipment completed one day ago is one day held');
select is(pg_temp.days(105), null, 'a shipment that is not completed has no days held');

-- The selected run and its flags.
select is(pg_temp.run_flags(101), '-:false:false', 'a shipment with no run is neither retryable nor in manual review');
select is(pg_temp.run_flags(111), 'failed:true:false', 'a failed run with no retry child is retryable');
select is(pg_temp.run_flags(112), 'failed:false:false', 'a failed run that already has a retry child is not retryable');
select is(pg_temp.run_flags(113), 'canceled:false:true', 'a canceled run needs manual review, not a retry');
select pg_temp.money_payout_run(309, 11, 10, array[111]);
select pg_temp.money_payout_run(310, 11, 10, array[111], 'failed');
select is(pg_temp.run_flags(111), 'failed:false:false', 'a failed run whose shipment is protected by another run is not retryable');
select is((select payout_run_id from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(111)),
  pg_temp.mu(310), 'a shipment shows its latest run');
select is(
  (select payout_run_paid_at from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(114)),
  '2026-11-01 12:00+00'::timestamptz, 'the view exposes the paid_at of the selected run');
select is(
  (select payout_run_paid_at from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(109)),
  null, 'a run that is not paid has no paid_at, and none is invented');
select results_eq(
  $$select attname::text collate "default" from pg_attribute
    where attrelid = 'public.admin_connect_payout_release_view'::regclass and attnum > 0
    order by attnum desc limit 3$$,
  $$values ('days_since_completed'), ('seller_payout_block_reason'), ('payout_run_paid_at')$$,
  'the view appends payout_run_paid_at, seller_payout_block_reason and days_since_completed last');
select ok(
  (select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.admin_connect_payout_release_view'::regclass),
  'the view reads with the caller''s privileges');

-- Admin payout queue. Sellers 7001-7003 are the only users whose name has
-- money_70. 7001 has 21 paid runs (history; run 7321 has no paid_at); 7002
-- has two releasable shipments (ready); 7003 has a shipment in transit
-- (ready, not selectable), one pending run of two shipments (processing), a
-- retryable failed run, a failed run already retried and a canceled run
-- (action required).
select pg_temp.money_user(n) from generate_series(7001, 7003) as n;
select pg_temp.connect_seller(7002);
select pg_temp.money_shipment(n + 100, n, 7001, 19) from generate_series(7101, 7121) as n;
select pg_temp.money_payout_run(n + 200, 7001, 10, array[n], 'paid') from generate_series(7101, 7121) as n;
update public.connect_payout_runs
set paid_at = '2026-11-01'::timestamptz + (right(id::text, 4)::integer - 7300) * interval '1 hour'
where seller_id = pg_temp.mu(7001) and id <> pg_temp.mu(7321);
select pg_temp.money_shipment(n + 100, n, 7002, 19) from generate_series(7131, 7132) as n;
select pg_temp.complete(7131, 1000, '1 hour');
select pg_temp.complete(7132, 1000, '2 hours');
select pg_temp.money_shipment(n + 100, n, 7003, 19, 'shipped') from generate_series(7141, 7146) as n;
select pg_temp.money_payout_run(7342, 7003, 10, array[7142, 7143]);
select pg_temp.money_payout_run(7344, 7003, 10, array[7144], 'failed');
select pg_temp.money_payout_run(7345, 7003, 10, array[7145], 'canceled');
select pg_temp.money_payout_run(7346, 7003, 10, array[7146], 'failed');
insert into public.connect_payout_runs (id, idempotency_key, seller_id, amount, status, actor_id, retry_of_run_id)
values (pg_temp.mu(7347), 'test-run-7347', pg_temp.mu(7003), 0, 'failed', pg_temp.mu(10), pg_temp.mu(7346));

create function pg_temp.q(p_bucket text, p_page integer default 0, p_scope text default 'page', p_search text default 'money_70')
returns jsonb language sql as $$ select public.fn_get_admin_payout_queue(p_search, p_bucket, p_page, p_scope) $$;
-- The shipment numbers of the returned rows, in order.
create function pg_temp.q_rows(p_result jsonb) returns integer[] language sql as $$
  select coalesce(array_agg(right(r ->> 'shipment_id', 4)::integer order by o), '{}')
  from jsonb_array_elements(p_result -> 'rows') with ordinality as e(r, o)
$$;

select throws_ok($$select pg_temp.q('paid')$$, 'P0001', 'INVALID_QUEUE_BUCKET', 'an unknown bucket is rejected');
select throws_ok($$select pg_temp.q(null)$$, 'P0001', 'INVALID_QUEUE_BUCKET', 'a missing bucket is rejected');
select throws_ok($$select pg_temp.q('ready', 0, 'all')$$, 'P0001', 'INVALID_QUEUE_SCOPE', 'an unknown scope is rejected');
select throws_ok($$select pg_temp.q('ready', -1)$$, 'P0001', 'INVALID_QUEUE_PAGE', 'a negative page is rejected');
select throws_ok($$select pg_temp.q('ready', null)$$, 'P0001', 'INVALID_QUEUE_PAGE', 'a missing page is rejected');
select throws_ok($$select pg_temp.q('processing', 0, 'selection')$$, 'P0001', 'QUEUE_SELECTION_NOT_ALLOWED', 'only ready and action-required groups can be selected');
select throws_ok($$select pg_temp.q('history', 0, 'selection')$$, 'P0001', 'QUEUE_SELECTION_NOT_ALLOWED', 'history groups cannot be selected');

select is(pg_temp.q('ready') -> 'counts', '{"ready": 2, "processing": 1, "action-required": 3, "history": 21}'::jsonb,
  'counts are in groups: one per seller without a run, one per run');
select is(pg_temp.q_rows(pg_temp.q('ready')), array[7132, 7131, 7141],
  'ready groups follow the seller name, and each group lists its shipments by completion time');
select is(pg_temp.q_rows(pg_temp.q('processing')), array[7142, 7143], 'the shipments of a run stay together in one group');
select is(pg_temp.q('history') - 'rows' - 'counts',
  '{"bucket": "history", "scope": "page", "page": 0, "pageSize": 20, "totalGroups": 21, "totalPages": 2, "selectedGroupCount": 0, "selectionComplete": false}'::jsonb,
  'a page reports its bucket, page and totals');
select is(pg_temp.q_rows(pg_temp.q('history')), array(select n from generate_series(7120, 7101, -1) as n),
  'history pages hold 20 groups, most recently paid first');
select is(pg_temp.q_rows(pg_temp.q('history', 1)), array[7121], 'a run without paid_at comes last in history');
select is(pg_temp.q('history', 9) -> 'page', '1'::jsonb, 'a page past the end returns the last page');
select is(pg_temp.q_rows(pg_temp.q('history', 9)), array[7121], 'the last page holds the remaining groups');
select is(pg_temp.q('processing', 3, 'page', '%') -> 'totalPages', '1'::jsonb, 'an empty bucket still has one page');
select is(pg_temp.q('ready', 5, 'selection') - 'rows' - 'counts',
  '{"bucket": "ready", "scope": "selection", "page": 0, "pageSize": 20, "totalGroups": 2, "totalPages": 1, "selectedGroupCount": 1, "selectionComplete": true}'::jsonb,
  'a selection ignores the page and reports a complete set');
select is(pg_temp.q_rows(pg_temp.q('ready', 0, 'selection')), array[7132, 7131], 'selecting ready groups takes only groups with a releasable shipment');
select is(pg_temp.q_rows(pg_temp.q('action-required', 0, 'selection')), array[7144], 'selecting action-required groups takes only retryable failed runs');
select is(pg_temp.q('ready', 0, 'page', 'MONEY_70') -> 'counts', pg_temp.q('ready') -> 'counts', 'the seller search ignores case');
select is(pg_temp.q('ready', 0, 'page', '  money_7002 ') -> 'counts' -> 'ready', '1'::jsonb, 'the seller search ignores surrounding spaces');
select is(pg_temp.q('ready', 0, 'page', '%') -> 'counts',
  '{"ready": 0, "processing": 0, "action-required": 0, "history": 0}'::jsonb, 'the seller search is literal, not a pattern');

-- Grants: only service_role reads the view and runs the queue RPC. The
-- authenticated read of the view is disputed in #178 and not asserted here.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok('select 1 from public.admin_connect_payout_release_view', '42501', null, 'anon cannot read the release view');
select throws_ok($$select public.fn_get_admin_payout_queue('', 'ready', 0, 'page')$$, '42501', null, 'anon cannot run the payout queue');
reset role;
select set_config('request.jwt.claims', '{"sub": "' || pg_temp.mu(10) || '", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.fn_get_admin_payout_queue('', 'ready', 0, 'page')$$, '42501', null, 'not even an admin session runs the payout queue directly');
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(pg_temp.gate(101), 'true:-:441300', 'service_role reads the release view');
select is(pg_temp.q('ready') -> 'counts' -> 'ready', '2'::jsonb, 'service_role runs the payout queue');
reset role;
select isnt_definer('public', 'fn_get_admin_payout_queue', array['text', 'text', 'integer', 'text'],
  'the queue reads with the caller''s privileges');
select volatility_is('public', 'fn_get_admin_payout_queue', array['text', 'text', 'integer', 'text'], 'stable',
  'the queue is stable, so it cannot write');

select * from finish();
rollback;
