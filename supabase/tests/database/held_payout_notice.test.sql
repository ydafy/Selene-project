-- internal.fn_notify_held_payouts and the held-payout-seller-notices cron job
-- (#549, odd/tasks/held-payout-seller-notice.md T2, S2-S4). A seller whose
-- completed, untransferred, unpaid shipment cannot be paid because of their
-- account gets one shipment.payout_blocked notice per due stage (0, 3, 7 and
-- 14 days after completed_at) while the block lasts. Only reasons the seller
-- can fix are notified; Selene's own settings, open refreshes and an
-- undetermined destination stay in the admin queue.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(43);
\ir ../fixtures/money.psql

-- A completed shipment: completed p_ago ago with 1000 cents of label.
create function pg_temp.complete(p_shipment integer, p_ago interval default '1 hour')
returns void language sql as $$
  update public.shipments set status = 'completed', completed_at = now() - p_ago, shipping_cost = 1000
  where id = pg_temp.mu(p_shipment)
$$;
create function pg_temp.connect_seller(p_seller integer, p_status public.stripe_onboarding_status default 'complete')
returns void language sql as $$
  update public.profiles_private set stripe_account_id = 'acct_test_' || p_seller, stripe_onboarding_status = p_status
  where id = pg_temp.mu(p_seller)
$$;
create function pg_temp.gate_row(p_seller integer, p_actionable boolean, p_reason text, p_refresh_pending boolean default false)
returns void language sql as $$
  insert into internal.connect_account_actionability (stripe_account_id, is_actionable, blocked_reason, stripe_created, refresh_pending)
  values ('acct_test_' || p_seller, p_actionable, p_reason, now(), p_refresh_pending)
$$;
-- The payout_blocked notices of shipment mu(p_shipment), oldest stage first.
create function pg_temp.keys(p_shipment integer) returns text language sql as $$
  select coalesce(string_agg(source_event_key, ',' order by (event_payload ->> 'reminder_stage')::integer), '-')
  from public.notifications
  where event_kind = 'shipment.payout_blocked'
    and event_payload ->> 'shipment_id' = pg_temp.mu(p_shipment)::text
$$;
create function pg_temp.key(p_shipment integer, p_stage integer) returns text language sql as $$
  select 'shipment.payout_blocked:' || pg_temp.mu(p_shipment) || ':' || p_stage
$$;
create function pg_temp.notice(p_shipment integer, p_stage integer) returns public.notifications language sql as $$
  select * from public.notifications where source_event_key = pg_temp.key(p_shipment, p_stage)
$$;

-- Whatever the seed data already owes is sent first, so every count below
-- belongs to this file's shipments.
select internal.fn_notify_held_payouts();

-- Admin 10, buyer 9. Seller n owns shipment 100 + n of order 200 + n.
-- 11 rejected, 12 pending onboarding; 13-16 finished onboarding but Stripe
-- blocks them; 17-20 and 25 are blocked for reasons the seller is not told
-- about, or not blocked at all; 21-24 are blocked but the shipment is not
-- payable (dispute, transferred, paid run, not completed).
select pg_temp.money_user(10, 'admin');
select pg_temp.money_user(9);
select pg_temp.money_user(n) from generate_series(11, 25) as n;
select pg_temp.connect_seller(11, 'rejected');
select pg_temp.connect_seller(12, 'pending');
select pg_temp.connect_seller(n) from generate_series(13, 20) as n;
select pg_temp.connect_seller(n, 'rejected') from generate_series(21, 24) as n;
select pg_temp.connect_seller(25);
select pg_temp.gate_row(13, false, 'payouts_disabled');
select pg_temp.gate_row(14, false, 'errored');
select pg_temp.gate_row(15, false, 'verification_failed');
select pg_temp.gate_row(16, false, 'tokenized_account_number_deactivated');
select pg_temp.gate_row(17, false, 'payouts_schedule_not_manual');
select pg_temp.gate_row(18, true, null, true);
select pg_temp.gate_row(19, false, 'destination_undetermined');
select pg_temp.gate_row(20, true, null);
select pg_temp.gate_row(25, false, null);
select pg_temp.money_shipment(200 + n, 100 + n, n, 9) from generate_series(11, 25) as n;
update public.order_items set net_payout_cents = 1234567 where shipment_id = pg_temp.mu(111);
select pg_temp.complete(100 + n) from generate_series(11, 23) as n;
select pg_temp.complete(125);
select pg_temp.complete(112, '10 days 1 hour');
-- 124 stays delivered.
select pg_temp.money_dispute(801, 121);
update public.shipments set stripe_transfer_id = 'tr_test_122' where id = pg_temp.mu(122);
select pg_temp.money_payout_run(901, 23, 10, array[123], 'paid');
-- Seller 11 has a device, so the notice is also pushed.
insert into public.push_tokens (id, user_id, token, platform)
values (pg_temp.mu(711), pg_temp.mu(11), 'ExponentPushToken[held-711]', 'ios');

-- 1. First run ------------------------------------------------------------
select is(internal.fn_notify_held_payouts(), 6,
  'the first run sends one notice to each seller who can fix the block (111, 112, 113-116)');

select is(pg_temp.keys(111), pg_temp.key(111, 0), 'a shipment blocked on day 0 gets the stage 0 notice');
select is((pg_temp.notice(111, 0)).user_id, pg_temp.mu(11), 'the notice goes to the seller');
select is((pg_temp.notice(111, 0)).type, 'warning', 'the notice is a warning');
select is((pg_temp.notice(111, 0)).title, 'No podemos enviarte el pago de una venta', 'the first notice title');
select is((pg_temp.notice(111, 0)).message,
  'Stripe rechazó tu cuenta de cobro. Revisa tu configuración de pagos para recibir $12,335.67 MXN.',
  'the first notice says why in plain Spanish and the amount held');
select is((pg_temp.notice(111, 0)).action_path, '/sell/onboarding', 'the notice opens the onboarding screen');
select is((pg_temp.notice(111, 0)).event_payload,
  jsonb_build_object('order_id', pg_temp.mu(211), 'shipment_id', pg_temp.mu(111), 'amount_cents', 1233567,
    'currency', 'mxn', 'recipient_role', 'seller', 'block_reason', 'onboarding_rejected',
    'reminder_stage', 0, 'is_reminder', false),
  'the payload carries the order, shipment, amount, reason and stage');
select is(
  (select count(*)::integer from public.push_deliveries d
   where d.notification_id = (pg_temp.notice(111, 0)).id and d.channel = 'orders'),
  1, 'the notice is pushed to the seller''s device on the orders channel');

select is(pg_temp.keys(112), pg_temp.key(112, 7),
  'a shipment first found blocked on day 10 gets only the stage 7 notice');
select is((pg_temp.notice(112, 7)).title, 'No podemos enviarte el pago de una venta',
  'a late first notice still uses the first title');
select is((pg_temp.notice(112, 7)).event_payload ->> 'is_reminder', 'false',
  'a late first notice is not a reminder');
select is((pg_temp.notice(112, 7)).message,
  'Stripe necesita más datos de tu cuenta de cobro. Revisa tu configuración de pagos para recibir $890.00 MXN.',
  'pending onboarding has its own sentence');
select is((pg_temp.notice(113, 0)).message,
  'Stripe pausó los pagos a tu cuenta. Revisa tu configuración de pagos para recibir $890.00 MXN.',
  'disabled payouts have their own sentence');
select is((pg_temp.notice(114, 0)).message,
  'Tu cuenta bancaria tiene un problema. Revisa tu configuración de pagos para recibir $890.00 MXN.',
  'an errored bank account is a bank problem');
select is((pg_temp.notice(115, 0)).message,
  'Tu cuenta bancaria tiene un problema. Revisa tu configuración de pagos para recibir $890.00 MXN.',
  'a bank account that failed verification is a bank problem');
select is((pg_temp.notice(116, 0)).message,
  'Tu cuenta bancaria tiene un problema. Revisa tu configuración de pagos para recibir $890.00 MXN.',
  'a deactivated tokenized bank account is a bank problem');
select is((pg_temp.notice(116, 0)).event_payload ->> 'block_reason', 'tokenized_account_number_deactivated',
  'the payload keeps the gate''s reason code');

select is(pg_temp.keys(117), '-', 'a payout schedule that is not manual is Selene''s to fix: no notice');
select is(pg_temp.keys(118), '-', 'an open account refresh: no notice');
select is(pg_temp.keys(119), '-', 'an undetermined destination: no notice');
select is(pg_temp.keys(120), '-', 'a payout-ready seller: no notice');
select is(pg_temp.keys(125), '-', 'a non-actionable account with no reason code: no notice');
select is(pg_temp.keys(121), '-', 'a shipment with an active dispute: no notice');
select is(pg_temp.keys(122), '-', 'a transferred shipment: no notice');
select is(pg_temp.keys(123), '-', 'a shipment with a paid run: no notice');
select is(pg_temp.keys(124), '-', 'a shipment that is not completed: no notice');

-- 2. Same day, second run ------------------------------------------------
select is(internal.fn_notify_held_payouts(), 0, 'a second run on the same day sends nothing');

-- 3. Reminders -----------------------------------------------------------
select pg_temp.complete(111, '3 days 1 hour');
select is(internal.fn_notify_held_payouts(), 1, 'on day 3 the shipment gets its reminder');
select is(pg_temp.keys(111), pg_temp.key(111, 0) || ',' || pg_temp.key(111, 3),
  'the day 3 reminder is added next to the first notice');
select is((pg_temp.notice(111, 3)).title, 'Tu pago sigue retenido', 'the reminder title');
select is(((pg_temp.notice(111, 3)).event_payload ->> 'reminder_stage')::integer, 3, 'the reminder is stage 3');
select is((pg_temp.notice(111, 3)).event_payload ->> 'is_reminder', 'true', 'the reminder is marked as one');

select pg_temp.complete(112, '15 days');
select is(internal.fn_notify_held_payouts(), 1, 'on day 15 the late shipment gets its stage 14 reminder');
select is(pg_temp.keys(112), pg_temp.key(112, 7) || ',' || pg_temp.key(112, 14), 'stage 14 follows stage 7');
select is((pg_temp.notice(112, 14)).event_payload ->> 'is_reminder', 'true', 'stage 14 is a reminder');

select pg_temp.complete(112, '20 days');
select is(internal.fn_notify_held_payouts(), 0, 'nothing is sent after the stage 14 reminder');

-- 4. Unblocked -----------------------------------------------------------
update internal.connect_account_actionability set is_actionable = true, blocked_reason = null
where stripe_account_id = 'acct_test_13';
select pg_temp.complete(113, '4 days');
select is(internal.fn_notify_held_payouts(), 0, 'a seller whose account was unblocked gets no reminder');

-- 5. A failing insert is logged and the run goes on ----------------------
select pg_temp.money_user(n) from generate_series(26, 27) as n;
select pg_temp.connect_seller(n, 'rejected') from generate_series(26, 27) as n;
select pg_temp.money_shipment(200 + n, 100 + n, n, 9) from generate_series(26, 27) as n;
select pg_temp.complete(100 + n) from generate_series(26, 27) as n;
do $$
begin
  execute format(
    'alter table public.notifications add constraint held_payout_test_reject check (user_id <> %L) not valid',
    pg_temp.mu(26));
end
$$;
select is(internal.fn_notify_held_payouts(), 1,
  'a shipment whose notice fails is skipped and the next one is still notified');
select ok(
  exists (select 1 from public.system_logs
          where level = 'WARNING' and message = 'Held payout notice failed'
            and metadata ->> 'shipment_id' = pg_temp.mu(126)::text
            and metadata ->> 'sqlstate' = '23514'),
  'the failed notice is logged as a warning with the shipment and SQLSTATE');

-- 6. Push policy, grants and the cron job --------------------------------
select is(
  (select channel from public.push_event_policy
   where event_kind = 'shipment.payout_blocked' and recipient_role = 'seller'),
  'orders', 'shipment.payout_blocked is pushed to the seller on the orders channel');
select is_empty(
  $$select r.role_name from (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
    where has_function_privilege(r.role_name, 'internal.fn_notify_held_payouts()', 'EXECUTE')$$,
  'no client role, service_role included, can execute internal.fn_notify_held_payouts()');
select is(
  (select schedule || ' | ' || command || ' | ' || username || ' | ' || active::text
   from cron.job where jobname = 'held-payout-seller-notices'),
  '20 * * * * | select internal.fn_notify_held_payouts() | postgres | true',
  'the held-payout-seller-notices job runs the producer hourly as postgres');

select * from finish();
rollback;
