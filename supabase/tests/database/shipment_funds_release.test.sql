-- Fund release (#275 T2): fn_release_shipment_funds completes a delivered,
-- undisputed Connect shipment past the 48-hour grace period and refuses the
-- rest without changing it; fn_cron_dispute_shipping_timeout resolves the
-- dispute, releases and notifies, or rolls the resolution back when the release
-- refuses; fn_complete_shipment_transfer writes the seller funds-released
-- notice; admin_connect_payout_release_view computes the release amount.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(55);
\ir ../fixtures/money.psql

-- Users: 2001 seller, 2002 buyer, 2003 admin.
select pg_temp.money_user(2001);
select pg_temp.money_user(2002);
select pg_temp.money_user(2003, 'admin');

-- status|completed_at|updated_at of a shipment, to prove a refusal changed nothing.
create function pg_temp.ship_sig(p_n integer) returns text language sql as $$
  select s.status::text || '|' || coalesce(s.completed_at::text, '-') || '|' || s.updated_at::text
  from public.shipments s where s.id = pg_temp.mu(p_n)
$$;

-- success:error_message of a release, called as service_role.
create function pg_temp.release(p_n integer) returns text language sql as $$
  select r.success::text || ':' || coalesce(r.error_message, '-')
  from public.fn_release_shipment_funds(pg_temp.mu(p_n)) r
$$;

-- 1. Grants and security mode ------------------------------------------------------
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
-- anon has no read on shipments either, so a call would fail anyway: check the grant itself.
select is(has_function_privilege('anon', 'public.fn_release_shipment_funds(uuid)', 'execute'), false,
  'anon cannot execute fn_release_shipment_funds');
select throws_ok($$select public.fn_cron_dispute_shipping_timeout()$$,
  '42501', null, 'anon cannot execute fn_cron_dispute_shipping_timeout');
select throws_ok($$select public.fn_complete_shipment_transfer(gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), 'tr_x')$$,
  '42501', null, 'anon cannot execute fn_complete_shipment_transfer');
select set_config('request.jwt.claims', '{"sub": "f0000000-0000-4000-8000-000000002001", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.fn_release_shipment_funds(gen_random_uuid())$$,
  '42501', null, 'authenticated cannot execute fn_release_shipment_funds');
select throws_ok($$select public.fn_cron_dispute_shipping_timeout()$$,
  '42501', null, 'authenticated cannot execute fn_cron_dispute_shipping_timeout');
select throws_ok($$select public.fn_complete_shipment_transfer(gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), 'tr_x')$$,
  '42501', null, 'authenticated cannot execute fn_complete_shipment_transfer');
reset role;
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_release_shipment_funds', 'fn_cron_dispute_shipping_timeout', 'fn_complete_shipment_transfer')),
  'fn_complete_shipment_transfer:true:search_path="" fn_cron_dispute_shipping_timeout:true:search_path=public fn_release_shipment_funds:false:search_path=public, pg_temp',
  'security mode and search_path: the release runs as its caller, the cron and the transfer completion as definer');

-- 2. fn_release_shipment_funds refusals, in check order -----------------------------
-- 2101: no Connect payment and not delivered: the Connect check comes first.
select pg_temp.money_shipment(2201, 2101, 2001, 2002, 'paid', null, 90000, null);
-- 2102: Connect, shipped, never delivered, with an open dispute: delivery before dispute.
select pg_temp.money_shipment(2202, 2102, 2001, 2002, 'shipped');
select pg_temp.money_dispute(2301, 2102);
-- 2103: delivered 1 hour ago with an open dispute: dispute before grace period.
select pg_temp.money_shipment(2203, 2103, 2001, 2002, 'delivered', interval '1 hour');
select pg_temp.money_dispute(2302, 2103);
-- 2104: delivered 47 hours ago. 2105: delivered with no delivered_at.
select pg_temp.money_shipment(2204, 2104, 2001, 2002, 'delivered', interval '47 hours');
select pg_temp.money_shipment(2205, 2105, 2001, 2002, 'delivered');
-- 2106-2109: past the grace period, each with one active dispute status.
select pg_temp.money_shipment(2206, 2106, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2306, 2106, 'under_review');
select pg_temp.money_shipment(2207, 2107, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2307, 2107, 'waiting_return');
select pg_temp.money_shipment(2208, 2108, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2308, 2108, 'return_shipped');
select pg_temp.money_shipment(2209, 2109, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2309, 2109, 'return_delivered');
-- 2110: exactly 48 hours with a resolved dispute; 2111: a rejected dispute. Both release.
select pg_temp.money_shipment(2210, 2110, 2001, 2002, 'delivered', interval '48 hours');
select pg_temp.money_dispute(2310, 2110, 'resolved');
select pg_temp.money_shipment(2211, 2111, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2311, 2111, 'rejected');
update public.shipments set updated_at = now() - interval '10 days'
where id in (select pg_temp.mu(n) from generate_series(2101, 2111) n);
create table pg_temp.sig (n integer primary key, v text);
insert into pg_temp.sig select n, pg_temp.ship_sig(n) from generate_series(2101, 2111) n;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
create temp table rel_result on commit drop as
select n, pg_temp.release(n) as r from (values (2100), (2101), (2102), (2103), (2104), (2105),
  (2106), (2107), (2108), (2109), (2110), (2111)) v(n);
