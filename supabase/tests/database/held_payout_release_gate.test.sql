-- The seller block reason in admin_connect_payout_release_view is display only
-- (#549, odd/tasks/held-payout-seller-notice.md S4): fn_begin_shipment_transfer,
-- which reads the view, still refuses a blocked account and accepts it once the
-- account is actionable again.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(3);
\ir ../fixtures/money.psql

-- Admin 10, buyer 9, seller 11 with finished onboarding but payouts disabled.
select pg_temp.money_user(10, 'admin');
select pg_temp.money_user(9);
select pg_temp.money_user(11);
update public.profiles_private set stripe_account_id = 'acct_test_11', stripe_onboarding_status = 'complete'
where id = pg_temp.mu(11);
insert into internal.connect_account_actionability (stripe_account_id, is_actionable, blocked_reason, stripe_created)
values ('acct_test_11', false, 'payouts_disabled', now());
select pg_temp.money_shipment(211, 111, 11, 9);
update public.orders set stripe_charge_id = 'ch_test_211', stripe_transfer_group = 'tg_test_211'
where id = pg_temp.mu(211);
update public.shipments set status = 'completed', completed_at = now() - interval '8 days', shipping_cost = 1000
where id = pg_temp.mu(111);
select pg_temp.money_payout_run(901, 11, 10, array[111], 'pending_reconciliation', 'release_accepted');
update public.connect_payout_run_shipments m set net_payout = v.release_amount_cents
from public.admin_connect_payout_release_view v
where v.shipment_id = m.shipment_id and m.run_id = pg_temp.mu(901);
update public.connect_payout_runs r
set amount = (select sum(net_payout) from public.connect_payout_run_shipments where run_id = r.id)
where id = pg_temp.mu(901);

select is(
  (select seller_payout_block_reason from public.admin_connect_payout_release_view where shipment_id = pg_temp.mu(111)),
  'payouts_disabled', 'the queue shows the block reason');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select throws_ok(
  format('select public.fn_begin_shipment_transfer(%L, %L, %s)', pg_temp.mu(901), pg_temp.mu(111),
    (select release_stage_version from public.connect_payout_runs where id = pg_temp.mu(901))),
  'P0001', 'CONNECT_ACCOUNT_NOT_ACTIONABLE', 'a blocked account still cannot start a transfer');

update internal.connect_account_actionability set is_actionable = true, blocked_reason = null
where stripe_account_id = 'acct_test_11';
select lives_ok(
  format('select public.fn_begin_shipment_transfer(%L, %L, %s)', pg_temp.mu(901), pg_temp.mu(111),
    (select release_stage_version from public.connect_payout_runs where id = pg_temp.mu(901))),
  'an actionable account starts the transfer');

select * from finish();
rollback;
