-- Checkout recovery claims and the worker lease (#276 T5).
-- fn_claim_checkout_recovery_shells claims due recovery targets for a refund:
-- orders flagged payment_processing first, then standalone shells, by scope;
-- a refund_pending target is due at its retry time, or five minutes after it
-- was created when it has none, or at once when named; a queued retry is due
-- at its retry time; an expired refunding lease is reclaimed. A claim moves the
-- target to refunding with a five-minute lease and counts the attempt. The
-- worker lease is in cron_leases.test.sql. The targets themselves are in
-- checkout_recovery_shells.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(21);
\ir ../fixtures/money.psql

select pg_temp.money_user(7001);

-- An order of buyer 7001 for pi_crc_<n>. Times are relative to now(); a NULL
-- interval leaves the column empty. Its charge id is ch_<n>.
create function pg_temp.c_order(
  p_n integer, p_processing boolean, p_state text, p_next interval default null,
  p_lease interval default null, p_created_ago interval default interval '1 hour'
) returns void language sql as $$
  insert into public.orders (id, buyer_id, total_amount_cents, shipping_address, status, stripe_payment_intent_id,
    payment_processing, compensation_state, next_compensation_retry_at, compensation_lease_expires_at,
    compensation_attempt_count, stripe_charge_id, created_at)
  values (pg_temp.mu(p_n), pg_temp.mu(7001), 100000, '{}'::jsonb, 'pending', 'pi_crc_' || p_n,
    p_processing, p_state, now() + p_next, now() + p_lease, 3, 'ch_' || p_n, now() - p_created_ago)
$$;

-- A standalone shell for pi_crc_<p_key>, same conventions.
create function pg_temp.c_shell(
  p_key text, p_state text, p_next interval default null,
  p_lease interval default null, p_created_ago interval default interval '1 hour'
) returns void language sql as $$
  insert into internal.checkout_recovery_shells (stripe_payment_intent_id, reason, compensation_state,
    next_compensation_retry_at, compensation_lease_expires_at, compensation_attempt_count, stripe_charge_id, created_at)
  values ('pi_crc_' || p_key, 'seed', p_state, now() + p_next, now() + p_lease, 3, 'ch_' || p_key, now() - p_created_ago)
$$;

-- The claimed targets of this file as pi:charge, sorted.
create function pg_temp.claim(p_limit integer, p_pi text, p_scope text) returns text language sql as $$
  select coalesce(string_agg(c.stripe_payment_intent_id || ':' || coalesce(c.stripe_charge_id, '-'), ','
    order by c.stripe_payment_intent_id), '')
  from public.fn_claim_checkout_recovery_shells(p_limit, p_pi, p_scope) c
  where c.stripe_payment_intent_id like 'pi_crc_%'
$$;

-- n:state of orders, and key:state:attempts of shells.
create function pg_temp.o_states(p_ns integer[]) returns text language sql as $$
  select string_agg(n || ':' || coalesce(o.compensation_state, '-'), ',' order by n)
  from unnest(p_ns) n join public.orders o on o.id = pg_temp.mu(n)
$$;
create function pg_temp.s_states(p_keys text[]) returns text language sql as $$
  select string_agg(k || ':' || s.compensation_state || ':' || s.compensation_attempt_count, ',' order by k)
  from unnest(p_keys) k join internal.checkout_recovery_shells s on s.stripe_payment_intent_id = 'pi_crc_' || k
$$;

-- Execute grants of a function as anon:authenticated:service_role.
create function pg_temp.grants(p_fn regprocedure) returns text language sql as $$
  select has_function_privilege('anon', p_fn, 'execute')::text || ':'
    || has_function_privilege('authenticated', p_fn, 'execute')::text || ':'
    || has_function_privilege('service_role', p_fn, 'execute')::text
$$;

-- 1. Grants, security mode and locking ---------------------------------------------------
select is(pg_temp.grants('public.fn_claim_checkout_recovery_shells(integer, text, text)'), 'false:false:true',
  'grants: only service_role can execute fn_claim_checkout_recovery_shells');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_claim_checkout_recovery_shells'),
  'fn_claim_checkout_recovery_shells:true:search_path=public',
  'security mode: claims run as definer');
