-- Return payments and the return timeouts (#277 T15): fn_log_return_payment
-- records the return label payment and moves the dispute to return_shipped;
-- fn_cron_dispute_payout_timeout picks waiting_return disputes whose return
-- label is still pending 48 hours after their last update;
-- fn_cron_return_delivery_timeout picks return_delivered disputes 48 hours
-- after the return was delivered and returns its counts. The crons are driven
-- through shipments without a Stripe payment intent, where a picked dispute
-- gets one ERROR log (refunds.test.sql asserts that branch) and a skipped one
-- gets nothing.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(14);
\ir ../fixtures/money.psql

-- Users: 15001 seller, 15002 buyer.
select pg_temp.money_user(15001);
select pg_temp.money_user(15002);

-- Dispute 15300 + k sits on shipment 15100 + k of order 15200 + k, with no
-- Stripe payment intent.
create function pg_temp.case_dispute(p_k integer, p_status public.dispute_status)
returns uuid language plpgsql as $$
begin
  perform pg_temp.money_shipment(15200 + p_k, 15100 + p_k, 15001, 15002, 'delivered', null, 900, null);
  return pg_temp.money_dispute(15300 + p_k, 15100 + p_k, p_status);
end $$;

-- status|return_payout_status|return_payout_id|resolution_type|admin_notes|updated_at of a dispute.
create function pg_temp.dispute_sig(p_n integer) returns text language sql as $$
  select d.status::text || '|' || coalesce(d.return_payout_status, '-') || '|'
    || coalesce(d.return_payout_id, '-') || '|' || coalesce(d.resolution_type, '-') || '|'
    || coalesce(d.admin_notes, '-') || '|' || d.updated_at::text
  from public.disputes d where d.id = pg_temp.mu(p_n)
$$;

-- Cron system_logs rows that name a dispute (opening a dispute logs an INFO row too).
create function pg_temp.logs_of(p_n integer) returns bigint language sql as $$
  select count(*) from public.system_logs
  where metadata->>'dispute_id' = pg_temp.mu(p_n)::text and message like 'Cron %'
$$;

-- level|message of the cron rows that name each dispute, '-' when none.
create function pg_temp.picked(p_ns integer[]) returns text language sql as $$
  select string_agg(n::text || ':' || coalesce(
    (select string_agg(l.level || '|' || l.message, ',') from public.system_logs l
     where l.metadata->>'dispute_id' = pg_temp.mu(n)::text and l.message like 'Cron %'), '-'), ' ' order by n)
  from unnest(p_ns) n
$$;

-- 1. fn_log_return_payment -------------------------------------------------------------
-- 21: waiting_return, label pending for 3 days. 22: the same, untouched.
select pg_temp.case_dispute(21, 'waiting_return');
select pg_temp.case_dispute(22, 'waiting_return');
update public.disputes set updated_at = now() - interval '3 days', admin_notes = 'T15 note'
where id in (pg_temp.mu(15321), pg_temp.mu(15322));
create table pg_temp.sig (n integer primary key, v text);
insert into pg_temp.sig select n, pg_temp.dispute_sig(n) from (values (15322)) v(n);

set local role service_role;
select throws_ok(
  $$select public.fn_log_return_payment('f0000000-0000-4000-8000-000000015399', 'tr_test_missing', 120)$$,
  'P0002', 'DISPUTE_NOT_FOUND: f0000000-0000-4000-8000-000000015399',
  'log return payment: an unknown dispute is DISPUTE_NOT_FOUND');
select lives_ok(
  $$select public.fn_log_return_payment('f0000000-0000-4000-8000-000000015321', 'tr_test_15321', 120)$$,
  'log return payment: a waiting_return dispute is logged');
reset role;
select is(pg_temp.dispute_sig(15321),
  'return_shipped|paid|tr_test_15321|-|T15 note|' || now()::text,
  'log return payment: the dispute stores the payment id, is paid and return_shipped, and is stamped now');
select is(pg_temp.dispute_sig(15322), (select v from pg_temp.sig where n = 15322),
  'log return payment: another dispute is left unchanged');

-- 2. fn_cron_dispute_payout_timeout selection -----------------------------------------
-- 1: waiting_return, pending, updated 48 hours and 1 second ago (picked).
-- 2: the same at exactly 48 hours. 3: 47 hours. 4: payout paid. 5: payout NULL.
-- 6-8: payout pending for 3 days in open, under_review and return_shipped.
select pg_temp.case_dispute(1, 'waiting_return');
select pg_temp.case_dispute(2, 'waiting_return');
select pg_temp.case_dispute(3, 'waiting_return');
select pg_temp.case_dispute(4, 'waiting_return');
select pg_temp.case_dispute(5, 'waiting_return');
select pg_temp.case_dispute(6, 'open');
select pg_temp.case_dispute(7, 'under_review');
select pg_temp.case_dispute(8, 'return_shipped');
update public.disputes set updated_at = now() - interval '3 days'
where id in (select pg_temp.mu(n) from generate_series(15304, 15308) n);
update public.disputes set updated_at = now() - interval '48 hours 1 second' where id = pg_temp.mu(15301);
update public.disputes set updated_at = now() - interval '48 hours' where id = pg_temp.mu(15302);
update public.disputes set updated_at = now() - interval '47 hours' where id = pg_temp.mu(15303);
update public.disputes set return_payout_status = 'paid' where id = pg_temp.mu(15304);
update public.disputes set return_payout_status = null where id = pg_temp.mu(15305);

-- 3. fn_cron_return_delivery_timeout selection ----------------------------------------
-- 11: return delivered 48 hours and 1 second ago, updated now (picked).
-- 16: return delivered 3 days ago, updated 3 days ago (picked).
-- 12: delivered exactly 48 hours ago. 13: no delivery time, updated 3 days ago.
-- 14, 15: delivered 3 days ago in return_shipped and waiting_return.
select pg_temp.case_dispute(11, 'return_delivered');
select pg_temp.case_dispute(12, 'return_delivered');
select pg_temp.case_dispute(13, 'return_delivered');
select pg_temp.case_dispute(14, 'return_shipped');
select pg_temp.case_dispute(15, 'waiting_return');
select pg_temp.case_dispute(16, 'return_delivered');
update public.disputes set return_delivered_at = now() - interval '48 hours 1 second' where id = pg_temp.mu(15311);
update public.disputes set return_delivered_at = now() - interval '48 hours' where id = pg_temp.mu(15312);
update public.disputes set updated_at = now() - interval '3 days' where id = pg_temp.mu(15313);
update public.disputes set return_delivered_at = now() - interval '3 days'
where id in (pg_temp.mu(15314), pg_temp.mu(15315));
update public.disputes set return_delivered_at = now() - interval '3 days', updated_at = now() - interval '3 days'
where id = pg_temp.mu(15316);

-- Other disputes the return-delivery cron would pick up, so its counts can be compared.
create table pg_temp.cron_baseline as
select count(*) filter (where s.stripe_payment_intent_id is null) as errors,
       count(*) filter (where s.stripe_payment_intent_id is not null) as processed
from public.disputes d left join public.shipments s on s.id = d.shipment_id
where d.status = 'return_delivered' and d.return_delivered_at < now() - interval '48 hours'
  and d.id not in (pg_temp.mu(15311), pg_temp.mu(15316));

set local role service_role;
select public.fn_cron_dispute_payout_timeout();
create temp table return_cron on commit drop as select * from public.fn_cron_return_delivery_timeout();
reset role;

select is(pg_temp.picked(array[15301]),
  '15301:ERROR|Cron payout timeout: shipment has no Stripe payment intent, manual intervention required',
  'payout cron: a waiting_return dispute with the label pending for over 48 hours is picked');
select is(pg_temp.picked(array[15302, 15303]), '15302:- 15303:-',
  'payout cron: a dispute updated exactly 48 hours ago or 47 hours ago is skipped');
select is(pg_temp.picked(array[15304, 15305]), '15304:- 15305:-',
  'payout cron: a waiting_return dispute whose return payout is paid or NULL is skipped');
select is(pg_temp.picked(array[15306, 15307, 15308]), '15306:- 15307:- 15308:-',
  'payout cron: a pending return payout outside waiting_return is skipped');
select is(pg_temp.logs_of(15321), 0::bigint,
  'payout cron: a dispute whose return payment was logged is skipped');

select is(pg_temp.picked(array[15311, 15316]),
  '15311:ERROR|Cron return-delivery-timeout: shipment has no Stripe payment intent, manual intervention required '
    || '15316:ERROR|Cron return-delivery-timeout: shipment has no Stripe payment intent, manual intervention required',
  'return cron: a return_delivered dispute delivered over 48 hours ago is picked, whatever its last update');
select is(pg_temp.picked(array[15312, 15313]), '15312:- 15313:-',
  'return cron: a return delivered exactly 48 hours ago or with no delivery time is skipped');
select is(pg_temp.picked(array[15314, 15315]), '15314:- 15315:-',
  'return cron: a return delivered 3 days ago outside return_delivered is skipped');
select is(
  (select (c.total_errors - b.errors)::text || ':' || (c.total_processed - b.processed)::text
   from return_cron c, pg_temp.cron_baseline b),
  '2:0', 'return cron: returns the picked disputes as errors and none as processed');
select is(
  (select string_agg(l.metadata::text, ',') from public.system_logs l
   where l.level = 'INFO' and l.message = 'Cron return-delivery-timeout completado' and l.created_at = now()),
  (select jsonb_build_object('processed', c.total_processed, 'errors', c.total_errors)::text from return_cron c),
  'return cron: logs one INFO summary with the counts it returns');

select * from finish();
rollback;
