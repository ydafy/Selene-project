-- Functions that only pg_cron or other SQL calls live in internal, not in the
-- exposed public schema (odd/tasks/internal-schema.md S5, T2). Each one exists
-- in internal only, and anon and authenticated cannot execute it. The callers
-- still reach them: the shipments status trigger runs as the role that updates
-- the shipment (service_role), the review trigger and the cron job as postgres.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(7);
\ir ../fixtures/money.psql

create temporary table moved (name text, args text) on commit drop;
insert into moved values
  ('fn_reconcile_connect_payments', ''),
  ('fn_derive_order_status', 'uuid'),
  ('fn_generate_profile_username', 'text'),
  ('fn_refresh_seller_stats', 'uuid'),
  ('fn_shipment_label_is_stuck', 'order_status_enum, text, timestamp with time zone');

select set_eq(
  $$select p.proname::text, oidvectortypes(p.proargtypes)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname in (select name from moved)$$,
  $$select name, args from moved$$,
  'each moved function exists in internal with its arguments');

select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (select name from moved)$$,
  'no moved function is left in public');

select is_empty(
  $$select r.role_name, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) as r(role_name)
    where n.nspname = 'internal' and p.proname in (select name from moved)
      and has_function_privilege(r.role_name, p.oid, 'EXECUTE')$$,
  'anon and authenticated cannot execute a moved function');

select is(
  (select command from cron.job where jobname = 'reconcile-connect-payments'),
  'select * from internal.fn_reconcile_connect_payments()',
  'the reconcile-connect-payments job calls internal.fn_reconcile_connect_payments()');

select lives_ok(
  'select * from internal.fn_reconcile_connect_payments()',
  'the cron job command runs as postgres');

select pg_temp.money_user(1);
select pg_temp.money_user(2);
select pg_temp.money_shipment(10, 20, 1, 2, 'paid');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
update public.shipments set status = 'preparing' where id = pg_temp.mu(20);
reset role;

select is(
  (select status from public.orders where id = pg_temp.mu(10)),
  'preparing'::public.order_status_enum,
  'a service_role shipment update derives the order status through internal.fn_derive_order_status');

insert into public.reviews (reviewer_id, seller_id, product_id, rating, order_id, shipment_id)
values (pg_temp.mu(2), pg_temp.mu(1), pg_temp.mu(20), 4, pg_temp.mu(10), pg_temp.mu(20));

select is(
  (select total_reviews from public.profiles where id = pg_temp.mu(1)),
  1,
  'a new review refreshes the seller stats through internal.fn_refresh_seller_stats');

select * from finish();
rollback;