-- One session cannot show a second worker skipping a locked target, so this reads the definition.
select is(
  (select count(*)::integer from regexp_matches(
     pg_get_functiondef('public.fn_claim_checkout_recovery_shells(integer, text, text)'::regprocedure),
     'FOR\s+UPDATE\s+SKIP\s+LOCKED\s+LIMIT\s+GREATEST\(1,\s*LEAST\(p_limit,\s*100\)\)', 'g')),
  2, 'claims: both the order and the shell claim lock their candidates with FOR UPDATE SKIP LOCKED');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select throws_ok($$select * from public.fn_claim_checkout_recovery_shells(25, null, 'orders')$$,
  'P0001', 'INVALID_CHECKOUT_RECOVERY_CLAIM_SCOPE', 'claims: a scope other than order or standalone is refused');
reset role;

-- 2. Which orders are due --------------------------------------------------------------------
select pg_temp.c_order(7101, true, 'refund_pending', interval '-1 minute');
select pg_temp.c_order(7102, true, 'refund_pending', interval '1 minute');
select pg_temp.c_order(7103, true, 'refund_pending', null, null, interval '6 minutes');
select pg_temp.c_order(7104, true, 'refund_pending', null, null, interval '4 minutes');
select pg_temp.c_order(7115, true, 'refund_pending', interval '0');
select pg_temp.c_order(7116, true, 'refund_pending', null, null, interval '5 minutes');
select pg_temp.c_order(7105, true, 'refund_failed_retry_queued');
select pg_temp.c_order(7106, true, 'refund_failed_retry_queued', interval '1 minute');
select pg_temp.c_order(7107, true, 'refund_failed_retry_queued', interval '-1 minute');
select pg_temp.c_order(7108, true, 'refunding', null, interval '-1 minute');
select pg_temp.c_order(7109, true, 'refunding', null, interval '1 minute');
select pg_temp.c_order(7110, true, 'refunding');
select pg_temp.c_order(7111, false, 'refund_pending', interval '-1 minute');
select pg_temp.c_order(7112, true, 'refunded', interval '-1 minute');
select pg_temp.c_order(7113, true, null, interval '-1 minute');
select pg_temp.c_order(7114, true, 'refund_pending', interval '1 hour');
select pg_temp.c_shell('s0', 'refund_pending', interval '-1 minute');

set local role service_role;
select is(pg_temp.claim(100, null, 'order'),
  'pi_crc_7101:ch_7101,pi_crc_7103:ch_7103,pi_crc_7105:ch_7105,pi_crc_7107:ch_7107,pi_crc_7108:ch_7108,pi_crc_7115:ch_7115,pi_crc_7116:ch_7116',
  'claims: the order scope returns every due order with its charge id');
reset role;
select is(pg_temp.o_states(array[7101, 7115, 7103, 7116, 7102, 7104]),
  '7101:refunding,7102:refund_pending,7103:refunding,7104:refund_pending,7115:refunding,7116:refunding',
  'claims: refund_pending is due at or after its retry time, or five minutes after creation without one');
select is(pg_temp.o_states(array[7105, 7106, 7107]),
  '7105:refunding,7106:refund_failed_retry_queued,7107:refunding',
  'claims: a queued retry is due without a retry time or at or after it');
select is(
  (select string_agg(right(id::text, 4) || ':' || compensation_attempt_count || ':'
     || coalesce(extract(epoch from compensation_lease_expires_at - now())::integer::text, '-'), ',' order by id)
   from public.orders where id in (pg_temp.mu(7108), pg_temp.mu(7109), pg_temp.mu(7110))),
  '7108:4:300,7109:3:60,7110:3:-', 'claims: an expired refunding lease is reclaimed; a live or missing lease is not');
select is(pg_temp.o_states(array[7111, 7112, 7113]), '7111:refund_pending,7112:refunded,7113:-',
  'claims: an order without payment_processing, a refunded one or one outside recovery is never claimed');
select is(
  (select string_agg(right(id::text, 4) || ':' || compensation_attempt_count || ':'
     || coalesce(extract(epoch from compensation_lease_expires_at - now())::integer::text, '-') || ':' || (updated_at = now())::text, ',' order by id)
   from public.orders where id in (pg_temp.mu(7101), pg_temp.mu(7102))),
  '7101:4:300:true,7102:3:-:true', 'claims: a claim counts the attempt and sets a five-minute lease; an unclaimed order keeps its own');

