-- Checkout recovery targets (#276 T5). A paid checkout that could not settle is
-- recovered by refunding it. fn_upsert_checkout_recovery_shell flags the order
-- of the PaymentIntent, or keeps a standalone shell when there is no order;
-- fn_set_checkout_recovery_charge_evidence keeps the first charge id;
-- fn_mark_checkout_recovery_retry queues a retry five minutes out;
-- fn_mark_checkout_recovery_reconciliation_needed parks the target for a human; the
-- standalone and replay paths of fn_finalize_checkout_recovery (the order
-- refund path and its listings are in release_callers.test.sql). Each one
-- leaves a refunded target alone. Claims and the worker lease are in
-- checkout_recovery_claims.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(48);
\ir ../fixtures/money.psql

select pg_temp.money_user(6001);

-- An order of buyer 6001 for PaymentIntent p_pi.
create function pg_temp.rec_order(
  p_n integer, p_pi text, p_status public.order_status_enum default 'pending',
  p_state text default null, p_next interval default null, p_charge text default null, p_refund text default null
) returns uuid language sql as $$
  insert into public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id,
    compensation_state, next_compensation_retry_at, compensation_lease_expires_at, stripe_charge_id, stripe_refund_id)
  values (pg_temp.mu(p_n), pg_temp.mu(6001), 1000, '{}'::jsonb, p_status, p_pi,
    p_state, now() + p_next, case when p_state is not null then now() + interval '1 minute' end, p_charge, p_refund)
  returning id
$$;

-- A standalone shell for p_pi.
create function pg_temp.rec_shell(p_pi text, p_state text default 'refund_pending', p_charge text default null)
returns void language sql as $$
  insert into internal.checkout_recovery_shells (stripe_payment_intent_id, reason, charged_amount_cents,
    compensation_state, next_compensation_retry_at, compensation_lease_expires_at, stripe_charge_id, stripe_refund_id)
  values (p_pi, 'seed', 1000, p_state, now() + interval '1 minute', now() + interval '1 minute', p_charge,
    case when p_state = 'refunded' then 're_seed' end)
$$;

-- Seconds from now() to a timestamp, or '-' when it is NULL.
create function pg_temp.secs(p_at timestamptz) returns text language sql as $$
  select coalesce(extract(epoch from p_at - now())::integer::text, '-')
$$;

-- status|payment_processing|reason|state|attempts|next retry s|lease s|charge|refund|last error of an order.
create function pg_temp.order_rec(p_n integer) returns text language sql as $$
  select o.status::text || '|' || o.payment_processing::text || '|' || coalesce(o.payment_processing_reason, '-')
    || '|' || coalesce(o.compensation_state, '-') || '|' || o.compensation_attempt_count::text
    || '|' || pg_temp.secs(o.next_compensation_retry_at) || '|' || pg_temp.secs(o.compensation_lease_expires_at)
    || '|' || coalesce(o.stripe_charge_id, '-') || '|' || coalesce(o.stripe_refund_id, '-')
    || '|' || coalesce(o.compensation_last_error, '-')
  from public.orders o where o.id = pg_temp.mu(p_n)
$$;

-- reason|metadata|amount cents|state|attempts|next retry s|lease s|charge|refund|last error of a shell.
-- SECURITY DEFINER: the shells live in internal, which service_role cannot read.
create function pg_temp.shell_rec(p_pi text) returns text language sql security definer as $$
  select s.reason || '|' || s.source_metadata::text || '|' || coalesce(s.charged_amount_cents::text, '-')
    || '|' || s.compensation_state || '|' || s.compensation_attempt_count::text
    || '|' || pg_temp.secs(s.next_compensation_retry_at) || '|' || pg_temp.secs(s.compensation_lease_expires_at)
    || '|' || coalesce(s.stripe_charge_id, '-') || '|' || coalesce(s.stripe_refund_id, '-')
    || '|' || coalesce(s.compensation_last_error, '-')
  from internal.checkout_recovery_shells s where s.stripe_payment_intent_id = p_pi