reset role;
select is((select r from rel_result where n = 2100), 'false:SHIPMENT_NOT_FOUND', 'release: an unknown shipment is SHIPMENT_NOT_FOUND');
select is((select r from rel_result where n = 2101), 'false:SHIPMENT_NOT_CONNECT',
  'release: a shipment without a Connect payment is SHIPMENT_NOT_CONNECT, checked before delivery');
select is((select r from rel_result where n = 2102), 'false:SHIPMENT_NOT_DELIVERED',
  'release: an undelivered shipment is SHIPMENT_NOT_DELIVERED, checked before the dispute');
select is((select r from rel_result where n = 2103), 'false:SHIPMENT_IN_ACTIVE_DISPUTE',
  'release: an open dispute is SHIPMENT_IN_ACTIVE_DISPUTE, checked before the grace period');
select is((select r from rel_result where n = 2104), 'false:GRACE_PERIOD_ACTIVE', 'release: 47 hours after delivery is GRACE_PERIOD_ACTIVE');
select is((select r from rel_result where n = 2105), 'false:GRACE_PERIOD_ACTIVE', 'release: a delivered shipment without delivered_at is GRACE_PERIOD_ACTIVE');
select is(
  (select string_agg(r, ',' order by n) from rel_result where n between 2106 and 2109),
  'false:SHIPMENT_IN_ACTIVE_DISPUTE,false:SHIPMENT_IN_ACTIVE_DISPUTE,false:SHIPMENT_IN_ACTIVE_DISPUTE,false:SHIPMENT_IN_ACTIVE_DISPUTE',
  'release: under_review, waiting_return, return_shipped and return_delivered disputes are active');
select is(
  (select count(*) from pg_temp.sig where n between 2101 and 2109 and v is distinct from pg_temp.ship_sig(n)),
  0::bigint, 'release: every refusal leaves its shipment unchanged');
select is((select string_agg(r, ',' order by n) from rel_result where n in (2110, 2111)),
  'true:CONNECT_SHIPMENT_SKIPPED_WALLET,true:CONNECT_SHIPMENT_SKIPPED_WALLET',
  'release: delivered exactly 48 hours ago with a resolved dispute, or with a rejected one, releases');
select is(
  (select status::text || ':' || (completed_at = now())::text || ':' || (updated_at = now())::text
   from public.shipments where id = pg_temp.mu(2110)),
  'completed:true:true', 'release: the shipment is completed with completed_at and updated_at set');

set local role service_role;
select is(pg_temp.release(2110), 'false:SHIPMENT_NOT_DELIVERED', 'release: a second call refuses the completed shipment');
reset role;

-- An error inside the release is logged and returned, and changes nothing.
create function pg_temp.fail_release() returns trigger language plpgsql as $$
begin
  raise exception 'TEST_RELEASE_FAILURE';
end $$;
create trigger t2_fail_release before update on public.shipments
  for each row when (new.id = 'f0000000-0000-4000-8000-000000002106'::uuid)
  execute function pg_temp.fail_release();
