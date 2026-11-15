-- Overdue payout refund hardening (#549 Part B, odd/tasks/held-payout-overdue-refund.md
-- T5b, S3, L16).
-- 1. fn_lease_overdue_refund_replay: before the admin's retry replays the frozen
--    refund of an escalated operation past Stripe's idempotency window, it takes
--    an exclusive, expiring lease on the operation, so two concurrent retries
--    cannot both create a refund.
-- 2. Stripe can turn a succeeded overdue refund into failed after the shipment
--    is refunded: the refund event never reopens it or counts a second loss, and
--    the admin records the manual repayment without a second completion.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(40);
\ir ../fixtures/money.psql

create function pg_temp.claim(p_shipment integer) returns jsonb language sql as $$
  select public.fn_claim_overdue_payout_refund(pg_temp.mu(9410), pg_temp.mu(p_shipment))
$$;
-- The refund request the Edge Function freezes: 11000 cents, caller_role admin.
create function pg_temp.request(p_shipment integer) returns jsonb language sql as $$
  select jsonb_build_object('payment_intent', s.stripe_payment_intent_id, 'amount', 11000,
    'reason', 'requested_by_customer',
    'metadata', jsonb_build_object('shipment_id', s.id::text, 'order_id', s.order_id::text,
      'caller_role', 'admin', 'reason', 'overdue_payout_seller_rejected', 'seguro_share_cents', 1000))
  from public.shipments s where s.id = pg_temp.mu(p_shipment)
$$;
-- Claims and starts the overdue refund of p_shipment.
create function pg_temp.started(p_shipment integer) returns void language sql as $$
  select public.fn_start_shipment_cancellation_refund(pg_temp.mu(p_shipment),
    (pg_temp.claim(p_shipment) ->> 'claim_token')::uuid, pg_temp.request(p_shipment), 300);
$$;
create function pg_temp.lease(p_shipment integer) returns jsonb language plpgsql as $$
begin
  return public.fn_lease_overdue_refund_replay(pg_temp.mu(p_shipment));
end $$;
create function pg_temp.rec(p_shipment integer, p_refund text, p_status text) returns jsonb language sql as $$
  select public.fn_record_shipment_cancellation_refund(pg_temp.mu(p_shipment), p_refund,
    (select stripe_payment_intent_id from public.shipments where id = pg_temp.mu(p_shipment)), 11000, p_status)
$$;
create function pg_temp.apply(p_shipment integer, p_refund text, p_status text) returns jsonb language sql as $$
  select public.fn_apply_shipment_cancellation_refund_event(pg_temp.mu(p_shipment), p_refund,
    (select stripe_payment_intent_id from public.shipments where id = pg_temp.mu(p_shipment)), 11000, p_status,
    case when p_status = 'failed' then 'expired_or_canceled_card' end)
$$;
create function pg_temp.resolve(p_admin integer, p_shipment integer, p_reference text default 'SPEI 4405')
returns jsonb language sql as $$
  select public.fn_resolve_shipment_cancellation_refund(pg_temp.mu(p_shipment), pg_temp.mu(p_admin), p_reference)
$$;
create function pg_temp.notices(p_shipment integer, p_kind text) returns bigint language sql as $$
  select count(*) from public.notifications
  where event_kind = p_kind and event_payload ->> 'shipment_id' = pg_temp.mu(p_shipment)::text
$$;
-- Every row the lease or a refused resolution may touch: shipments, operations
-- (lease included), orders and their losses, notices and audit rows.
create function pg_temp.stored() returns text language sql as $$
  select (select string_agg(s.id::text || ':' || s.status || ':' || coalesce(o.claim_token::text, '-') || ':'
      || coalesce(o.claim_expires_at::text, '-') || ':' || coalesce(o.refund_status, '-') || ':'
      || coalesce(o.refund_resolved_at::text, '-') || ':' || coalesce(o.refund_resolution_reference, '-') || ':'
      || coalesce(o.label_cost_loss_cents::text, '-'), ',' order by s.id)
    from public.shipments s left join public.shipment_cancellation_operations o on o.shipment_id = s.id
    where s.id in (select pg_temp.mu(n) from generate_series(9401, 9409) as n)) || '|' ||
    (select string_agg(o.id::text || ':' || o.status || ':' || coalesce(o.cancellation_loss_cents::text, '-'), ',' order by o.id)
     from public.orders o where o.id in (select pg_temp.mu(n) from generate_series(9501, 9509) as n)) || '|' ||
    (select count(*) from public.notifications
     where event_payload ->> 'shipment_id' in (select pg_temp.mu(n)::text from generate_series(9401, 9409) as n)) || '|' ||
    (select count(*) from public.admin_audit_logs
     where target_id in (select pg_temp.mu(n) from generate_series(9401, 9409) as n))