$$;

-- Execute grants of a function as anon:authenticated:service_role.
create function pg_temp.grants(p_fn regprocedure) returns text language sql as $$
  select has_function_privilege('anon', p_fn, 'execute')::text || ':'
    || has_function_privilege('authenticated', p_fn, 'execute')::text || ':'
    || has_function_privilege('service_role', p_fn, 'execute')::text
$$;

-- 1. Grants, security mode and the shell table -----------------------------------------
select is(pg_temp.grants('public.fn_upsert_checkout_recovery_shell(text, text, jsonb, bigint, text)'), 'false:false:true',
  'grants: only service_role can execute fn_upsert_checkout_recovery_shell');
select is(pg_temp.grants('public.fn_set_checkout_recovery_charge_evidence(text, text)'), 'false:false:true',
  'grants: only service_role can execute fn_set_checkout_recovery_charge_evidence');
select is(pg_temp.grants('public.fn_mark_checkout_recovery_retry(text, text)'), 'false:false:true',
  'grants: only service_role can execute fn_mark_checkout_recovery_retry');
select is(pg_temp.grants('public.fn_mark_checkout_recovery_reconciliation_needed(text, text)'), 'false:false:true',
  'grants: only service_role can execute fn_mark_checkout_recovery_reconciliation_needed');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fn_upsert_checkout_recovery_shell',
     'fn_set_checkout_recovery_charge_evidence', 'fn_mark_checkout_recovery_retry',
     'fn_mark_checkout_recovery_reconciliation_needed', 'fn_finalize_checkout_recovery')),
  'fn_finalize_checkout_recovery:true:search_path=public fn_mark_checkout_recovery_reconciliation_needed:true:search_path=public '
    || 'fn_mark_checkout_recovery_retry:true:search_path=public fn_set_checkout_recovery_charge_evidence:true:search_path=public '
    || 'fn_upsert_checkout_recovery_shell:true:search_path=public',
  'security mode: the recovery target functions run as definer with search_path public');
select col_is_pk('internal', 'checkout_recovery_shells', 'stripe_payment_intent_id',
  'shells: one shell per PaymentIntent');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'checkout_recovery_shells_compensation_state_check'),
  'CHECK ((compensation_state = ANY (ARRAY[''refund_pending''::text, ''refunding''::text, ''refund_failed_retry_queued''::text, ''refunded''::text, ''reconciliation_needed''::text])))',
  'shells: the compensation states are refund_pending, refunding, refund_failed_retry_queued, refunded and reconciliation_needed');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'orders_compensation_state_check'),
  'CHECK (((compensation_state IS NULL) OR (compensation_state = ANY (ARRAY[''refund_pending''::text, ''refunding''::text, ''refund_failed_retry_queued''::text, ''refunded''::text, ''reconciliation_needed''::text]))))',
  'orders: the order compensation states are the same five, or NULL');

-- 2. fn_upsert_checkout_recovery_shell ----------------------------------------------------
select pg_temp.rec_order(6101, 'pi_cr_1');
select pg_temp.rec_order(6102, 'pi_cr_2', 'pending', 'refund_failed_retry_queued', interval '2 minutes');
select pg_temp.rec_order(6103, 'pi_cr_3', 'refunded', 'refunded', null, 'ch_cr_3', 're_cr_3');
select pg_temp.rec_shell('pi_cr_3');
select pg_temp.rec_shell('pi_cr_refunded', 'refunded', 'ch_seed');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

select is(public.fn_upsert_checkout_recovery_shell('pi_cr_1', 'ALLOCATION_FAILED', '{"a": 1}', 1000),
  jsonb_build_object('order_id', pg_temp.mu(6101), 'target', 'order', 'runtime_version', 'paid_checkout_recovery_v1'),
  'upsert: a PaymentIntent with an order targets the order');
select is(pg_temp.order_rec(6101), 'pending|true|ALLOCATION_FAILED|refund_pending|0|300|-|-|-|-',
  'upsert: the order is flagged payment_processing with the reason, refund_pending, retry in five minutes');