update public.disputes set status = 'resolved' where id = pg_temp.mu(2306);
set local role service_role;
select is(pg_temp.release(2106), 'false:TEST_RELEASE_FAILURE', 'release: an error is returned as the error message');
reset role;
drop trigger t2_fail_release on public.shipments;
select is(
  (select count(*) from public.system_logs
   where level = 'ERROR' and message = 'Fallo en fn_release_shipment_funds'
     and metadata = jsonb_build_object('shipment_id', pg_temp.mu(2106), 'error', 'TEST_RELEASE_FAILURE')),
  1::bigint, 'release: the error is logged with the shipment');
select is(pg_temp.ship_sig(2106), (select v from pg_temp.sig where n = 2106), 'release: the failed release leaves the shipment unchanged');

-- 3. fn_cron_dispute_shipping_timeout ------------------------------------------------
-- 2121: due dispute on a shipment past the grace period: resolved and released.
-- 2122: due dispute on a shipment in the grace period: the release refuses.
-- 2123-2125, 2127: outside the selection (47 hours, tracking number, payout
-- pending, not waiting for the return). 2126: due dispute without a shipment.
select pg_temp.money_shipment(2221, 2121, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2321, 2121, 'waiting_return');
select pg_temp.money_shipment(2222, 2122, 2001, 2002, 'delivered', interval '1 hour');
select pg_temp.money_dispute(2322, 2122, 'waiting_return');
select pg_temp.money_shipment(2223, 2123, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2323, 2123, 'waiting_return');
select pg_temp.money_shipment(2224, 2124, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2324, 2124, 'waiting_return');
select pg_temp.money_shipment(2225, 2125, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2325, 2125, 'waiting_return');
select pg_temp.money_shipment(2226, 2126, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2326, 2126, 'waiting_return');
select pg_temp.money_shipment(2227, 2127, 2001, 2002, 'delivered', interval '3 days');
select pg_temp.money_dispute(2327, 2127, 'under_review');
update public.disputes set return_payout_status = 'paid', updated_at = now() - interval '3 days'
where id in (select pg_temp.mu(n) from generate_series(2321, 2327) n);
update public.disputes set updated_at = now() - interval '47 hours' where id = pg_temp.mu(2323);
update public.disputes set return_tracking_number = 'RT123' where id = pg_temp.mu(2324);
update public.disputes set return_payout_status = 'pending' where id = pg_temp.mu(2325);
update public.disputes set shipment_id = null where id = pg_temp.mu(2326);
update public.shipments set updated_at = now() - interval '10 days'
where id in (select pg_temp.mu(n) from generate_series(2121, 2127) n);
insert into pg_temp.sig select n, pg_temp.ship_sig(n) from generate_series(2121, 2127) n;

-- status|resolution_type|admin_notes of a dispute.
create function pg_temp.dispute_state(p_n integer) returns text language sql as $$
  select d.status::text || '|' || coalesce(d.resolution_type, '-') || '|' || coalesce(d.admin_notes, '-')
  from public.disputes d where d.id = pg_temp.mu(p_n)
$$;

set local role service_role;
select lives_ok($$select public.fn_cron_dispute_shipping_timeout()$$, 'cron: the batch runs as service_role');
reset role;
select is(pg_temp.dispute_state(2321),
  'resolved|seller_wins_timeout|' || E'\n[SYSTEM]: Comprador no envió el retorno en 48h. Caso cerrado a favor del vendedor.',
  'cron: the due dispute is resolved for the seller with the system note');
select is((select status::text || ':' || (completed_at = now())::text from public.shipments where id = pg_temp.mu(2121)),
  'completed:true', 'cron: the shipment of the resolved dispute is released');
