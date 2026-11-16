-- Foreign key actions and targets (odd/tasks/integrity-constraints.md S6):
-- money and shipment history is ON DELETE RESTRICT, user-owned preferences
-- CASCADE, and user references point to public.profiles, not auth.users.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(5);
\ir ../fixtures/money.psql

-- Every single-column foreign key in public and internal, with its target and
-- delete action.
create temporary view fk_actions as
select n.nspname || '.' || t.relname as tbl, a.attname::text as col,
       rn.nspname || '.' || r.relname as target, c.confdeltype::text as action
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
join pg_class r on r.oid = c.confrelid
join pg_namespace rn on rn.oid = r.relnamespace
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f' and n.nspname in ('public', 'internal');

-- (a) Only the profile rows themselves reference auth.users. payment_methods
-- and system_logs are owned by #309 (odd/tasks/integrity-constraints.md S12).
select is_empty(
  $$select tbl || '.' || col from fk_actions
    where target = 'auth.users'
      and (tbl, col) not in (('public.profiles', 'id'), ('public.profiles_private', 'id'),
                             ('public.payment_methods', 'user_id'), ('public.system_logs', 'user_id'))
    order by 1$$,
  'no foreign key outside profiles and profiles_private references auth.users');

-- (b) Money and shipment history cannot be deleted from under its rows.
select is_empty(
  $$select e.tbl || '.' || e.col || coalesce(' is ' || f.action || ' -> ' || f.target, ' is missing')
    from (values
      ('public.order_items', 'order_id', 'public.orders'),
      ('public.order_items', 'product_id', 'public.products'),
      ('public.order_items', 'seller_id', 'public.profiles'),
      ('public.order_items', 'shipment_id', 'public.shipments'),
      ('public.orders', 'buyer_id', 'public.profiles'),
      ('public.shipments', 'order_id', 'public.orders'),
      ('public.shipments', 'seller_id', 'public.profiles'),
      ('public.shipments', 'origin_address_id', 'public.addresses'),
      ('public.connect_payout_runs', 'seller_id', 'public.profiles'),
      ('public.connect_payout_runs', 'actor_id', 'public.profiles'),
      ('public.connect_payout_runs', 'retry_of_run_id', 'public.connect_payout_runs'),
      ('public.connect_payout_run_shipments', 'run_id', 'public.connect_payout_runs'),
      ('public.connect_payout_run_shipments', 'shipment_id', 'public.shipments'),
      ('internal.connect_payout_events', 'connect_payout_run_id', 'public.connect_payout_runs'),
      ('internal.stripe_fee_reconciliation_jobs', 'order_id', 'public.orders'),
      ('internal.account_closures', 'user_id', 'public.profiles'),
      ('public.reviews', 'order_id', 'public.orders'),
      ('public.reviews', 'shipment_id', 'public.shipments'),
      ('public.products', 'locked_by', 'public.profiles'),
      ('public.admin_audit_logs', 'admin_id', 'public.profiles'),
      ('public.admin_user_notes', 'admin_id', 'public.profiles'),
      ('public.shipment_cancellation_operations', 'order_id', 'public.orders'),
      ('public.shipment_cancellation_operations', 'shipment_id', 'public.shipments'),
      ('public.shipment_completion_events', 'order_id', 'public.orders'),
      ('public.shipment_completion_events', 'shipment_id', 'public.shipments'),
      ('public.shipment_completion_events', 'actor_id', 'public.profiles'),
      ('public.shipment_payout_hold_notes', 'shipment_id', 'public.shipments'),
      ('public.shipment_payout_hold_notes', 'admin_id', 'public.profiles')
    ) as e(tbl, col, target)
    left join fk_actions f on f.tbl = e.tbl and f.col = e.col
    where f.action is distinct from 'r' or f.target is distinct from e.target
    order by 1$$,
  'money and shipment history foreign keys are ON DELETE RESTRICT');

-- User-owned preferences follow their profile.
select is_empty(
  $$select e.tbl || '.' || e.col || coalesce(' is ' || f.action || ' -> ' || f.target, ' is missing')
    from (values
      ('public.addresses', 'user_id'),
      ('public.notifications', 'user_id'),
      ('public.push_tokens', 'user_id'),
      ('public.push_deliveries', 'user_id'),
      ('public.favorites', 'user_id'),
      ('public.reviews', 'reviewer_id'),
      ('public.reviews', 'seller_id'),
      ('public.admin_user_notes', 'user_id')
    ) as e(tbl, col)
    left join fk_actions f on f.tbl = e.tbl and f.col = e.col
    where f.action is distinct from 'c' or f.target is distinct from 'public.profiles'
    order by 1$$,
  'user-owned rows reference profiles ON DELETE CASCADE');

-- (c) Behavior. Order 308502 holds the order item of shipment 308511 (moved
-- from order 308501), so only order_items references it.
select pg_temp.money_user(308500);
select pg_temp.money_user(308503);
select pg_temp.money_shipment(308501, 308511, 308500, 308503);
insert into public.orders (id, buyer_id, total_amount_cents, shipping_address, status)
values (pg_temp.mu(308502), pg_temp.mu(308503), 100000, '{}'::jsonb, 'paid');
update public.order_items set order_id = pg_temp.mu(308502) where shipment_id = pg_temp.mu(308511);
select throws_ok(
  format('delete from public.orders where id = %L', pg_temp.mu(308502)),
  '23503', null, 'an order with order items cannot be deleted');

select pg_temp.money_user(308504);
insert into public.addresses (user_id, full_name, phone, street_line1, city, state, zip_code, label)
values (pg_temp.mu(308504), 'Test', '5555555555', 'Calle 1', 'CDMX', 'CDMX', '06600', 'home');
delete from public.profiles where id = pg_temp.mu(308504);
select is(
  (select count(*)::integer from public.addresses where user_id = pg_temp.mu(308504)),
  0, 'deleting a profile deletes its addresses');

select * from finish();
rollback;
