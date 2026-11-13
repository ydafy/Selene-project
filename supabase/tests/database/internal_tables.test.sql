-- Server-only machinery tables live in schema internal (odd/tasks/internal-schema.md
-- S3, T5 and T6): webhook_deliveries, account_closures,
-- connect_account_actionability, connect_account_events, connect_payout_events,
-- checkout_recovery_shells and stripe_fee_reconciliation_jobs. Each one exists
-- only in internal, keeps RLS on with no policy, and grants nothing to any role
-- but its owner: only SECURITY DEFINER functions reach them. The Edge Functions
-- that read or wrote three of them directly now call narrow RPCs, pinned here:
-- their service_role-only access and their exact effect. The leased fee claim
-- returns a column table instead of the moved row type, with the same columns
-- in the same order (S10).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(65);
\ir ../fixtures/money.psql

create temporary table moved (name text) on commit drop;
insert into moved values
  ('webhook_deliveries'), ('account_closures'), ('connect_account_actionability'),
  ('connect_account_events'), ('connect_payout_events'),
  ('checkout_recovery_shells'), ('stripe_fee_reconciliation_jobs');

-- search_path is the exact pinned setting; the fee claim keeps its original one.
create temporary table rpcs (signature text, search_path text default '""') on commit drop;
insert into rpcs (signature) values
  ('public.fn_claim_envia_webhook_delivery(text, text, text)'),
  ('public.fn_mark_webhook_delivery(uuid, text, text)'),
  ('public.fn_list_capped_account_closures(integer, integer)'),
  ('public.fn_record_closure_cleanup_step(uuid, text, text)'),
  ('public.fn_claim_account_closures(integer, interval, integer)'),
  ('public.fn_record_closure_attempt(uuid, text, boolean)'),
  ('public.fn_enqueue_stripe_fee_reconciliation_job(uuid, text)');
insert into rpcs values
  ('public.fn_claim_stripe_fee_reconciliation_jobs_leased(integer, integer)', 'public, pg_temp');

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute 'set local role service_role';
end $$;

-- 1. Placement, RLS and grants -------------------------------------------------
select results_eq(
  $$select c.relname::text collate "default" from pg_class c
    where c.relnamespace = 'internal'::regnamespace and c.relkind = 'r'
      and c.relname in (select name from moved) order by 1$$,
  $$select name collate "default" from moved order by 1$$,
  'the seven machinery tables exist in internal');
select is_empty(
  $$select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relname in (select name from moved)$$,
  'none of them is left in public');
select is_empty(
  $$select c.relname from pg_class c
    where c.relnamespace = 'internal'::regnamespace and c.relname in (select name from moved)
      and not c.relrowsecurity$$,
  'every one keeps RLS enabled');
select is_empty(
  $$select tablename from pg_policies
    where schemaname = 'internal' and tablename in (select name from moved)$$,
  'none of them has a policy');
select is_empty(
  $$select c.relname, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.relnamespace = 'internal'::regnamespace and c.relname in (select name from moved)
      and a.grantee <> c.relowner$$,
  'no role but the owner holds a privilege on them, service_role included');
select is_empty(
  $$select r.role_name, m.name, p.priv
    from (values ('anon'), ('authenticated'), ('service_role')) r(role_name)
    cross join moved m
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where has_table_privilege(r.role_name, 'internal.' || m.name, p.priv)$$,
  'anon, authenticated and service_role hold no table privilege on them');
select fk_ok('public', 'shipment_tracking_events', 'webhook_delivery_id', 'internal', 'webhook_deliveries', 'id',
  'shipment_tracking_events.webhook_delivery_id still references the moved webhook_deliveries');
select fk_ok('internal', 'connect_payout_events', 'connect_payout_run_id', 'public', 'connect_payout_runs', 'id',
  'connect_payout_events still references connect_payout_runs');
select fk_ok('internal', 'stripe_fee_reconciliation_jobs', 'order_id', 'public', 'orders', 'id',
  'stripe_fee_reconciliation_jobs still references orders');
select has_trigger('internal', 'connect_account_events', 'trg_connect_account_events_append_only',
  'connect_account_events keeps its append-only trigger');
select has_trigger('internal', 'connect_payout_events', 'trg_connect_payout_events_append_only',
  'connect_payout_events keeps its append-only trigger');

set local role anon;
select throws_ok('select 1 from internal.webhook_deliveries', '42501', null,
  'anon cannot read internal.webhook_deliveries');