select is(public.fn_upsert_checkout_recovery_shell('pi_cr_2', 'AGAIN', '{}', 1000) ->> 'target', 'order',
  'upsert: an order already in recovery is targeted again');
select is(pg_temp.order_rec(6102), 'pending|true|AGAIN|refund_failed_retry_queued|0|120|60|-|-|-',
  'upsert: an order already in recovery keeps its state and retry time');
select is(public.fn_upsert_checkout_recovery_shell('pi_cr_3', 'LATE', '{}', 1000),
  jsonb_build_object('status', 'duplicate', 'order_id', pg_temp.mu(6103), 'runtime_version', 'paid_checkout_recovery_v1'),
  'upsert: a refunded order is a duplicate');
select is(pg_temp.order_rec(6103) || ' / ' || pg_temp.shell_rec('pi_cr_3'),
  'refunded|false|-|refunded|0|-|60|ch_cr_3|re_cr_3|- / seed|{}|1000|refunded|0|-|-|-|re_cr_3|-',
  'upsert: the refunded order is unchanged and its shell is closed with the order refund id');

select is(public.fn_upsert_checkout_recovery_shell('pi_cr_s1', 'NO_ORDER', null, 120000),
  jsonb_build_object('stripe_payment_intent_id', 'pi_cr_s1', 'target', 'standalone_recovery_shell',
    'runtime_version', 'paid_checkout_recovery_v1'),
  'upsert: a PaymentIntent without an order gets a standalone shell');
select is(pg_temp.shell_rec('pi_cr_s1'), 'NO_ORDER|{}|120000|refund_pending|0|0|-|-|-|-',
  'upsert: the new shell is refund_pending, due now, with empty metadata and the charged amount in cents');
select is(public.fn_upsert_checkout_recovery_shell('pi_cr_s1', 'NO_ORDER_AGAIN', '{"b": 2}', 999, 'ch_cr_s1') ->> 'target',
  'standalone_recovery_shell', 'upsert: a repeated standalone upsert targets the same shell');
select is(pg_temp.shell_rec('pi_cr_s1'), 'NO_ORDER_AGAIN|{"b": 2}|120000|refund_pending|0|0|-|ch_cr_s1|-|-',
  'upsert: a repeat replaces reason and metadata, keeps the first amount and fills a missing charge id');
select is(public.fn_upsert_checkout_recovery_shell('pi_cr_s1', 'THIRD', '{}', 1, 'ch_cr_other') ->> 'target',
  'standalone_recovery_shell', 'upsert: a third upsert still targets the shell');
select is(split_part(pg_temp.shell_rec('pi_cr_s1'), '|', 8), 'ch_cr_s1', 'upsert: the first charge id is never replaced');
select is(public.fn_upsert_checkout_recovery_shell('pi_cr_refunded', 'LATE', '{}', 1, 'ch_late'),
  jsonb_build_object('status', 'duplicate', 'runtime_version', 'paid_checkout_recovery_v1'),
  'upsert: a refunded shell is a duplicate');
select is(pg_temp.shell_rec('pi_cr_refunded'), 'seed|{}|1000|refunded|0|60|60|ch_seed|re_seed|-',
  'upsert: the refunded shell is unchanged');

-- 3. fn_set_checkout_recovery_charge_evidence -----------------------------------------------
reset role;
select pg_temp.rec_order(6104, 'pi_cr_4', 'pending', 'refund_pending', null, 'ch_first');
select pg_temp.rec_shell('pi_cr_s2');
set local role service_role;
select throws_ok($$select public.fn_set_checkout_recovery_charge_evidence('pi_cr_1', '')$$,
  'P0001', 'STRIPE_CHARGE_ID_REQUIRED', 'evidence: an empty charge id is refused');
select is(public.fn_set_checkout_recovery_charge_evidence('pi_cr_1', 'ch_cr_1') || ':' || public.fn_set_checkout_recovery_charge_evidence('pi_cr_4', 'ch_second'),
  'ch_cr_1:ch_first', 'evidence: an order takes the charge id when it has none, and returns its first one otherwise');