select is(
  (select string_agg(n.user_id::text || '|' || n.type || '|' || n.title || '|' || n.message || '|' || n.action_path
     || '|' || n.event_kind || '|' || n.source_event_key || '|' || n.event_payload::text, E'\n' order by n.title)
   from public.notifications n where n.source_event_key like 'dispute.verdict:' || pg_temp.mu(2321) || '%'),
  pg_temp.mu(2001) || '|success|Disputa Ganada|El comprador no envió el retorno a tiempo. El caso se cerró a tu favor.|/profile/orders/'
    || pg_temp.mu(2221) || '?shipment_id=' || pg_temp.mu(2121) || '|dispute.verdict|dispute.verdict:' || pg_temp.mu(2321)
    || ':shipping_timeout|' || jsonb_build_object('order_id', pg_temp.mu(2221), 'dispute_id', pg_temp.mu(2321), 'recipient_role', 'seller')::text
    || E'\n' || pg_temp.mu(2002) || '|error|Disputa Perdida|No enviaste el producto a tiempo. El caso ha sido cerrado.|/profile/orders/'
    || pg_temp.mu(2221) || '?shipment_id=' || pg_temp.mu(2121) || '|dispute.verdict|dispute.verdict:' || pg_temp.mu(2321)
    || ':shipping_timeout|' || jsonb_build_object('order_id', pg_temp.mu(2221), 'dispute_id', pg_temp.mu(2321), 'recipient_role', 'buyer')::text,
  'cron: the seller and the buyer each get one verdict notice for the dispute');
select is(pg_temp.dispute_state(2322), 'waiting_return|-|-', 'cron: a refused release rolls the resolution back');
select is(pg_temp.ship_sig(2122), (select v from pg_temp.sig where n = 2122), 'cron: a refused release leaves the shipment unchanged');
select is((select count(*) from public.notifications where source_event_key like 'dispute.verdict:' || pg_temp.mu(2322) || '%'),
  0::bigint, 'cron: a refused release sends no notice');
select is(
  (select count(*) from public.system_logs
   where level = 'WARNING' and message = 'Cron shipping timeout: release failed'
     and metadata = jsonb_build_object('dispute_id', pg_temp.mu(2322), 'shipment_id', pg_temp.mu(2122), 'error', 'GRACE_PERIOD_ACTIVE')),
  1::bigint, 'cron: a refused release is logged as a warning with the refusal');
select is(
  (select string_agg(pg_temp.dispute_state(n), ',' order by n) from unnest(array[2323, 2324, 2325, 2327]) n),
  'waiting_return|-|-,waiting_return|-|-,waiting_return|-|-,under_review|-|-',
  'cron: disputes updated under 48 hours ago, with a return tracking number, an unpaid return label or not waiting for the return are not selected');
select is(
  (select count(*) from pg_temp.sig where n in (2123, 2124, 2125, 2127) and v is distinct from pg_temp.ship_sig(n)),
  0::bigint, 'cron: the shipments of unselected disputes are unchanged');
select is(
  (select count(*) from public.system_logs
   where level = 'ERROR' and message = 'Cron shipping timeout: dispute without shipment_id — requires manual intervention'
     and metadata = jsonb_build_object('dispute_id', pg_temp.mu(2326), 'order_id', pg_temp.mu(2226))),
  1::bigint, 'cron: a due dispute without a shipment is logged for manual intervention');
select is(pg_temp.dispute_state(2326), 'waiting_return|-|-', 'cron: a due dispute without a shipment stays open');

-- A database error in one dispute is logged and does not stop the batch.
create function pg_temp.fail_notice() returns trigger language plpgsql as $$
begin
  raise exception 'TEST_NOTICE_FAILURE';
end $$;
create trigger t2_fail_notice before insert on public.notifications
  for each row when (new.source_event_key = 'dispute.verdict:f0000000-0000-4000-8000-000000002322:shipping_timeout')
  execute function pg_temp.fail_notice();
update public.shipments set delivered_at = now() - interval '3 days' where id = pg_temp.mu(2122);
set local role service_role;
select public.fn_cron_dispute_shipping_timeout();
reset role;
drop trigger t2_fail_notice on public.notifications;
select is(
  (select count(*) from public.system_logs
   where level = 'ERROR' and message = 'Cron shipping timeout: DB exception'
     and metadata = jsonb_build_object('dispute_id', pg_temp.mu(2322), 'error', 'TEST_NOTICE_FAILURE')),
  1::bigint, 'cron: a database error is logged with the dispute');
select is(pg_temp.dispute_state(2322) || ':' || (select status::text from public.shipments where id = pg_temp.mu(2122)),
  'waiting_return|-|-:delivered', 'cron: a database error rolls back the resolution and the release');
select is((select count(*) from public.notifications where source_event_key like 'dispute.verdict:' || pg_temp.mu(2321) || '%'),
  2::bigint, 'cron: a second run sends no new notice for an already resolved dispute');