reset role;
set local role authenticated;
select throws_ok('select 1 from internal.account_closures', '42501', null,
  'authenticated cannot read internal.account_closures');
reset role;
select pg_temp.as_service();
select throws_ok('select 1 from internal.webhook_deliveries', '42501', null,
  'service_role cannot read internal.webhook_deliveries directly');
select throws_ok('select 1 from internal.stripe_fee_reconciliation_jobs', '42501', null,
  'service_role cannot read internal.stripe_fee_reconciliation_jobs directly');
reset role;

-- 2. The RPCs: SECURITY DEFINER, pinned search_path, EXECUTE for service_role only
select is_empty(
  $$select r.signature from rpcs r
    where not exists (
      select 1 from pg_proc p
      where p.oid = to_regprocedure(r.signature) and p.prosecdef
        and p.proconfig @> array['search_path=' || r.search_path]
    )$$,
  'every RPC is SECURITY DEFINER with its pinned search_path (empty; the fee claim keeps public, pg_temp)');
select results_eq(
  $$select x.role_name collate "default", r.signature collate "default"
    from rpcs r cross join (values ('anon'), ('authenticated'), ('service_role')) x(role_name)
    where has_function_privilege(x.role_name, to_regprocedure(r.signature), 'EXECUTE')
    order by 1, 2$$,
  $$select 'service_role' collate "default", signature collate "default" from rpcs order by 2$$,
  'only service_role can execute the RPCs');
select is(
  pg_get_function_result('public.fn_claim_stripe_fee_reconciliation_jobs_leased(integer, integer)'::regprocedure),
  'TABLE(id uuid, order_id uuid, stripe_payment_intent_id text, status text, attempt_count integer, '
    || 'next_retry_at timestamp with time zone, last_error text, created_at timestamp with time zone, '
    || 'updated_at timestamp with time zone, claim_token uuid, claim_expires_at timestamp with time zone)',
  'the fee claim returns the job columns in table order, not the moved row type');
set local role authenticated;
select throws_ok($$select public.fn_enqueue_stripe_fee_reconciliation_job(gen_random_uuid(), 'pi_t6')$$,
  '42501', null, 'authenticated cannot execute the fee enqueue');
reset role;

-- Run as the owner with client claims, so the body check answers, not the grant.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select * from public.fn_claim_envia_webhook_delivery('d', 'tracking.simple', repeat('a', 64))$$,
  'P0001', 'UNAUTHORIZED', 'the delivery claim refuses an authenticated caller');
select throws_ok($$select public.fn_mark_webhook_delivery(gen_random_uuid(), 'processed', null)$$,
  'P0001', 'UNAUTHORIZED', 'the delivery mark refuses an authenticated caller');
select throws_ok($$select * from public.fn_list_capped_account_closures(24, 50)$$,
  'P0001', 'UNAUTHORIZED', 'the capped list refuses an authenticated caller');
select throws_ok($$select public.fn_record_closure_cleanup_step(gen_random_uuid(), 'storage_cleanup', 'done')$$,
  'P0001', 'UNAUTHORIZED', 'the step record refuses an authenticated caller');
select throws_ok($$select public.fn_enqueue_stripe_fee_reconciliation_job(gen_random_uuid(), 'pi_t6')$$,
  '42501', 'UNAUTHORIZED', 'the fee enqueue refuses an authenticated caller');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$select * from public.fn_claim_envia_webhook_delivery('d', 'tracking.simple', repeat('a', 64))$$,
  'P0001', 'UNAUTHORIZED', 'the delivery claim refuses an anon caller');
select throws_ok($$select public.fn_mark_webhook_delivery(gen_random_uuid(), 'processed', null)$$,
  'P0001', 'UNAUTHORIZED', 'the delivery mark refuses an anon caller');
select throws_ok($$select * from public.fn_list_capped_account_closures(24, 50)$$,
  'P0001', 'UNAUTHORIZED', 'the capped list refuses an anon caller');
select throws_ok($$select public.fn_record_closure_cleanup_step(gen_random_uuid(), 'storage_cleanup', 'done')$$,
  'P0001', 'UNAUTHORIZED', 'the step record refuses an anon caller');
select throws_ok($$select public.fn_enqueue_stripe_fee_reconciliation_job(gen_random_uuid(), 'pi_t6')$$,
  '42501', 'UNAUTHORIZED', 'the fee enqueue refuses an anon caller');