$$;

-- Admin 9410, buyer 9419, seller 9411 rejected by Stripe. Shipment n belongs to order n + 100.
select pg_temp.money_user(9410, 'admin');
select pg_temp.money_user(9411);
select pg_temp.money_user(9419);
update public.profiles_private set stripe_account_id = 'acct_test_9411', stripe_onboarding_status = 'rejected'
where id = pg_temp.mu(9411);
select pg_temp.money_shipment(n + 100, n, 9411, 9419) from generate_series(9401, 9409) as n;
update public.shipments set status = 'completed', completed_at = now() - interval '40 days', shipping_cost_cents = 1000,
  label_provider_cost_cents = 15000
where id in (select pg_temp.mu(n) from generate_series(9401, 9407) as n) or id = pg_temp.mu(9409);
update public.orders set actual_stripe_fee_cents = 3500, stripe_fee_reconciled_at = now()
where id in (select pg_temp.mu(n) from generate_series(9501, 9509) as n);

select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 9401: started, Stripe had no refund past the window, recovery escalated.
-- 9402: started, not escalated. 9403: escalated, then its refund was found and recorded.
-- 9404: escalated and resolved by hand.
select pg_temp.started(n) from generate_series(9401, 9404) as n;
select public.fn_escalate_shipment_cancellation(pg_temp.mu(n), 'refund_not_found') from unnest(array[9401, 9403, 9404]) as n;
select pg_temp.rec(9403, 're_test_9403', 'pending');
-- An escalated operation is older than Stripe's idempotency window: its claim lease expired long ago.
update public.shipment_cancellation_operations set claim_expires_at = now() - interval '1 day'
where shipment_id in (select pg_temp.mu(n) from generate_series(9401, 9404) as n);
update public.shipment_cancellation_operations
set refund_resolved_at = now(), refund_resolved_by = pg_temp.mu(9410), refund_resolution_reference = 'SPEI 0000'
where shipment_id = pg_temp.mu(9404);
-- 9408: a buyer cancellation of a paid shipment that started its refund.
update public.shipments set status = 'paid', delivered_at = null where id = pg_temp.mu(9408);
insert into public.shipment_cancellation_operations (shipment_id, order_id, source, actor_id, reason, claim_token,
    claim_expires_at, external_started_at, refund_request, cancellation_loss_cents, recovery_escalated_at,
    recovery_escalation_reason)
values (pg_temp.mu(9408), pg_temp.mu(9508), 'buyer', pg_temp.mu(9419), 'Changed my mind',
  'f0000000-0000-4000-8000-000000094408', now() - interval '2 days', now() - interval '2 days',
  jsonb_build_object('payment_intent', 'pi_test_9508', 'amount', 11000), 300, now() - interval '1 day', 'refund_not_found');

-- 1. A succeeded overdue refund that Stripe later fails. --------------------------------
-- 9405: refunded through a succeeded refund, then Stripe reports it failed.
select pg_temp.started(9405);
select pg_temp.rec(9405, 're_test_9405', 'succeeded');
select public.fn_complete_overdue_payout_refund(pg_temp.mu(9405));
create temporary table refunded_9405 as
  select (select cancellation_loss_cents from public.orders where id = pg_temp.mu(9505)) as loss,
         pg_temp.notices(9405, 'shipment.refunded') as refunded_notices;
set local role service_role;
create temporary table failed_9405 as select pg_temp.apply(9405, 're_test_9405', 'failed') as value;
reset role;
select is((select value ->> 'refund_status' from failed_9405), 'failed', 'the event records the failed refund');
select is((select status::text from public.shipments where id = pg_temp.mu(9405)) || ':'
    || (select status::text from public.orders where id = pg_temp.mu(9505)),
  'refunded:refunded', 'the failure never reopens the refunded shipment or its order');
select is((select cancellation_loss_cents from public.orders where id = pg_temp.mu(9505)), (select loss from refunded_9405),
  'the failure counts no second loss');
select is(pg_temp.notices(9405, 'shipment.refunded') || ':' || pg_temp.notices(9405, 'shipment.refund_failed'), '1:1',
  'the buyer keeps one refund notice and is told the refund failed once');
select is(pg_temp.apply(9405, 're_test_9405', 'failed') ->> 'refund_status', 'failed', 'a redelivered failure is accepted');
select is(pg_temp.notices(9405, 'shipment.refund_failed'), 1::bigint, 'a redelivered failure sends no second notice');
select is((select kind || ':' || shipment_status from public.fn_list_shipment_refund_problems() where shipment_id = pg_temp.mu(9405)),
  'refund_failed:refunded', 'admins see the failed refund of the refunded shipment');

