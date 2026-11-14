-- Dispute refunds (#276 T2): the non-Connect order and refund functions are
-- gone; fn_record_dispute_refund is service-role only, locks the shipment
-- before the dispute, refuses in a fixed order without writing, and records a
-- Stripe refund on the shipment, the dispute and system_logs; the two dispute
-- crons leave a dispute whose shipment has no Stripe payment intent alone and
-- log it for manual intervention.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(37);
\ir ../fixtures/money.psql

-- Users: 7001 seller, 7002 buyer.
select pg_temp.money_user(7001);
select pg_temp.money_user(7002);

-- status|resolution_type|admin_notes|updated_at of a dispute and status|updated_at
-- of its shipment, to prove a refusal changed nothing.
create function pg_temp.refund_sig(p_n integer) returns text language sql as $$
  select coalesce(s.status::text, '-') || '|' || coalesce(s.updated_at::text, '-') || '|'
    || d.status::text || '|' || coalesce(d.resolution_type, '-') || '|'
    || coalesce(d.admin_notes, '-') || '|' || d.updated_at::text
  from public.disputes d left join public.shipments s on s.id = pg_temp.mu(p_n - 200)
  where d.id = pg_temp.mu(p_n)
$$;

-- success:error_code of fn_record_dispute_refund for dispute p_n.
create function pg_temp.record(p_n integer, p_refund text default 're_test') returns text language sql as $$
  select r.success::text || ':' || coalesce(r.error_code, '-')
  from public.fn_record_dispute_refund(pg_temp.mu(p_n), p_refund) r
$$;

-- xmax of a shipment (kind 's') or dispute ('d') row. The refusals run in a
-- savepoint, so a row the function locks gets the subtransaction's xmax; the
-- foreign keys of the fixtures already left this transaction's xid there.
create function pg_temp.row_xmax(p_kind text, p_n integer) returns text language sql as $$
  select case p_kind
    when 's' then (select xmax::text from public.shipments where id = pg_temp.mu(p_n))
    else (select xmax::text from public.disputes where id = pg_temp.mu(p_n)) end
$$;

-- 1. The non-Connect order and refund path is gone ---------------------------------
select is((select count(*) from pg_proc where proname = 'fn_seller_confirm_return_shipment'), 0::bigint,
  'fn_seller_confirm_return_shipment does not exist');
select is((select count(*) from pg_proc where proname = 'fn_complete_shipment_refund'), 0::bigint,
  'fn_complete_shipment_refund does not exist');
select is((select count(*) from pg_proc where proname = 'fn_create_order_from_payment'), 0::bigint,
  'fn_create_order_from_payment does not exist');
select is((select count(*) from pg_proc where proname = 'fn_cancel_order'), 0::bigint,
  'fn_cancel_order does not exist');

-- 2. Grants and security mode ------------------------------------------------------
-- Checked as privileges: fn_record_dispute_refund refuses non-service callers
-- itself (section 3), so a 42501 would not prove the grant.
select is(
  (select string_agg(r || ':' || has_function_privilege(r, f, 'execute')::text, ' ' order by f, r)
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array['public.fn_record_dispute_refund(uuid, text)']) f),
  'anon:false authenticated:false service_role:true',
  'fn_record_dispute_refund: only service_role can execute it');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, f, 'execute')::text, ' ' order by f, r)
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array['public.fn_cron_dispute_payout_timeout()']) f),
  'anon:false authenticated:false service_role:true',
  'fn_cron_dispute_payout_timeout: only service_role can execute it');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, f, 'execute')::text, ' ' order by f, r)
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array['public.fn_cron_return_delivery_timeout()']) f),
  'anon:false authenticated:false service_role:true',
  'fn_cron_return_delivery_timeout: only service_role can execute it');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_record_dispute_refund', 'fn_cron_dispute_payout_timeout', 'fn_cron_return_delivery_timeout')),
  'fn_cron_dispute_payout_timeout:true:search_path=public fn_cron_return_delivery_timeout:true:search_path=public, pg_temp fn_record_dispute_refund:true:search_path=""',
  'security mode and search_path: all three run as definer');

-- 3. fn_record_dispute_refund refuses any caller but service_role --------------------
-- postgres holds execute, so these reach the function's own role check.
select set_config('request.jwt.claims', '{"sub": "f0000000-0000-4000-8000-000000007002", "role": "authenticated"}', true);
select throws_ok($$select * from public.fn_record_dispute_refund(gen_random_uuid(), 're_x')$$,
  '42501', 'fn_record_dispute_refund is service-role only', 'record: an authenticated caller is refused with 42501');
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.fn_record_dispute_refund(gen_random_uuid(), 're_x')$$,
  '42501', 'fn_record_dispute_refund is service-role only', 'record: a caller without claims is refused with 42501');