-- 3. Scopes and a named PaymentIntent -----------------------------------------------------------
set local role service_role;
select is(pg_temp.claim(100, null, 'order'), '', 'claims: with nothing due the order scope returns nothing');
reset role;
select is(pg_temp.s_states(array['s0']), 's0:refund_pending:3', 'claims: the order scope never falls back to shells');
select pg_temp.c_order(7119, true, 'refund_pending', interval '-1 minute');
set local role service_role;
select is(pg_temp.claim(25, 'pi_crc_7114', 'order'), 'pi_crc_7114:ch_7114',
  'claims: a named refund_pending PaymentIntent is claimed before its retry time, and nothing else');
reset role;

select pg_temp.c_order(7117, true, 'refund_pending', interval '-1 minute');
select pg_temp.c_shell('s1', 'refund_pending', interval '-1 minute');
select pg_temp.c_shell('s2', 'refund_pending', interval '1 minute');
select pg_temp.c_shell('s3', 'refund_pending', null, null, interval '6 minutes');
select pg_temp.c_shell('s4', 'refund_pending', null, null, interval '4 minutes');
select pg_temp.c_shell('s5', 'refund_failed_retry_queued');
select pg_temp.c_shell('s6', 'refund_failed_retry_queued', interval '1 minute');
select pg_temp.c_shell('s7', 'refunding', null, interval '-1 minute');
select pg_temp.c_shell('s8', 'refunding', null, interval '1 minute');
select pg_temp.c_shell('s9', 'refunded', interval '-1 minute');
set local role service_role;
select is(pg_temp.claim(100, null, null), 'pi_crc_7117:ch_7117,pi_crc_7119:ch_7119',
  'claims: without a scope, due orders are claimed first and the shells wait');
select is(pg_temp.claim(100, null, null),
  'pi_crc_s0:ch_s0,pi_crc_s1:ch_s1,pi_crc_s3:ch_s3,pi_crc_s5:ch_s5,pi_crc_s7:ch_s7',
  'claims: without a scope and with no order due, the due shells are claimed');
reset role;
select is(pg_temp.s_states(array['s2', 's4', 's6', 's8', 's9']),
  's2:refund_pending:3,s4:refund_pending:3,s6:refund_failed_retry_queued:3,s8:refunding:3,s9:refunded:3',
  'claims: shells follow the order rules: not before the retry time, the five minutes or the lease expiry; never refunded');
select is(
  (select string_agg(right(stripe_payment_intent_id, 2) || ':' || compensation_state || ':' || compensation_attempt_count || ':'
     || extract(epoch from compensation_lease_expires_at - now())::integer, ',' order by stripe_payment_intent_id)
   from internal.checkout_recovery_shells where stripe_payment_intent_id in ('pi_crc_s1', 'pi_crc_s7')),
  's1:refunding:4:300,s7:refunding:4:300', 'claims: a shell claim counts the attempt and sets a five-minute lease');

select pg_temp.c_order(7118, true, 'refund_pending', interval '-1 minute');
select pg_temp.c_shell('sk', 'refund_pending', interval '-1 minute');
set local role service_role;
select is(pg_temp.claim(100, null, 'standalone'), 'pi_crc_sk:ch_sk', 'claims: the standalone scope claims only shells');
reset role;
select is(pg_temp.o_states(array[7118]), '7118:refund_pending', 'claims: the standalone scope leaves a due order alone');

-- 4. Order and limit --------------------------------------------------------------------------------
select pg_temp.c_shell('t_b', 'refund_pending', interval '-1 minute', null, now() - '1990-01-01'::timestamptz);
select pg_temp.c_shell('t_a', 'refund_pending', interval '-1 minute', null, now() - '1990-01-01'::timestamptz);
select pg_temp.c_shell('t_c', 'refund_pending', interval '-1 minute', null, now() - '1989-12-31'::timestamptz);
set local role service_role;
select is(pg_temp.claim(0, null, 'standalone') || '|' || pg_temp.claim(1, null, 'standalone'),
  'pi_crc_t_c:ch_t_c|pi_crc_t_a:ch_t_a', 'claims: a limit below 1 claims one; the oldest goes first, ties by PaymentIntent');
reset role;
insert into internal.checkout_recovery_shells (stripe_payment_intent_id, reason, next_compensation_retry_at)
select 'pi_crc_bulk_' || n, 'seed', now() - interval '1 minute' from generate_series(1, 101) n;
set local role service_role;
select is(
  (select count(*) from public.fn_claim_checkout_recovery_shells(1000, null, 'standalone')),
  100::bigint, 'claims: one call claims at most 100 targets');
reset role;

select * from finish();
rollback;