-- 9406: refunded through a succeeded refund that Stripe never failed. 9407: a
-- buyer cancellation whose refund failed on a shipment that reads refunded.
select pg_temp.started(9406);
select pg_temp.rec(9406, 're_test_9406', 'succeeded');
select public.fn_complete_overdue_payout_refund(pg_temp.mu(9406));
update public.shipments set status = 'refunded' where id = pg_temp.mu(9407);
insert into public.shipment_cancellation_operations (shipment_id, order_id, source, actor_id, reason, claim_token,
    claim_expires_at, external_started_at, refund_request, cancellation_loss_cents, refund_id, refund_status,
    refund_status_updated_at)
values (pg_temp.mu(9407), pg_temp.mu(9507), 'buyer', pg_temp.mu(9419), 'Changed my mind',
  'f0000000-0000-4000-8000-000000094407', now() - interval '1 day', now() - interval '1 day',
  jsonb_build_object('payment_intent', 'pi_test_9507', 'amount', 11000), 300, 're_test_9407', 'failed', now());
create temporary table before_resolution_refusals as select pg_temp.stored() as value;
select throws_ok($$select pg_temp.resolve(9410, 9406)$$, 'P0001', 'REFUND_NOT_RESOLVABLE',
  'a refunded shipment whose refund still succeeded cannot be repaid by hand');
select throws_ok($$select pg_temp.resolve(9410, 9407)$$, 'P0001', 'SHIPMENT_STATUS_UNEXPECTED: refunded',
  'a failed buyer cancellation refund of a refunded shipment is still refused');
select throws_ok($$select pg_temp.resolve(9419, 9405)$$, 'P0001', 'ADMIN_REQUIRED',
  'a user who is not an admin cannot record the manual repayment');
select is(pg_temp.stored(), (select value from before_resolution_refusals), 'refused resolutions leave every stored row unchanged');

create temporary table before_counts as
  select (select count(*) from public.admin_audit_logs where target_id = pg_temp.mu(9405)) as audits,
         (select count(*) from public.notifications where event_payload ->> 'shipment_id' = pg_temp.mu(9405)::text) as notices;
select is(pg_temp.resolve(9410, 9405, '  SPEI 4405  '),
  '{"resolved": true, "shipment_cancelled": false, "amount_owed_cents": 11000, "reference": "SPEI 4405"}'::jsonb,
  'an admin records the manual repayment of an overdue refund Stripe failed after it succeeded');
select is(
  (select row(o.refund_status, o.refund_resolved_by, o.refund_resolution_reference)::text
   from public.shipment_cancellation_operations o where o.shipment_id = pg_temp.mu(9405)),
  row('failed', pg_temp.mu(9410), 'SPEI 4405')::text, 'the operation records the admin and the reference');
select is(
  (select row(a.admin_id, a.details ->> 'refund_status', a.details ->> 'shipment_status_before',
     a.details ->> 'reference', (a.details ->> 'amount_owed_cents')::bigint)::text
   from public.admin_audit_logs a where a.action_type = 'SHIPMENT_REFUND_RESOLVED' and a.target_id = pg_temp.mu(9405)),
  row(pg_temp.mu(9410), 'failed', 'refunded', 'SPEI 4405', 11000)::text, 'the manual repayment is audited');
select is(
  (select count(*) from public.admin_audit_logs where target_id = pg_temp.mu(9405)) || ':'
    || (select count(*) from public.notifications where event_payload ->> 'shipment_id' = pg_temp.mu(9405)::text),
  ((select audits from before_counts) + 1) || ':' || (select notices from before_counts),
  'the resolution adds one audit row and no notice');
select is(
  (select status::text from public.shipments where id = pg_temp.mu(9405)) || ':'
    || (select cancellation_loss_cents from public.orders where id = pg_temp.mu(9505)) || ':'
    || pg_temp.notices(9405, 'shipment.refunded') || ':' || pg_temp.notices(9405, 'shipment.refund_failed') || ':'
    || (select label_cost_loss_cents from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(9405)),
  'refunded:' || (select loss from refunded_9405) || ':1:1:15000',
  'the shipment stays refunded with one loss, one refund notice and one failure notice');
select is((select count(*) from public.fn_list_shipment_refund_problems() where shipment_id = pg_temp.mu(9405)), 0::bigint,
  'the resolved refund leaves the admin problem list');

create temporary table after_resolution as select pg_temp.stored() as value;
select is(pg_temp.resolve(9410, 9405, 'SPEI 9999'),
  '{"resolved": false, "shipment_cancelled": false, "amount_owed_cents": 11000, "reference": "SPEI 4405"}'::jsonb,
  'a second resolution keeps the first reference');