-- 4. Refusals, in check order ------------------------------------------------------
-- Shipment 71nn, order 72nn, dispute 73nn.
-- 7101: dispute without a shipment.
select pg_temp.money_shipment(7201, 7101, 7001, 7002, 'delivered');
select pg_temp.money_dispute(7301, 7101, 'waiting_return');
update public.disputes set shipment_id = null where id = pg_temp.mu(7301);
-- 7102: no Connect payment, already refunded with a buyer resolution: Connect before replay.
select pg_temp.money_shipment(7202, 7102, 7001, 7002, 'refunded', null, 90000, null);
select pg_temp.money_dispute(7302, 7102, 'resolved');
-- 7103: refunded and resolved for the buyer: a replay.
select pg_temp.money_shipment(7203, 7103, 7001, 7002, 'refunded');
select pg_temp.money_dispute(7303, 7103, 'resolved');
update public.disputes set resolution_type = 'buyer' where id in (pg_temp.mu(7302), pg_temp.mu(7303));
-- 7104: refunded but resolved for the seller: not a replay.
select pg_temp.money_shipment(7204, 7104, 7001, 7002, 'refunded');
select pg_temp.money_dispute(7304, 7104, 'resolved');
update public.disputes set resolution_type = 'seller' where id = pg_temp.mu(7304);
-- 7105: paid with an open dispute: the dispute status is checked before the shipment status.
select pg_temp.money_shipment(7205, 7105, 7001, 7002, 'paid');
select pg_temp.money_dispute(7305, 7105, 'open');
-- 7106, 7107: delivered with an under_review or return_shipped dispute.
select pg_temp.money_shipment(7206, 7106, 7001, 7002, 'delivered');
select pg_temp.money_dispute(7306, 7106, 'under_review');
select pg_temp.money_shipment(7207, 7107, 7001, 7002, 'delivered');
select pg_temp.money_dispute(7307, 7107, 'return_shipped');
-- 7108: paid, waiting_return. 7109: completed, return_delivered.
select pg_temp.money_shipment(7208, 7108, 7001, 7002, 'paid');
select pg_temp.money_dispute(7308, 7108, 'waiting_return');
select pg_temp.money_shipment(7209, 7109, 7001, 7002, 'completed');
select pg_temp.money_dispute(7309, 7109, 'return_delivered');
update public.shipments set updated_at = now() - interval '10 days'
where id in (select pg_temp.mu(n) from generate_series(7101, 7109) n);
update public.disputes set updated_at = now() - interval '10 days'
where id in (select pg_temp.mu(n) from generate_series(7301, 7309) n);

create table pg_temp.sig (n integer primary key, v text);
insert into pg_temp.sig select n, pg_temp.refund_sig(n) from generate_series(7301, 7309) n;
create table pg_temp.before_writes as
select (select count(*) from public.system_logs
        where metadata->>'dispute_id' in (select pg_temp.mu(n)::text from generate_series(7300, 7309) n)
           or metadata->>'shipment_id' in (select pg_temp.mu(n)::text from generate_series(7101, 7109) n)) as logs,
       (select count(*) from public.notifications where user_id in (pg_temp.mu(7001), pg_temp.mu(7002))) as notices;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
create table pg_temp.xmax_before as
select k, n, pg_temp.row_xmax(k, n) as v from (values ('s', 7102), ('d', 7302), ('s', 7105), ('d', 7305)) v(k, n);
savepoint record_refusals;
set local role service_role;
create temp table rec_result on commit drop as
select n, pg_temp.record(n) as r from (values (7300), (7301), (7302), (7303), (7304), (7305),
  (7306), (7307), (7308), (7309)) v(n);
reset role;
release savepoint record_refusals;

select is((select r from rec_result where n = 7300), 'false:DISPUTE_NOT_FOUND', 'record: an unknown dispute is DISPUTE_NOT_FOUND');
select is((select r from rec_result where n = 7301), 'false:SHIPMENT_NOT_FOUND', 'record: a dispute without a shipment is SHIPMENT_NOT_FOUND');
select is((select r from rec_result where n = 7302), 'false:SHIPMENT_NOT_CONNECT',
  'record: a shipment without a Connect payment is SHIPMENT_NOT_CONNECT, checked before the replay');
select is((select r from rec_result where n = 7303), 'true:ALREADY_RECORDED',
  'record: a refunded shipment with a dispute resolved for the buyer is ALREADY_RECORDED');
select is((select r from rec_result where n = 7304), 'false:INVALID_DISPUTE_STATUS',
  'record: a refunded shipment with a dispute resolved for the seller is INVALID_DISPUTE_STATUS');