-- 3. fn_claim_envia_webhook_delivery -----------------------------------------
create temporary table claims (step text, kind text, id uuid) on commit drop;
grant insert on claims to service_role;
select pg_temp.as_service();
insert into claims select 'first', c.kind, c.id
  from public.fn_claim_envia_webhook_delivery('dlv-t5-1', 'tracking.simple', repeat('a', 64)) c;
insert into claims select 'same body', c.kind, c.id
  from public.fn_claim_envia_webhook_delivery('dlv-t5-1', 'tracking.simple', repeat('a', 64)) c;
insert into claims select 'other body', c.kind, c.id
  from public.fn_claim_envia_webhook_delivery('dlv-t5-1', 'tracking.simple', repeat('b', 64)) c;
select throws_ok($$select * from public.fn_claim_envia_webhook_delivery(null, 'tracking.simple', repeat('a', 64))$$,
  'P0001', 'INVALID_ARGUMENT', 'the claim refuses a NULL delivery id');
select throws_ok($$select * from public.fn_claim_envia_webhook_delivery('', 'tracking.simple', repeat('a', 64))$$,
  'P0001', 'INVALID_ARGUMENT', 'the claim refuses an empty delivery id');
select throws_ok($$select * from public.fn_claim_envia_webhook_delivery('dlv-t5-2', '', repeat('a', 64))$$,
  'P0001', 'INVALID_ARGUMENT', 'the claim refuses an empty event name');
select throws_ok($$select * from public.fn_claim_envia_webhook_delivery('dlv-t5-2', 'tracking.simple', 'not-a-hash')$$,
  'P0001', 'INVALID_ARGUMENT', 'the claim refuses a payload hash that is not 64 hex characters');
reset role;

select results_eq(
  $$select c.step, c.kind, c.id is not null from claims c order by c.step$$,
  $$values ('first', 'new', true), ('other body', 'collision', false), ('same body', 'duplicate', false)$$,
  'a new delivery is claimed with its id; the same id repeats as duplicate, or collision with another body');
select results_eq(
  $$select d.id, d.provider, d.event_name, d.payload_sha256, d.state, d.processed_at, d.error_code
    from internal.webhook_deliveries d where d.delivery_id = 'dlv-t5-1'$$,
  $$select c.id, 'envia', 'tracking.simple', repeat('a', 64), 'received', null::timestamptz, null::text
    from claims c where c.step = 'first'$$,
  'one envia delivery row is stored with the first body hash, received, and the claimed id');
select is(
  (select count(*) from internal.webhook_deliveries where delivery_id = 'dlv-t5-2'),
  0::bigint, 'a refused claim stores nothing');

-- 4. fn_mark_webhook_delivery -------------------------------------------------
insert into internal.webhook_deliveries (provider, delivery_id, event_name, payload_sha256)
values ('envia', 'dlv-t5-3', 'tracking.simple', repeat('c', 64)),
       ('envia', 'dlv-t5-4', 'tracking.simple', repeat('d', 64));
-- The delivery ids, read as the owner: service_role cannot read the table.
select
  (select id from internal.webhook_deliveries where delivery_id = 'dlv-t5-1') as d1,
  (select id from internal.webhook_deliveries where delivery_id = 'dlv-t5-3') as d3,
  (select id from internal.webhook_deliveries where delivery_id = 'dlv-t5-4') as d4
\gset
create function pg_temp.delivery_state(p_delivery text) returns text language sql as $$
  select state || ':' || coalesce((processed_at = now())::text, '-') || ':' || coalesce(error_code, '-')
  from internal.webhook_deliveries where provider = 'envia' and delivery_id = p_delivery
$$;
select pg_temp.as_service();
select public.fn_mark_webhook_delivery(:'d3', 'processed', null);
select public.fn_mark_webhook_delivery(:'d4', 'failed', 'TRACKING_SUBJECT_NOT_UNIQUE');
select lives_ok($$select public.fn_mark_webhook_delivery(gen_random_uuid(), 'processed', null)$$,
  'marking an unknown delivery raises nothing');
select throws_ok(format('select public.fn_mark_webhook_delivery(%L, %L, null)', :'d1', 'received'),
  'P0001', 'INVALID_ARGUMENT', 'the mark refuses a state other than processed or failed');
select throws_ok(format('select public.fn_mark_webhook_delivery(%L, %L, %L)', :'d1', 'processed', 'X'),
  'P0001', 'INVALID_ARGUMENT', 'the mark refuses an error code on a processed delivery');