select is(pg_temp.apply(9405, 're_test_9405', 'failed') ->> 'outcome', 'unchanged',
  'a redelivered failure after the resolution changes nothing');
select is(pg_temp.stored(), (select value from after_resolution),
  'a second resolution and a redelivered event write no row');

-- 2. The replay lease refuses what it must not serialize, and stores nothing. ---------
create temporary table before_lease_refusals as select pg_temp.stored() as value;
select throws_ok($$select pg_temp.lease(9999)$$, 'P0001', 'SHIPMENT_NOT_FOUND', 'an unknown shipment has no replay lease');
select throws_ok($$select pg_temp.lease(9409)$$, 'P0001', 'OVERDUE_REFUND_NOT_STARTED',
  'a shipment whose overdue refund never started has no replay lease');
select throws_ok($$select pg_temp.lease(9408)$$, 'P0001', 'OVERDUE_REFUND_NOT_STARTED',
  'a buyer cancellation never takes the overdue replay lease');
select throws_ok($$select pg_temp.lease(9402)$$, 'P0001', 'OVERDUE_REFUND_NOT_ESCALATED',
  'a refund still inside Stripe''s idempotency window is replayed with its key, never leased');
select is(pg_temp.lease(9403), '{"status": "busy"}'::jsonb,
  'an operation whose refund was recorded meanwhile is not replayed');
select is(pg_temp.lease(9404), '{"status": "busy"}'::jsonb,
  'an operation an admin resolved by hand is not replayed');
select is(pg_temp.stored(), (select value from before_lease_refusals), 'refused leases leave every stored row unchanged');

-- 3. One lease at a time. --------------------------------------------------------------
create temporary table lease_9401 as select pg_temp.lease(9401) as value, clock_timestamp() as taken_at;
select is((select value ->> 'status' from lease_9401), 'leased', 'the first retry takes the replay lease');
select ok((select (value ->> 'lease_expires_at')::timestamptz between taken_at + interval '9 minutes'
    and taken_at + interval '11 minutes' from lease_9401),
  'the lease outlives any Edge Function run (10 minutes)');
select is(
  (select claim_expires_at from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(9401)),
  (select (value ->> 'lease_expires_at')::timestamptz from lease_9401),
  'the operation stores the lease expiry');
create temporary table leased_9401 as select pg_temp.stored() as value;
select is(pg_temp.lease(9401), '{"status": "busy"}'::jsonb, 'a concurrent retry finds the lease taken');
select is(pg_temp.stored(), (select value from leased_9401), 'a busy lease changes nothing');
select is(pg_temp.claim(9401) ->> 'status', 'recovery_required', 'the lease never turns the started refund into a new claim');
select throws_ok(format('select public.fn_start_shipment_cancellation_refund(%L, %L, %L::jsonb, 300)', pg_temp.mu(9401),
    (select claim_token from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(9401)), pg_temp.request(9401)),
  'P0001', 'CANCELLATION_EXTERNAL_ALREADY_STARTED', 'the lease token never authorizes a second start');
update public.shipment_cancellation_operations set claim_expires_at = clock_timestamp() - interval '1 second'
where shipment_id = pg_temp.mu(9401);
create temporary table relet_9401 as select pg_temp.lease(9401) as value;
select is((select value ->> 'status' from relet_9401), 'leased', 'an expired lease is taken again by the next retry');
select is(pg_temp.lease(9401), '{"status": "busy"}'::jsonb, 'the renewed lease is exclusive again');
select is(
  (select external_started_at is not null and refund_id is null and recovery_escalated_at is not null
   from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(9401)),
  true, 'the lease keeps the write-ahead fence and the escalation as they were');

-- 4. Grants. ------------------------------------------------------------------------------
select is(
  (select has_function_privilege('anon', p.oid, 'execute') || ':' || has_function_privilege('authenticated', p.oid, 'execute')
     || ':' || has_function_privilege('service_role', p.oid, 'execute') || ':' || p.prosecdef || ':'
     || array_to_string(p.proconfig, ',')
   from pg_proc p where p.oid = 'public.fn_lease_overdue_refund_replay(uuid)'::regprocedure),
  'false:false:true:true:search_path=""',
  'only service_role takes the replay lease, which runs as definer with an empty search_path');
select set_config('request.jwt.claims', '{"sub": "' || pg_temp.mu(9410) || '", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select pg_temp.lease(9401)$$, '42501', null, 'not even an admin session takes the replay lease directly');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select pg_temp.lease(9401)$$, '42501', null, 'anon cannot take the replay lease');
reset role;

select * from finish();
rollback;