select is((select r from rec_result where n = 7305), 'false:INVALID_DISPUTE_STATUS',
  'record: an open dispute is INVALID_DISPUTE_STATUS, checked before the shipment status');
select is((select string_agg(r, ',' order by n) from rec_result where n in (7306, 7307)),
  'false:INVALID_DISPUTE_STATUS,false:INVALID_DISPUTE_STATUS',
  'record: under_review and return_shipped disputes are INVALID_DISPUTE_STATUS');
select is((select r from rec_result where n = 7308), 'false:SHIPMENT_NOT_REFUNDABLE:paid',
  'record: a paid shipment is SHIPMENT_NOT_REFUNDABLE with its status');
select is((select r from rec_result where n = 7309), 'false:SHIPMENT_NOT_REFUNDABLE:completed',
  'record: a completed shipment is SHIPMENT_NOT_REFUNDABLE with its status');
select is(
  (select count(*) from pg_temp.sig where v is distinct from pg_temp.refund_sig(n)),
  0::bigint, 'record: every refusal and the replay leave the shipment and the dispute unchanged');
select is(
  (select (select count(*) from public.system_logs
           where metadata->>'dispute_id' in (select pg_temp.mu(n)::text from generate_series(7300, 7309) n)
              or metadata->>'shipment_id' in (select pg_temp.mu(n)::text from generate_series(7101, 7109) n))
          || ':' || (select count(*) from public.notifications where user_id in (pg_temp.mu(7001), pg_temp.mu(7002)))),
  (select logs || ':' || notices from pg_temp.before_writes),
  'record: every refusal and the replay write no log and no notice');

-- Lock order: the shipment row is locked before the shipment checks, the
-- dispute row only after them.
select is(
  (select string_agg((v is distinct from pg_temp.row_xmax(k, n))::text, ':' order by k desc)
   from pg_temp.xmax_before where n in (7102, 7302)),
  'true:false', 'record: a refusal on the shipment holds the shipment lock and has not locked the dispute');
select is(
  (select string_agg((v is distinct from pg_temp.row_xmax(k, n))::text, ':' order by k desc)
   from pg_temp.xmax_before where n in (7105, 7305)),
  'true:true', 'record: a refusal on the dispute holds both the shipment and the dispute locks');

-- 5. Recording a refund ------------------------------------------------------------
-- 7110: shipped, waiting_return. 7111: delivered, return_delivered, earlier notes, no refund id.
select pg_temp.money_shipment(7210, 7110, 7001, 7002, 'shipped');
select pg_temp.money_dispute(7310, 7110, 'waiting_return');
select pg_temp.money_shipment(7211, 7111, 7001, 7002, 'delivered');
select pg_temp.money_dispute(7311, 7111, 'return_delivered');
update public.disputes set admin_notes = 'Prior note' where id = pg_temp.mu(7311);
update public.shipments set updated_at = now() - interval '10 days' where id in (pg_temp.mu(7110), pg_temp.mu(7111));
update public.disputes set updated_at = now() - interval '10 days' where id in (pg_temp.mu(7310), pg_temp.mu(7311));

set local role service_role;
select is(pg_temp.record(7310, 're_test_7110'), 'true:-', 'record: a shipped shipment with a waiting_return dispute is recorded');
select is(pg_temp.record(7311, null), 'true:-', 'record: a delivered shipment with a return_delivered dispute is recorded');
reset role;
select is(
  (select string_agg(s.status::text || ':' || (s.updated_at = now())::text, ',' order by s.id)
   from public.shipments s where s.id in (pg_temp.mu(7110), pg_temp.mu(7111))),
  'refunded:true,refunded:true', 'record: the shipment becomes refunded with updated_at set');
select is(
  (select d.status::text || '|' || d.resolution_type || '|' || d.admin_notes || '|' || (d.updated_at = now())::text
   from public.disputes d where d.id = pg_temp.mu(7310)),
  'resolved|buyer|' || E'\n[SYSTEM]: Reembolso Stripe re_test_7110 registrado.' || '|true',
  'record: the dispute is resolved for the buyer with the refund id in the notes');
select is(
  (select d.admin_notes from public.disputes d where d.id = pg_temp.mu(7311)),
  E'Prior note\n[SYSTEM]: Reembolso Stripe unknown registrado.',
  'record: earlier notes are kept and a missing refund id is written as unknown');
