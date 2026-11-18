-- internal.ops_failures (odd/tasks/table-cleanup.md T6a, S6a and S6c): the
-- server-only record of a failure that a cron or trigger catches and continues
-- past, so one bad row does not stop the rest. It holds a source, a short code
-- and an ids-only context; no client role reaches it, and service_role may only
-- read and delete it (cron-watchdog drains it, S6b). Each cron below records a
-- forced failure there and still processes the other rows; the writers that
-- only repeated a fact stored elsewhere no longer write system_logs.
-- fn_cron_dispute_shipping_timeout and fn_complete_shipment_transfer are pinned
-- in shipment_funds_release.test.sql, fn_notify_held_payouts in
-- held_payout_notice.test.sql, fn_record_dispute_refund in refunds.test.sql and
-- shipment_cancellation_refund_problems.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(29);
\ir ../fixtures/money.psql

-- 1. The table ------------------------------------------------------------------
select has_table('internal', 'ops_failures', 'internal.ops_failures exists');
select hasnt_table('public', 'ops_failures', 'there is no public.ops_failures');
select results_eq(
  $$select column_name::text collate "default", data_type::text collate "default",
      is_nullable::text collate "default", is_identity::text collate "default",
      coalesce(column_default::text, '-') collate "default"
    from information_schema.columns
    where table_schema = 'internal' and table_name = 'ops_failures' order by ordinal_position$$,
  $$values ('id', 'bigint', 'NO', 'YES', '-'),
           ('source', 'text', 'NO', 'NO', '-'),
           ('code', 'text', 'NO', 'NO', '-'),
           ('context', 'jsonb', 'NO', 'NO', '''{}''::jsonb'),
           ('occurred_at', 'timestamp with time zone', 'NO', 'NO', 'now()')$$,
  'ops_failures has id identity, source, code, context default {} and occurred_at default now(), all NOT NULL');
select col_is_pk('internal', 'ops_failures', 'id', 'ops_failures is keyed by id');
select ok((select relrowsecurity from pg_class where oid = 'internal.ops_failures'::regclass),
  'ops_failures has RLS enabled');
select is_empty($$select 1 from pg_policies where schemaname = 'internal' and tablename = 'ops_failures'$$,
  'ops_failures has no policy');
select results_eq(
  $$select (case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) collate "default",
      a.privilege_type::text collate "default"
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'internal.ops_failures'::regclass and a.grantee <> c.relowner
    order by 1, 2$$,
  $$values ('service_role', 'DELETE'), ('service_role', 'SELECT')$$,
  'only service_role holds a privilege on ops_failures besides the owner: SELECT and DELETE');

set local role anon;
select throws_ok('select 1 from internal.ops_failures', '42501', null, 'anon cannot read ops_failures');
reset role;
set local role authenticated;
select throws_ok('select 1 from internal.ops_failures', '42501', null, 'authenticated cannot read ops_failures');
reset role;
set local role service_role;
select lives_ok('select 1 from internal.ops_failures limit 1', 'service_role can read ops_failures');
select throws_ok($$insert into internal.ops_failures (source, code) values ('x', 'y')$$, '42501', null,
  'service_role cannot insert into ops_failures');
reset role;

select throws_ok($$insert into internal.ops_failures (source, code) values ('', 'X')$$, '23514', null,
  'an empty source is refused');
select throws_ok($$insert into internal.ops_failures (source, code) values ('fn_x', ' ')$$, '23514', null,
  'a blank code is refused');
select throws_ok($$insert into internal.ops_failures (source, code, context) values ('fn_x', 'X', '[1]')$$, '23514', null,
  'a context that is not a JSON object is refused');

-- Rows a source wrote about object n (by context key p_key): code|context, oldest first.
create function pg_temp.failures(p_source text, p_key text, p_n integer) returns text language sql as $$
  select coalesce(string_agg(f.code || '|' || f.context::text || '|' || (f.occurred_at = now())::text, ' / ' order by f.id), '-')
  from internal.ops_failures f where f.source = p_source and f.context ->> p_key = pg_temp.mu(p_n)::text
$$;

create function pg_temp.fail() returns trigger language plpgsql as $$
begin
  raise exception 'TEST_OPS_FAILURE';
end $$;

-- Users: 16001 seller, 16002 buyer.
select pg_temp.money_user(16001);
select pg_temp.money_user(16002);

-- 2. fn_cron_return_delivery_timeout ------------------------------------------------
-- 1: no Stripe payment intent. 2: Connect, its update fails. 3: Connect, processed.
select pg_temp.money_shipment(16201, 16101, 16001, 16002, 'delivered', null, 90000, null);
select pg_temp.money_shipment(16200 + n, 16100 + n, 16001, 16002, 'delivered') from unnest(array[2, 3]) n;
select pg_temp.money_dispute(16300 + n, 16100 + n, 'return_delivered') from generate_series(1, 3) n;
update public.disputes set return_delivered_at = now() - interval '3 days'
where id in (select pg_temp.mu(16300 + n) from generate_series(1, 3) n);
create table pg_temp.return_baseline as
select count(*) filter (where s.stripe_payment_intent_id is null) as errors,
       count(*) filter (where s.stripe_payment_intent_id is not null) as processed
from public.disputes d left join public.shipments s on s.id = d.shipment_id
where d.status = 'return_delivered' and d.return_delivered_at < now() - interval '48 hours'
  and d.id not in (select pg_temp.mu(16300 + n) from generate_series(1, 3) n);
create trigger ops_fail_return before update on public.disputes
  for each row when (new.id = 'f0000000-0000-4000-8000-000000016302'::uuid) execute function pg_temp.fail();

set local role service_role;
create temp table return_cron on commit drop as select * from public.fn_cron_return_delivery_timeout();
reset role;
drop trigger ops_fail_return on public.disputes;

select is(pg_temp.failures('fn_cron_return_delivery_timeout', 'dispute_id', 16301),
  'SHIPMENT_NOT_CONNECT|' || jsonb_build_object('dispute_id', pg_temp.mu(16301), 'shipment_id', pg_temp.mu(16101))::text || '|true',
  'return cron: a shipment without a payment intent records one SHIPMENT_NOT_CONNECT failure');
select is(pg_temp.failures('fn_cron_return_delivery_timeout', 'dispute_id', 16302),
  'P0001|' || jsonb_build_object('dispute_id', pg_temp.mu(16302), 'shipment_id', pg_temp.mu(16102), 'error', 'TEST_OPS_FAILURE')::text || '|true',
  'return cron: a database error records its SQLSTATE with the dispute, shipment and message');
select is(
  (select d.status::text || '|' || d.resolution_type from public.disputes d where d.id = pg_temp.mu(16303))
  || '|' || pg_temp.failures('fn_cron_return_delivery_timeout', 'dispute_id', 16303),
  'resolved|buyer_wins_timeout|-', 'return cron: the next dispute is still resolved and records no failure');
select is(
  (select (c.total_errors - b.errors)::text || ':' || (c.total_processed - b.processed)::text
   from return_cron c, pg_temp.return_baseline b),
  '2:1', 'return cron: still returns the failures as errors and the resolved dispute as processed');

-- 3. fn_cron_dispute_payout_timeout ----------------------------------------------------
-- 11: no Stripe payment intent. 12: Connect, its update fails. 13: Connect, resolved.
select pg_temp.money_shipment(16211, 16111, 16001, 16002, 'delivered', null, 90000, null);
select pg_temp.money_shipment(16200 + n, 16100 + n, 16001, 16002, 'delivered') from unnest(array[12, 13]) n;
select pg_temp.money_dispute(16300 + n, 16100 + n, 'waiting_return') from generate_series(11, 13) n;
update public.disputes set return_payout_status = 'pending', updated_at = now() - interval '3 days'
where id in (select pg_temp.mu(16300 + n) from generate_series(11, 13) n);
create trigger ops_fail_payout before update on public.disputes
  for each row when (new.id = 'f0000000-0000-4000-8000-000000016312'::uuid) execute function pg_temp.fail();

set local role service_role;
select public.fn_cron_dispute_payout_timeout();
reset role;
drop trigger ops_fail_payout on public.disputes;

select is(pg_temp.failures('fn_cron_dispute_payout_timeout', 'dispute_id', 16311),
  'SHIPMENT_NOT_CONNECT|' || jsonb_build_object('dispute_id', pg_temp.mu(16311), 'shipment_id', pg_temp.mu(16111))::text || '|true',
  'payout cron: a shipment without a payment intent records one SHIPMENT_NOT_CONNECT failure');
select is(pg_temp.failures('fn_cron_dispute_payout_timeout', 'dispute_id', 16312),
  'P0001|' || jsonb_build_object('dispute_id', pg_temp.mu(16312), 'shipment_id', pg_temp.mu(16112), 'error', 'TEST_OPS_FAILURE')::text || '|true',
  'payout cron: a database error records its SQLSTATE with the dispute, shipment and message');
select is(
  (select d.status::text || '|' || d.resolution_type from public.disputes d where d.id = pg_temp.mu(16313))
  || '|' || pg_temp.failures('fn_cron_dispute_payout_timeout', 'dispute_id', 16313),
  'resolved|buyer_wins_timeout|-', 'payout cron: the next dispute is still resolved and records no failure');

-- 4. internal.fn_refresh_seller_stats ------------------------------------------------
create trigger ops_fail_stats before update on public.profiles
  for each row when (new.id = 'f0000000-0000-4000-8000-000000016001'::uuid) execute function pg_temp.fail();
select lives_ok($$select internal.fn_refresh_seller_stats('f0000000-0000-4000-8000-000000016001')$$,
  'seller stats: a failing refresh does not raise');
drop trigger ops_fail_stats on public.profiles;
select is(pg_temp.failures('fn_refresh_seller_stats', 'seller_id', 16001),
  'P0001|' || jsonb_build_object('seller_id', pg_temp.mu(16001), 'error', 'TEST_OPS_FAILURE')::text || '|true',
  'seller stats: the failure records its SQLSTATE with the seller and message');

-- 5. fn_update_product_fts --------------------------------------------------------------
-- An array in specifications makes jsonb_each_text fail inside the trigger.
select lives_ok($$update public.products set specifications = '[1]'::jsonb
                  where id = 'f0000000-0000-4000-8000-000000016101'$$,
  'product search: a failing index update does not block the product write');
select is(
  (select specifications::text from public.products where id = pg_temp.mu(16101))
  || '|' || pg_temp.failures('fn_update_product_fts', 'product_id', 16101),
  '[1]|22023|' || jsonb_build_object('product_id', pg_temp.mu(16101), 'error', 'cannot call jsonb_each_text on a non-object')::text || '|true',
  'product search: the product is saved and the failure records its SQLSTATE with the product and message');

-- 6. Writers that repeated a fact stored elsewhere write nothing ------------------------
-- Opening a dispute still moves the order to dispute; the dispute row is the record.
select is(
  (select status::text from public.orders where id = pg_temp.mu(16211)),
  'dispute', 'dispute opened: the order still moves to dispute');
select is(
  (select count(*) from public.system_logs
   where metadata ->> 'dispute_id' in (select pg_temp.mu(16300 + n)::text from generate_series(1, 13) n)),
  0::bigint, 'dispute opened and the crons: no system_logs row names these disputes');
-- A seller who initiates the return label gets success and writes no log.
select pg_temp.money_shipment(16221, 16121, 16001, 16002, 'delivered');
select pg_temp.money_dispute(16321, 16121, 'waiting_return');
select is(
  (select r.success::text || ':' || coalesce(r.error_message, '-')
   from public.fn_seller_initiate_return_label(pg_temp.mu(16321), pg_temp.mu(16001)) r)
  || '|' || (select count(*) from public.system_logs where metadata ->> 'dispute_id' = pg_temp.mu(16321)::text),
  'true:-|0', 'return label initiated: success, and no system_logs row');
select is(
  (select count(*) from public.system_logs where created_at = now()),
  0::bigint, 'nothing in this file wrote a system_logs row, the return cron summary included');

select * from finish();
rollback;