select is(split_part(pg_temp.order_rec(6104), '|', 8), 'ch_first', 'evidence: the order first charge id stays');
select is(public.fn_set_checkout_recovery_charge_evidence('pi_cr_s2', 'ch_s2') || ':' || public.fn_set_checkout_recovery_charge_evidence('pi_cr_s2', 'ch_s2b'),
  'ch_s2:ch_s2', 'evidence: a standalone shell keeps its first charge id');
select throws_ok($$select public.fn_set_checkout_recovery_charge_evidence('pi_cr_3', 'ch_x')$$,
  'P0001', 'CHECKOUT_RECOVERY_TARGET_NOT_FOUND', 'evidence: a refunded order and its refunded shell are not a target');
select throws_ok($$select public.fn_set_checkout_recovery_charge_evidence('pi_cr_none', 'ch_x')$$,
  'P0001', 'CHECKOUT_RECOVERY_TARGET_NOT_FOUND', 'evidence: an unknown PaymentIntent is not a target');

-- 4. fn_mark_checkout_recovery_retry ----------------------------------------------------------
reset role;
select pg_temp.rec_order(6105, 'pi_cr_5', 'pending', 'refunding', interval '1 hour');
select pg_temp.rec_shell('pi_cr_s3', 'refunding');
select pg_temp.rec_shell('pi_cr_s4', 'refunding');
update internal.checkout_recovery_shells set compensation_attempt_count = 2 where stripe_payment_intent_id = 'pi_cr_s3';
set local role service_role;
select public.fn_mark_checkout_recovery_retry('pi_cr_5', 'stripe timeout');
select is(pg_temp.order_rec(6105), 'pending|false|-|refund_failed_retry_queued|0|300|-|-|-|stripe timeout',
  'retry: the order is queued for a retry in five minutes with the error, and its lease is cleared');
select public.fn_mark_checkout_recovery_retry('pi_cr_s3', 'stripe timeout');
select is(pg_temp.shell_rec('pi_cr_s3'), 'seed|{}|1000|refund_failed_retry_queued|2|300|-|-|-|stripe timeout',
  'retry: the shell is queued the same way and keeps its attempt count');
select public.fn_mark_checkout_recovery_retry('pi_cr_3', 'late');
select public.fn_mark_checkout_recovery_retry('pi_cr_refunded', 'late');
select is(pg_temp.order_rec(6103) || ' / ' || pg_temp.shell_rec('pi_cr_3') || ' / ' || pg_temp.shell_rec('pi_cr_refunded'),
  'refunded|false|-|refunded|0|-|60|ch_cr_3|re_cr_3|- / seed|{}|1000|refunded|0|-|-|-|re_cr_3|- / seed|{}|1000|refunded|0|60|60|ch_seed|re_seed|-',
  'retry: a refunded order and refunded shells are left alone');