select throws_ok($$select public.fn_mark_webhook_delivery(null, 'processed', null)$$,
  'P0001', 'INVALID_ARGUMENT', 'the mark refuses a NULL delivery id');
reset role;
select is(pg_temp.delivery_state('dlv-t5-3'), 'processed:true:-',
  'a processed delivery is stamped processed_at and keeps no error code');
select is(pg_temp.delivery_state('dlv-t5-4'), 'failed:-:TRACKING_SUBJECT_NOT_UNIQUE',
  'a failed delivery records its error code and no processed_at');
select is(pg_temp.delivery_state('dlv-t5-1'), 'received:-:-',
  'a refused mark leaves the delivery unchanged');

-- 5. fn_list_capped_account_closures -----------------------------------------
select pg_temp.money_user(n) from generate_series(1, 6) as n;
create function pg_temp.closure(
  p_n integer, p_customer text, p_account text, p_storage text,
  p_attempts integer, p_age interval
) returns void language sql as $$
  insert into internal.account_closures (
    user_id, stripe_customer_cleanup, stripe_account_cleanup, storage_cleanup,
    attempts, updated_at
  ) values (pg_temp.mu(p_n), p_customer, p_account, p_storage, p_attempts, now() - p_age)
$$;
-- Capped at 24: 01 (an open storage step, 3 h), 02 (failed customer step, 5 h),
-- 03 (above the cap, 1 h). Not capped: 04 (every step closed), 05 (below the cap).
select pg_temp.closure(1, 'done', 'not_needed', 'pending', 24, interval '3 hours');
select pg_temp.closure(2, 'failed', 'done', 'done', 24, interval '5 hours');
select pg_temp.closure(3, 'done', 'failed', 'done', 30, interval '1 hour');
select pg_temp.closure(4, 'done', 'done', 'done', 40, interval '6 hours');
select pg_temp.closure(5, 'pending', 'pending', 'pending', 23, interval '7 hours');
select pg_temp.as_service();
select results_eq(
  $$select user_id, attempts from public.fn_list_capped_account_closures(24, 50)$$,
  $$values (pg_temp.mu(2), 24), (pg_temp.mu(1), 24), (pg_temp.mu(3), 30)$$,
  'the capped list returns closures with an open step at or above the cap, oldest first');
select results_eq(
  $$select user_id from public.fn_list_capped_account_closures(24, 2)$$,
  $$values (pg_temp.mu(2)), (pg_temp.mu(1))$$,
  'the capped list stops at the limit');
select throws_ok($$select * from public.fn_list_capped_account_closures(24, 0)$$,
  'P0001', 'INVALID_ARGUMENT', 'the capped list refuses a limit below 1');
select throws_ok($$select * from public.fn_list_capped_account_closures(24, 101)$$,
  'P0001', 'INVALID_ARGUMENT', 'the capped list refuses a limit above 100');
select throws_ok($$select * from public.fn_list_capped_account_closures(0, 50)$$,
  'P0001', 'INVALID_ARGUMENT', 'the capped list refuses a cap below 1');
select throws_ok($$select * from public.fn_list_capped_account_closures(null, 50)$$,
  'P0001', 'INVALID_ARGUMENT', 'the capped list refuses a NULL cap');
reset role;

-- 6. fn_record_closure_cleanup_step -------------------------------------------
create function pg_temp.closure_state(p_n integer) returns text language sql as $$
  select stripe_customer_cleanup || ',' || stripe_account_cleanup || ',' || storage_cleanup
    || ':' || attempts || ':' || coalesce(last_error, '-') || ':' || (updated_at = now())::text
  from internal.account_closures where user_id = pg_temp.mu(p_n)
$$;
select pg_temp.as_service();
select public.fn_record_closure_cleanup_step(pg_temp.mu(5), 'stripe_customer_cleanup', 'not_needed');
select public.fn_record_closure_cleanup_step(pg_temp.mu(5), 'stripe_account_cleanup', 'failed');
select public.fn_record_closure_cleanup_step(pg_temp.mu(5), 'storage_cleanup', 'done');
select lives_ok($$select public.fn_record_closure_cleanup_step(pg_temp.mu(6), 'storage_cleanup', 'done')$$,
  'recording a step for a user without a closure raises nothing');