select is(
  (select string_agg(l.level || ':' || l.message || ':' || l.metadata::text, ' ' order by l.metadata->>'stripe_refund_id' nulls last)
   from public.system_logs l
   where l.message = 'Dispute refund recorded' and l.metadata->>'dispute_id' in (pg_temp.mu(7310)::text, pg_temp.mu(7311)::text)),
  'INFO:Dispute refund recorded:' || jsonb_build_object('dispute_id', pg_temp.mu(7310), 'shipment_id', pg_temp.mu(7110), 'stripe_refund_id', 're_test_7110')::text
    || ' INFO:Dispute refund recorded:' || jsonb_build_object('dispute_id', pg_temp.mu(7311), 'shipment_id', pg_temp.mu(7111), 'stripe_refund_id', null)::text,
  'record: one INFO log per refund with the dispute, the shipment and the refund id');

create table pg_temp.recorded as select pg_temp.refund_sig(7310) as v;
set local role service_role;
select is(pg_temp.record(7310, 're_test_again'), 'true:ALREADY_RECORDED', 'record: a second call is ALREADY_RECORDED');
reset role;
select is(
  pg_temp.refund_sig(7310) || ':' || (select count(*) from public.system_logs
                                        where message = 'Dispute refund recorded' and metadata->>'dispute_id' = pg_temp.mu(7310)::text),
  (select v from pg_temp.recorded) || ':1', 'record: a second call changes nothing and logs nothing');

-- 6. Dispute crons: a shipment without a Stripe payment intent -----------------------
-- Keep the disputes above out of the crons' selection.
update public.disputes set updated_at = now() where id in (select pg_temp.mu(n) from generate_series(7301, 7311) n);
-- 7120: waiting_return, return label unpaid for 49 hours. 7121: return delivered 49 hours ago.
select pg_temp.money_shipment(7220, 7120, 7001, 7002, 'delivered', null, 90000, null);
select pg_temp.money_dispute(7320, 7120, 'waiting_return');
select pg_temp.money_shipment(7221, 7121, 7001, 7002, 'delivered', null, 90000, null);
select pg_temp.money_dispute(7321, 7121, 'return_delivered');
update public.disputes set updated_at = now() - interval '49 hours' where id = pg_temp.mu(7320);
update public.disputes set return_delivered_at = now() - interval '49 hours', updated_at = now() - interval '49 hours'
where id = pg_temp.mu(7321);
insert into pg_temp.sig select n, pg_temp.refund_sig(n) from (values (7320), (7321)) v(n);
create table pg_temp.cron_notices as
select count(*) as n from public.notifications where user_id in (pg_temp.mu(7001), pg_temp.mu(7002));
-- Other disputes the return-delivery cron would pick up, so its counts can be compared.
create table pg_temp.cron_baseline as
select count(*) filter (where s.stripe_payment_intent_id is null) as errors,
       count(*) filter (where s.stripe_payment_intent_id is not null) as processed
from public.disputes d left join public.shipments s on s.id = d.shipment_id
where d.status = 'return_delivered' and d.return_delivered_at < now() - interval '48 hours'
  and d.id <> pg_temp.mu(7321);

set local role service_role;
select public.fn_cron_dispute_payout_timeout();
create temp table return_cron on commit drop as select * from public.fn_cron_return_delivery_timeout();
reset role;

select is(
  (select count(*) from public.system_logs
   where level = 'ERROR'
     and message = 'Cron payout timeout: shipment has no Stripe payment intent, manual intervention required'
     and metadata = jsonb_build_object('dispute_id', pg_temp.mu(7320), 'shipment_id', pg_temp.mu(7120))),
  1::bigint, 'payout cron: a shipment without a payment intent logs one ERROR for manual intervention');
select is(pg_temp.refund_sig(7320), (select v from pg_temp.sig where n = 7320),
  'payout cron: the dispute and the shipment without a payment intent are left unchanged');
select is(
  (select count(*) from public.system_logs
   where level = 'ERROR'
     and message = 'Cron return-delivery-timeout: shipment has no Stripe payment intent, manual intervention required'
     and metadata = jsonb_build_object('dispute_id', pg_temp.mu(7321), 'shipment_id', pg_temp.mu(7121))),
  1::bigint, 'return cron: a shipment without a payment intent logs one ERROR for manual intervention');
select is(pg_temp.refund_sig(7321), (select v from pg_temp.sig where n = 7321),
  'return cron: the dispute and the shipment without a payment intent are left unchanged');
select is(
  (select (c.total_errors - b.errors)::text || ':' || (c.total_processed - b.processed)::text
   from return_cron c, pg_temp.cron_baseline b),
  '1:0', 'return cron: the dispute counts as an error, not as processed');
select is(
  (select count(*) from public.notifications where user_id in (pg_temp.mu(7001), pg_temp.mu(7002))),
  (select n from pg_temp.cron_notices), 'crons: neither cron notifies the buyer or the seller of these disputes');

select * from finish();
rollback;
