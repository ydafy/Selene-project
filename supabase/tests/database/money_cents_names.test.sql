-- Money columns that hold integer cents say so in their name and are bigint
-- (odd/tasks/integrity-constraints.md S8, T7a-T7c). Each renamed column keeps
-- its NOT NULL, default and `>= 0` check, and the old name is gone.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(29);
\ir ../fixtures/money.psql

-- Seller 7701, buyer 7702, admin 7703; order 7710 with shipment and listing 7711.
select pg_temp.money_user(7701);
select pg_temp.money_user(7702);
select pg_temp.money_user(7703);
select pg_temp.money_shipment(7710, 7711, 7701, 7702);

-- T7a: shipments.shipping_cost_cents ---------------------------------------------
select hasnt_column('public', 'shipments', 'shipping_cost',
  'shipments has no shipping_cost column');
select col_type_is('public', 'shipments', 'shipping_cost_cents', 'bigint',
  'shipments.shipping_cost_cents is bigint');
select col_not_null('public', 'shipments', 'shipping_cost_cents',
  'shipments.shipping_cost_cents is NOT NULL');
select col_default_is('public', 'shipments', 'shipping_cost_cents', '0',
  'shipments.shipping_cost_cents defaults to 0');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.shipments'::regclass
      and conname = 'shipments_shipping_cost_cents_check'),
  'CHECK ((shipping_cost_cents >= 0))',
  'shipments_shipping_cost_cents_check requires shipping_cost_cents >= 0');

update public.shipments set shipping_cost_cents = 28700 where id = pg_temp.mu(7711);
select throws_ok(
  $$update public.shipments set shipping_cost_cents = -1 where id = pg_temp.mu(7711)$$,
  '23514', null, 'a negative shipments.shipping_cost_cents is rejected');
select is(
  (select shipping_cost_cents from public.shipments where id = pg_temp.mu(7711)),
  28700::bigint, 'the rejected write leaves shipping_cost_cents unchanged');
select throws_ok(
  $$update public.shipments set shipping_cost_cents = null where id = pg_temp.mu(7711)$$,
  '23502', null, 'a NULL shipments.shipping_cost_cents is rejected');

-- The release view keeps its integer contract and still subtracts the shipping
-- cost of a legacy shipment (no transfer group): 90000 - 28700.
select col_type_is('public', 'admin_connect_payout_release_view', 'release_amount_cents',
  'integer', 'admin_connect_payout_release_view.release_amount_cents stays integer');
update public.orders set stripe_transfer_group = null where id = pg_temp.mu(7710);
select is(
  (select release_amount_cents from public.admin_connect_payout_release_view
    where shipment_id = pg_temp.mu(7711)),
  61300, 'a legacy shipment releases its net payout minus shipping_cost_cents');

-- T7b: connect_payout_run_shipments.net_payout_cents ------------------------------
select hasnt_column('public', 'connect_payout_run_shipments', 'net_payout',
  'connect_payout_run_shipments has no net_payout column');
select col_type_is('public', 'connect_payout_run_shipments', 'net_payout_cents', 'bigint',
  'connect_payout_run_shipments.net_payout_cents is bigint');
select col_not_null('public', 'connect_payout_run_shipments', 'net_payout_cents',
  'connect_payout_run_shipments.net_payout_cents is NOT NULL');
select col_hasnt_default('public', 'connect_payout_run_shipments', 'net_payout_cents',
  'connect_payout_run_shipments.net_payout_cents has no default');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.connect_payout_run_shipments'::regclass
      and conname = 'connect_payout_run_shipments_net_payout_cents_check'),
  'CHECK ((net_payout_cents >= 0))',
  'connect_payout_run_shipments_net_payout_cents_check requires net_payout_cents >= 0');

-- Run 7720 maps shipment 7711 with its order_items net payout, 90000.
select pg_temp.money_payout_run(7720, 7701, 7703, array[7711]);
select throws_ok(
  $$update public.connect_payout_run_shipments set net_payout_cents = -1
      where run_id = pg_temp.mu(7720)$$,
  '23514', null, 'a negative connect_payout_run_shipments.net_payout_cents is rejected');
select throws_ok(
  $$update public.connect_payout_run_shipments set net_payout_cents = null
      where run_id = pg_temp.mu(7720)$$,
  '23502', null, 'a NULL connect_payout_run_shipments.net_payout_cents is rejected');
select is(
  (select net_payout_cents from public.connect_payout_run_shipments
    where run_id = pg_temp.mu(7720)),
  90000::bigint, 'the rejected writes leave net_payout_cents unchanged');

-- T7c: connect_payout_runs.amount_cents -------------------------------------------
select hasnt_column('public', 'connect_payout_runs', 'amount',
  'connect_payout_runs has no amount column');
select col_type_is('public', 'connect_payout_runs', 'amount_cents', 'bigint',
  'connect_payout_runs.amount_cents is bigint');
select col_not_null('public', 'connect_payout_runs', 'amount_cents',
  'connect_payout_runs.amount_cents is NOT NULL');
select col_hasnt_default('public', 'connect_payout_runs', 'amount_cents',
  'connect_payout_runs.amount_cents has no default');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.connect_payout_runs'::regclass
      and conname = 'connect_payout_runs_amount_cents_check'),
  'CHECK ((amount_cents >= 0))',
  'connect_payout_runs_amount_cents_check requires amount_cents >= 0');

-- Run 7720 holds the sum of its mapped net payouts, 90000.
select throws_ok(
  $$update public.connect_payout_runs set amount_cents = -1 where id = pg_temp.mu(7720)$$,
  '23514', null, 'a negative connect_payout_runs.amount_cents is rejected');
select throws_ok(
  $$update public.connect_payout_runs set amount_cents = null where id = pg_temp.mu(7720)$$,
  '23502', null, 'a NULL connect_payout_runs.amount_cents is rejected');
select is(
  (select amount_cents from public.connect_payout_runs where id = pg_temp.mu(7720)),
  90000::bigint, 'the rejected writes leave amount_cents unchanged');

-- The outputs that read amount_cents keep their integer contract.
select col_type_is('public', 'admin_connect_payout_release_view', 'payout_run_amount_cents', 'integer',
  'the release view keeps payout_run_amount_cents integer');
select ok(pg_get_function_result('public.fn_claim_awaiting_balance_payout_run(integer)'::regprocedure) ~ 'amount_cents integer',
  'fn_claim_awaiting_balance_payout_run keeps returning amount_cents integer');
select ok(pg_get_function_result('public.fn_claim_payout_create_reconciliation(integer)'::regprocedure) ~ 'amount_cents integer',
  'fn_claim_payout_create_reconciliation keeps returning amount_cents integer');

select * from finish();
rollback;