select throws_ok($$select public.fn_record_closure_cleanup_step(pg_temp.mu(4), 'attempts', 'done')$$,
  'P0001', 'INVALID_ARGUMENT', 'the step record refuses a column that is not a cleanup step');
select throws_ok($$select public.fn_record_closure_cleanup_step(pg_temp.mu(4), 'storage_cleanup', 'not_needed')$$,
  'P0001', 'INVALID_ARGUMENT', 'the step record refuses not_needed for storage');
select throws_ok($$select public.fn_record_closure_cleanup_step(pg_temp.mu(4), 'stripe_customer_cleanup', 'pending')$$,
  'P0001', 'INVALID_ARGUMENT', 'the step record refuses moving a step back to pending');
select throws_ok($$select public.fn_record_closure_cleanup_step(null, 'storage_cleanup', 'done')$$,
  'P0001', 'INVALID_ARGUMENT', 'the step record refuses a NULL user');
reset role;
select is(pg_temp.closure_state(5), 'not_needed,failed,done:23:-:true',
  'each call sets its own step and stamps updated_at, without counting an attempt');
select is(pg_temp.closure_state(4), 'done,done,done:40:-:false',
  'a refused step record leaves the closure unchanged');
select is(
  (select count(*) from internal.account_closures where user_id = pg_temp.mu(6)),
  0::bigint, 'recording a step for a user without a closure writes nothing');

-- 7. fn_enqueue_stripe_fee_reconciliation_job --------------------------------
-- Replaces the webhook's direct upsert: a pending job due now, inserted once per
-- order and payment intent; a repeat changes nothing. Returns whether it inserted.
select pg_temp.money_user(7);
insert into public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id)
values (pg_temp.mu(70), pg_temp.mu(7), 1000, '{}'::jsonb, 'paid', 'pi_t6_70'),
       (pg_temp.mu(71), pg_temp.mu(7), 1000, '{}'::jsonb, 'paid', 'pi_t6_71');
create function pg_temp.fee_job_state(p_order integer) returns text language sql as $$
  select string_agg(status || ':' || attempt_count || ':' || coalesce((next_retry_at = now())::text, '-')
    || ':' || coalesce(last_error, '-') || ':' || (updated_at = now())::text, ',')
  from internal.stripe_fee_reconciliation_jobs where order_id = pg_temp.mu(p_order)
$$;
select pg_temp.as_service();
select is(public.fn_enqueue_stripe_fee_reconciliation_job(pg_temp.mu(70), 'pi_t6_70'), true,
  'the first enqueue for an order and payment intent inserts a job and returns true');
select is(public.fn_enqueue_stripe_fee_reconciliation_job(pg_temp.mu(70), 'pi_t6_70'), false,
  'a second enqueue for the same pair inserts nothing and returns false');
reset role;
select is(pg_temp.fee_job_state(70), 'pending:0:true:-:true',
  'one job is stored: pending, no attempt, due now, no error, stamped now');
insert into internal.stripe_fee_reconciliation_jobs (order_id, stripe_payment_intent_id, status, attempt_count,
  last_error, updated_at)
values (pg_temp.mu(71), 'pi_t6_71', 'failed', 2, 'earlier', now() - interval '1 hour');
select pg_temp.as_service();
select is(public.fn_enqueue_stripe_fee_reconciliation_job(pg_temp.mu(71), 'pi_t6_71'), false,
  'an enqueue for a pair whose job already exists returns false');
select throws_ok($$select public.fn_enqueue_stripe_fee_reconciliation_job(gen_random_uuid(), 'pi_t6_none')$$,
  '23503', null, 'an enqueue for an unknown order is refused by the order foreign key');
reset role;
select is(pg_temp.fee_job_state(71), 'failed:2:-:earlier:false',
  'an enqueue never resets an existing job');
select is(
  (select count(*) from internal.stripe_fee_reconciliation_jobs where stripe_payment_intent_id = 'pi_t6_none'),
  0::bigint, 'a refused enqueue stores nothing');
select pg_temp.as_service();
select results_eq(
  $$select order_id, stripe_payment_intent_id, status, attempt_count, claim_token is not null
    from public.fn_claim_stripe_fee_reconciliation_jobs_leased(25, 3)$$,
  $$values (pg_temp.mu(70), 'pi_t6_70', 'processing', 1, true)$$,
  'the leased claim returns the enqueued job as processing with a token; the failed one is not due');
reset role;

select * from finish();
rollback;