-- 4. Funds-released notice of fn_complete_shipment_transfer ---------------------------
-- 2131: the normal notice. 2132: a notice with the same key already exists.
-- 2133: the notice insert fails.
select pg_temp.money_shipment(2231, 2131, 2001, 2002, 'completed', interval '3 days', 1234567);
select pg_temp.money_shipment(2232, 2132, 2001, 2002, 'completed', interval '3 days');
select pg_temp.money_shipment(2233, 2133, 2001, 2002, 'completed', interval '3 days');
select pg_temp.money_payout_run(2431, 2001, 2003, array[2131], 'pending_reconciliation', 'release_accepted');
select pg_temp.money_payout_run(2432, 2001, 2003, array[2132], 'pending_reconciliation', 'release_accepted');
select pg_temp.money_payout_run(2433, 2001, 2003, array[2133], 'pending_reconciliation', 'awaiting_connected_balance');
update public.connect_payout_run_shipments set transfer_token = pg_temp.mu(2500), transfer_started_at = now()
where run_id in (pg_temp.mu(2431), pg_temp.mu(2432), pg_temp.mu(2433));
insert into public.notifications (user_id, type, title, message, event_kind, source_event_key, event_payload)
values (pg_temp.mu(2001), 'info', 'Pre-existing notice', 'Pre-existing notice', 'shipment.funds_released',
  'shipment.funds_released:' || pg_temp.mu(2132), '{}'::jsonb);

create function pg_temp.complete(p_run integer, p_shipment integer, p_transfer text) returns boolean language sql as $$
  select public.fn_complete_shipment_transfer(pg_temp.mu(p_run), pg_temp.mu(p_shipment), 1, pg_temp.mu(2500), p_transfer)
$$;

-- The amount the seller sees is the mapping amount in cents, shown in pesos.
select is((select net_payout from public.connect_payout_run_shipments where run_id = pg_temp.mu(2431)),
  1234567, 'notice: fixture, the mapping holds 1234567 cents');
set local role service_role;
select ok(pg_temp.complete(2431, 2131, 'tr_test_2131'), 'notice: the transfer completes');
reset role;
select is((select stripe_transfer_id from public.shipments where id = pg_temp.mu(2131)), 'tr_test_2131',
  'notice: the transfer is recorded on the shipment');
select is(
  (select n.user_id::text || '|' || n.type || '|' || n.title || '|' || n.message || '|' || n.action_path || '|' || n.event_kind
     || '|' || n.event_payload::text
   from public.notifications n where n.source_event_key = 'shipment.funds_released:' || pg_temp.mu(2131)),
  pg_temp.mu(2001) || '|success|Liberamos el pago de tu venta|Enviamos $12,345.67 MXN a tu cuenta de vendedor. '
    || 'El depósito a tu banco puede tardar unos días hábiles.|/profile/orders/' || pg_temp.mu(2231) || '?shipment_id='
    || pg_temp.mu(2131) || '|shipment.funds_released|'
    || jsonb_build_object('order_id', pg_temp.mu(2231), 'shipment_id', pg_temp.mu(2131), 'amount_cents', 1234567,
      'currency', 'mxn', 'recipient_role', 'seller')::text,
  'notice: the seller gets the funds-released notice with its payload, copy and path');
select is((select count(*) from public.push_event_policy
   where event_kind = 'shipment.funds_released' and recipient_role = 'seller' and channel = 'orders'),
  1::bigint, 'notice: the funds-released notice is pushed to the seller on the orders channel');
set local role service_role;
select ok(pg_temp.complete(2431, 2131, 'tr_test_2131'), 'notice: completing the same transfer again succeeds');
reset role;
select is((select count(*) from public.notifications where source_event_key = 'shipment.funds_released:' || pg_temp.mu(2131)),
  1::bigint, 'notice: a repeated completion writes no second notice');

set local role service_role;
select ok(pg_temp.complete(2432, 2132, 'tr_test_2132'), 'notice: the transfer completes when the notice key already exists');
reset role;
select is(
  (select string_agg(title, ',') from public.notifications where source_event_key = 'shipment.funds_released:' || pg_temp.mu(2132)),
  'Pre-existing notice', 'notice: the idempotency key keeps the existing notice and adds none');