-- 5. fn_mark_checkout_recovery_reconciliation_needed -------------------------------------------
-- A target without charge evidence is parked for a human (#383): the claim
-- never picks it up again.
reset role;
select pg_temp.rec_shell('pi_cr_s5', 'refunding');
set local role service_role;
select public.fn_mark_checkout_recovery_reconciliation_needed('pi_cr_5', 'no charge');
select is(pg_temp.order_rec(6105), 'pending|false|-|reconciliation_needed|0|-|-|-|-|no charge',
  'reconciliation: the order is parked with the error, and its retry time and lease are cleared');
select public.fn_mark_checkout_recovery_reconciliation_needed('pi_cr_s5', 'no charge');
select is(pg_temp.shell_rec('pi_cr_s5'), 'seed|{}|1000|reconciliation_needed|0|-|-|-|-|no charge',
  'reconciliation: the standalone shell is parked the same way');
select is((select count(*)::integer from public.fn_claim_checkout_recovery_shells(10, 'pi_cr_5', 'order'))
  + (select count(*)::integer from public.fn_claim_checkout_recovery_shells(10, 'pi_cr_s5', 'standalone')), 0,
  'reconciliation: a parked order or shell is never claimed again');
select lives_ok($$select public.fn_mark_checkout_recovery_reconciliation_needed('pi_cr_3', 'late')$$,
  'reconciliation: a refunded order with a refunded shell matches nothing and does not fail');
select lives_ok($$select public.fn_mark_checkout_recovery_reconciliation_needed('pi_cr_none', 'x')$$,
  'reconciliation: an unknown PaymentIntent matches nothing and does not fail');

-- 6. fn_finalize_checkout_recovery: standalone and replays ------------------------------------
reset role;
select pg_temp.rec_order(6106, 'pi_cr_6', 'pending', 'refunding', interval '1 hour', 'ch_cr_6');
update public.orders set payment_processing = true, payment_processing_reason = 'ALLOCATION_FAILED'
where id = pg_temp.mu(6106);
select pg_temp.rec_order(6107, 'pi_cr_7', 'refunded', 'refunded', null, null, 're_order_7');
select pg_temp.rec_shell('pi_cr_7', 'refunding');
set local role service_role;
select throws_ok($$select public.fn_finalize_checkout_recovery('pi_cr_s4', '')$$,
  'P0001', 'STRIPE_REFUND_ID_REQUIRED', 'finalize: an empty refund id is refused');
select is(pg_temp.shell_rec('pi_cr_s4'), 'seed|{}|1000|refunding|0|60|60|-|-|-',
  'finalize: the refused call leaves the shell unchanged');
select is(public.fn_finalize_checkout_recovery('pi_cr_s4', 're_s4'),
  jsonb_build_object('status', 'refunded', 'stripe_payment_intent_id', 'pi_cr_s4'),
  'finalize: a standalone shell is refunded');
select is(pg_temp.shell_rec('pi_cr_s4'), 'seed|{}|1000|refunded|0|-|-|-|re_s4|-',
  'finalize: the shell keeps the refund id and clears its lease and retry time');
select is(public.fn_finalize_checkout_recovery('pi_cr_s4', 're_s4_again'),
  jsonb_build_object('status', 'duplicate', 'stripe_payment_intent_id', 'pi_cr_s4'),
  'finalize: a second finalize of the shell is a duplicate');
select is(split_part(pg_temp.shell_rec('pi_cr_s4'), '|', 9), 're_s4', 'finalize: the duplicate keeps the first refund id');
select throws_ok($$select public.fn_finalize_checkout_recovery('pi_cr_none', 're_x')$$,
  'P0001', 'CHECKOUT_RECOVERY_TARGET_NOT_FOUND', 'finalize: an unknown PaymentIntent is refused');
select is(public.fn_finalize_checkout_recovery('pi_cr_6', 're_cr_6'),
  jsonb_build_object('status', 'refunded', 'order_id', pg_temp.mu(6106)), 'finalize: an order in recovery is refunded');
select is(pg_temp.order_rec(6106), 'refunded|false|-|refunded|0|-|-|ch_cr_6|re_cr_6|-',
  'finalize: the refunded order clears payment_processing, its reason, lease and retry time');
select is(public.fn_finalize_checkout_recovery('pi_cr_7', 're_new'),
  jsonb_build_object('status', 'duplicate', 'order_id', pg_temp.mu(6107)), 'finalize: an already refunded order is a duplicate');
select is(pg_temp.order_rec(6107) || ' / ' || pg_temp.shell_rec('pi_cr_7'),
  'refunded|false|-|refunded|0|-|60|-|re_order_7|- / seed|{}|1000|refunded|0|-|-|-|re_new|-',
  'finalize: the duplicate leaves the order alone and closes its open shell with the given refund id');
reset role;

-- 7. The worker switch ----------------------------------------------------------------------------
select is(
  (select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by column_name)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'system_settings' and column_name like 'checkout_recovery%'),
  'checkout_recovery_enabled:boolean:NO:false',
  'settings: the worker is off by default; its lease lives in internal.cron_leases and the old running flag is gone');

select * from finish();
rollback;