create trigger t2_fail_funds_notice before insert on public.notifications
  for each row when (new.source_event_key = 'shipment.funds_released:f0000000-0000-4000-8000-000000002133')
  execute function pg_temp.fail_notice();
set local role service_role;
select ok(pg_temp.complete(2433, 2133, 'tr_test_2133'), 'notice: the transfer completes when the notice fails');
reset role;
drop trigger t2_fail_funds_notice on public.notifications;
select is((select stripe_transfer_id from public.shipments where id = pg_temp.mu(2133)), 'tr_test_2133',
  'notice: a failing notice does not roll back the recorded transfer');
select is(
  (select count(*) from public.system_logs
   where level = 'WARNING' and message = 'Funds released notice failed'
     and metadata = jsonb_build_object('shipment_id', pg_temp.mu(2133), 'sqlstate', 'P0001', 'error', 'TEST_NOTICE_FAILURE')),
  1::bigint, 'notice: a failing notice is logged as a warning');
select is(
  (select count(*) from public.system_logs
   where message = 'Funds released notice failed' and metadata->>'shipment_id' in (pg_temp.mu(2131)::text, pg_temp.mu(2132)::text)),
  0::bigint, 'notice: a written or already existing notice logs no warning');

-- 5. Release amount of admin_connect_payout_release_view ------------------------------
-- All completed Connect shipments of a payout-ready seller, net payout 470000 cents.
-- 2141 single-modal, no shipping cost, with a label cost. 2142 single-modal with a
-- shipping cost. 2143 legacy with a shipping cost. 2144 legacy without one.
-- 2145 legacy with a shipping cost above the net payout.
update public.profiles_private set stripe_account_id = 'acct_test_2001', stripe_onboarding_status = 'complete'
where id = pg_temp.mu(2001);
select pg_temp.money_shipment(2240 + n, 2140 + n, 2001, 2002, 'completed', interval '3 days', 470000)
from generate_series(1, 5) n;
update public.shipments set completed_at = now() - interval '1 day'
where id in (select pg_temp.mu(n) from generate_series(2141, 2145) n);
update public.orders set stripe_transfer_group = 'group_' || id where id in (pg_temp.mu(2241), pg_temp.mu(2242));
update public.shipments set label_provider_cost_cents = 50000 where id = pg_temp.mu(2141);
update public.shipments set shipping_cost = 28700 where id in (pg_temp.mu(2142), pg_temp.mu(2143));
update public.shipments set shipping_cost = 500000 where id = pg_temp.mu(2145);

create function pg_temp.view_row(p_n integer) returns text language sql as $$
  select v.release_amount_cents::text || ':' || v.is_eligible::text || ':' || coalesce(v.ineligible_reason, '-')
  from public.admin_connect_payout_release_view v where v.shipment_id = pg_temp.mu(p_n)
$$;

select is(pg_temp.view_row(2141), '470000:true:-',
  'view: a single-modal shipment releases its net payout, ignoring the label cost and the publication shipping reserve');
select is(pg_temp.view_row(2142), '470000:true:-', 'view: a single-modal shipment does not deduct a shipping cost again');
select is(pg_temp.view_row(2143), '441300:true:-', 'view: a legacy shipment deducts its shipping cost');
select is(pg_temp.view_row(2144), '470000:false:missing_shipping_cost', 'view: a legacy shipment without a shipping cost is not eligible');
select is(pg_temp.view_row(2145), '0:false:missing_release_amount', 'view: a legacy release amount never goes below zero and is not eligible');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'admin_connect_payout_release_view'),
  array['shipment_id', 'seller_id', 'seller_name', 'order_id', 'status', 'completed_at', 'stripe_payment_intent_id',
    'stripe_account_id', 'stripe_onboarding_status', 'release_amount_cents', 'is_eligible', 'ineligible_reason',
    'transfer_group', 'stripe_transfer_id', 'payout_run_id', 'payout_run_status', 'payout_run_amount_cents',
    'payout_run_failure_reason', 'payout_run_failed_at', 'retry_of_run_id', 'is_retryable', 'requires_manual_review',
    'payout_run_paid_at', 'seller_payout_block_reason', 'days_since_completed'],
  'view: the 25 columns keep their order, with the payout run and seller block columns appended at the tail');

select * from finish();
rollback;
