-- Overdue payout refund (#549 Part B, odd/tasks/held-payout-overdue-refund.md
-- T2, S3): an active admin refunds the buyer of a completed shipment whose
-- payout is overdue, only when the seller's account was rejected and no
-- transfer was ever started. fn_claim_overdue_payout_refund claims the
-- shipment's cancellation operation with source admin_overdue_payout, so the
-- fence fn_begin_shipment_transfer checks blocks any transfer from then on; the
-- start and record RPCs freeze and record the Stripe refund as for a
-- cancellation; fn_complete_overdue_payout_refund (directly, or through
-- fn_apply_shipment_cancellation_refund_event) moves the shipment to refunded
-- only after the refund succeeded, records the loss and closes the payout run
-- mapping that never transferred.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(88);
\ir ../fixtures/money.psql

create function pg_temp.complete(p_shipment integer, p_ago interval, p_label_cost bigint default 15000)
returns void language sql as $$
  update public.shipments set status = 'completed', completed_at = now() - p_ago, shipping_cost_cents = 1000,
    label_provider_cost_cents = p_label_cost
  where id = pg_temp.mu(p_shipment)
$$;
create function pg_temp.connect_seller(p_seller integer, p_status public.stripe_onboarding_status default 'rejected')
returns void language sql as $$
  update public.profiles_private set stripe_account_id = 'acct_test_' || p_seller, stripe_onboarding_status = p_status
  where id = pg_temp.mu(p_seller)
$$;
-- A run of p_seller over p_shipments parked by the executor because the
-- account was not actionable: the run needs attention, its mappings stay pending.
create function pg_temp.parked_run(p_run integer, p_seller integer, p_shipments integer[])
returns void language plpgsql as $$
begin
  perform pg_temp.money_payout_run(p_run, p_seller, 9010, p_shipments, 'pending_reconciliation', 'action_required');
  update public.connect_payout_runs
  set status = 'reconciliation_needed', action_required_reason = 'account_not_actionable',
      last_error = 'account_not_actionable: rejected.other'
  where id = pg_temp.mu(p_run);
end $$;
create function pg_temp.claim(p_admin integer, p_shipment integer) returns jsonb language sql as $$
  select public.fn_claim_overdue_payout_refund(pg_temp.mu(p_admin), pg_temp.mu(p_shipment))
$$;
-- The refund request the Edge Function freezes: 11000 cents, caller_role admin.
create function pg_temp.request(p_shipment integer, p_caller_role text default 'admin') returns jsonb language sql as $$
  select jsonb_build_object('payment_intent', s.stripe_payment_intent_id, 'amount', 11000,
    'reason', 'requested_by_customer',
    'metadata', jsonb_build_object('shipment_id', s.id::text, 'order_id', s.order_id::text,
      'caller_role', p_caller_role, 'reason', 'overdue_payout_seller_rejected', 'seguro_share_cents', 1000))
  from public.shipments s where s.id = pg_temp.mu(p_shipment)
$$;
create function pg_temp.start(p_shipment integer, p_claim jsonb, p_loss bigint default 300,
  p_caller_role text default 'admin')
returns jsonb language sql as $$
  select public.fn_start_shipment_cancellation_refund(pg_temp.mu(p_shipment), (p_claim ->> 'claim_token')::uuid,
    pg_temp.request(p_shipment, p_caller_role), p_loss)
$$;
create function pg_temp.rec(p_shipment integer, p_refund text, p_status text) returns jsonb language sql as $$
  select public.fn_record_shipment_cancellation_refund(pg_temp.mu(p_shipment), p_refund,
    (select stripe_payment_intent_id from public.shipments where id = pg_temp.mu(p_shipment)), 11000, p_status)
$$;
create function pg_temp.apply(p_shipment integer, p_refund text, p_status text) returns jsonb language sql as $$
  select public.fn_apply_shipment_cancellation_refund_event(pg_temp.mu(p_shipment), p_refund,
    (select stripe_payment_intent_id from public.shipments where id = pg_temp.mu(p_shipment)), 11000, p_status,
    case when p_status = 'failed' then 'expired_or_canceled_card' end)
$$;
create function pg_temp.finish(p_shipment integer) returns jsonb language sql as $$
  select public.fn_complete_overdue_payout_refund(pg_temp.mu(p_shipment))
$$;
create function pg_temp.status(p_shipment integer) returns text language sql as $$
  select status::text from public.shipments where id = pg_temp.mu(p_shipment)
$$;
create function pg_temp.notices(p_shipment integer, p_kind text) returns bigint language sql as $$
  select count(*) from public.notifications
  where event_kind = p_kind and event_payload ->> 'shipment_id' = pg_temp.mu(p_shipment)::text
$$;
create function pg_temp.mapping(p_run integer, p_shipment integer) returns text language sql as $$
  select status from public.connect_payout_run_shipments
  where run_id = pg_temp.mu(p_run) and shipment_id = pg_temp.mu(p_shipment)
$$;
create function pg_temp.run(p_run integer) returns text language sql as $$
  select status || ':' || coalesce(release_stage, '-') || ':' || coalesce(action_required_reason, '-')
    || ':' || coalesce(failure_reason, '-')
  from public.connect_payout_runs where id = pg_temp.mu(p_run)
$$;
create function pg_temp.q(p_search text, p_bucket text) returns jsonb language sql as $$
  select public.fn_get_admin_payout_queue(p_search, p_bucket, 0, 'page')
$$;
-- Everything a refused claim, start or completion must leave as it was: the
-- shipments, their operations, runs, mappings, notifications and audit rows.
create function pg_temp.stored() returns text language sql as $$
  select (select string_agg(s.id::text || ':' || s.status || ':' || coalesce(o.source, '-') || ':'
      || coalesce(o.actor_id::text, '-') || ':' || coalesce(o.claim_token::text, '-') || ':'
      || coalesce(o.claim_expires_at::text, '-') || ':' || coalesce(o.external_started_at::text, '-') || ':'
      || coalesce(o.refund_status, '-') || ':' || coalesce(o.label_cost_loss_cents::text, '-'),
      ',' order by s.id)
    from public.shipments s left join public.shipment_cancellation_operations o on o.shipment_id = s.id
    where s.id in (select pg_temp.mu(n) from generate_series(9101, 9117) as n)) || '|' ||
    (select string_agg(r.id::text || ':' || r.status || ':' || coalesce(r.action_required_reason, '-')
      || ':' || r.release_stage_version, ',' order by r.id)
     from public.connect_payout_runs r where r.seller_id in (select pg_temp.mu(n) from generate_series(9011, 9015) as n)) || '|' ||
    (select string_agg(m.id::text || ':' || m.status, ',' order by m.id) from public.connect_payout_run_shipments m
     where m.shipment_id in (select pg_temp.mu(n) from generate_series(9101, 9117) as n)) || '|' ||
    (select count(*) from public.notifications
     where event_payload ->> 'shipment_id' in (select pg_temp.mu(n)::text from generate_series(9101, 9117) as n)) || '|' ||
    (select count(*) from public.admin_audit_logs where action_type = 'OVERDUE_PAYOUT_REFUND_CLAIMED') || '|' ||
    (select string_agg(coalesce(o.cancellation_loss_cents::text, '-'), ',' order by o.id) from public.orders o
     where o.id in (select pg_temp.mu(n) from generate_series(9201, 9217) as n))
$$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

-- Admin 9010, suspended admin 9018, buyer 9019. Sellers 9011, 9013, 9014 and
-- 9015 were rejected by Stripe; 9012 finished onboarding but Stripe disabled
-- its payouts. Shipment n belongs to order n + 100.
select pg_temp.money_user(9010, 'admin');
select pg_temp.money_user(9018, 'admin');
update public.profiles_private set status = 'suspended' where id = pg_temp.mu(9018);
select pg_temp.money_user(n) from generate_series(9011, 9015) as n;
select pg_temp.money_user(9019);
select pg_temp.connect_seller(9011);
select pg_temp.connect_seller(9012, 'complete');
select pg_temp.connect_seller(n) from generate_series(9013, 9015) as n;
insert into internal.connect_account_actionability (stripe_account_id, is_actionable, blocked_reason, stripe_created)
values ('acct_test_9012', false, 'payouts_disabled', now());

select pg_temp.money_shipment(n + 100, n, case n when 9103 then 9012 else 9011 end, 9019) from generate_series(9101, 9108) as n;
select pg_temp.money_shipment(9209, 9109, 9014, 9019);
select pg_temp.money_shipment(n + 100, n, 9013, 9019) from generate_series(9110, 9111) as n;
select pg_temp.money_shipment(n + 100, n, 9011, 9019) from generate_series(9112, 9116) as n;
select pg_temp.money_shipment(9217, 9117, 9015, 9019);
select pg_temp.complete(n, '40 days') from generate_series(9101, 9117) as n;
select pg_temp.complete(9102, '10 days');
update public.shipments set status = 'delivered', completed_at = null where id = pg_temp.mu(9104);
-- Stripe's actual fee of every order, reconciled from its balance transaction.
update public.orders set actual_stripe_fee_cents = 3500, stripe_fee_reconciled_at = now()
where id in (select pg_temp.mu(n) from generate_series(9201, 9217) as n);
-- 9105: a transfer was started in a run whose payout later failed.
select pg_temp.money_payout_run(9305, 9011, 9010, array[9105], 'failed');
update public.connect_payout_run_shipments set transfer_started_at = now() - interval '35 days', transfer_token = gen_random_uuid()
where run_id = pg_temp.mu(9305);
update public.shipments set stripe_transfer_id = 'tr_test_9106' where id = pg_temp.mu(9106);
update public.shipments set stripe_payout_id = 'po_test_9116' where id = pg_temp.mu(9116);
-- 9107: a buyer cancellation still holds a live claim; 9108: an expired one that never started.
insert into public.shipment_cancellation_operations (shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at)
values (pg_temp.mu(9107), pg_temp.mu(9207), 'buyer', pg_temp.mu(9019), 'Changed my mind',
    'f0000000-0000-4000-8000-000000097107', now() + interval '10 minutes'),
  (pg_temp.mu(9108), pg_temp.mu(9208), 'buyer', pg_temp.mu(9019), 'Changed my mind',
    'f0000000-0000-4000-8000-000000097108', now() - interval '1 day');
-- Parked runs: 9109 alone, 9110 with 9111, 9113 alone. 9112 sits in a run the executor has not parked.
select pg_temp.parked_run(9309, 9014, array[9109]);
select pg_temp.parked_run(9310, 9013, array[9110, 9111]);
select pg_temp.parked_run(9313, 9011, array[9113]);
select pg_temp.money_payout_run(9312, 9011, 9010, array[9112], 'pending_reconciliation', 'release_accepted');

-- The RPCs check the service_role claim; the assertions read tables only the
-- owner can, so the file runs as the owner and proves the grants at the end
-- (section 12) and one webhook call as service_role (section 9).
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 1. The claim refuses, and stores nothing. ---------------------------------------
create temporary table before_refusals as select pg_temp.stored() as value;
select throws_ok($$select pg_temp.claim(9019, 9101)$$, 'P0001', 'ADMIN_REQUIRED', 'a user who is not an admin cannot claim the refund');
select throws_ok($$select pg_temp.claim(9018, 9101)$$, 'P0001', 'ADMIN_REQUIRED', 'a suspended admin cannot claim the refund');
select throws_ok(format('select public.fn_claim_overdue_payout_refund(null, %L)', pg_temp.mu(9101)),
  'P0001', 'ADMIN_REQUIRED', 'a missing admin cannot claim the refund');
select throws_ok($$select pg_temp.claim(9010, 9999)$$, 'P0001', 'SHIPMENT_NOT_FOUND', 'an unknown shipment cannot be claimed');
select throws_ok($$select pg_temp.claim(9010, 9104)$$, 'P0001', 'SHIPMENT_NOT_COMPLETED', 'a shipment that is not completed cannot be claimed');
select throws_ok($$select pg_temp.claim(9010, 9102)$$, 'P0001', 'PAYOUT_NOT_OVERDUE', 'a payout that is not overdue cannot be refunded');
select throws_ok($$select pg_temp.claim(9010, 9103)$$, 'P0001', 'SELLER_ACCOUNT_NOT_REJECTED',
  'an overdue payout of a seller Stripe did not reject cannot be refunded');
select throws_ok($$select pg_temp.claim(9010, 9105)$$, 'P0001', 'SHIPMENT_TRANSFER_OPERATION_ACTIVE',
  'a shipment whose transfer was ever started cannot be refunded');
select throws_ok($$select pg_temp.claim(9010, 9106)$$, 'P0001', 'SHIPMENT_FUNDS_ALREADY_RELEASED',
  'a shipment with a Stripe transfer cannot be refunded');
select throws_ok($$select pg_temp.claim(9010, 9116)$$, 'P0001', 'SHIPMENT_FUNDS_ALREADY_RELEASED',
  'a shipment with a Stripe payout cannot be refunded');
select throws_ok($$select pg_temp.claim(9010, 9107)$$, 'P0001', 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
  'a shipment whose other cancellation operation is active cannot be claimed');
select throws_ok($$select pg_temp.claim(9010, 9112)$$, 'P0001', 'PAYOUT_RUN_NOT_PARKED',
  'a shipment inside a run the executor has not parked cannot be claimed');
select is(pg_temp.stored(), (select value from before_refusals), 'refused claims leave every stored row unchanged');

-- 2. Buyer, seller and timeout cancellations still refuse a completed shipment. ---
select throws_ok(
  format('select public.fn_claim_shipment_cancellation(%L, %L, %L, %L, %L)', pg_temp.mu(9101), pg_temp.mu(9201),
    pg_temp.mu(9019), 'buyer', 'Changed my mind'),
  'P0001', 'SHIPMENT_NOT_CANCELABLE', 'a buyer cannot cancel a completed shipment');
select throws_ok(
  format('select public.fn_claim_shipment_cancellation(%L, %L, %L, %L, %L)', pg_temp.mu(9101), pg_temp.mu(9201),
    pg_temp.mu(9011), 'seller', 'No stock'),
  'P0001', 'SHIPMENT_NOT_CANCELABLE', 'a seller cannot cancel a completed shipment');
select throws_ok(
  format('select public.fn_claim_shipment_cancellation(%L, %L, null, %L, %L)', pg_temp.mu(9101), pg_temp.mu(9201),
    'paid_timeout', 'Timeout'),
  'P0001', 'SHIPMENT_NOT_CANCELABLE', 'a timeout cannot cancel a completed shipment');
select throws_ok(
  format('select public.fn_claim_shipment_cancellation(%L, %L, %L, %L, %L)', pg_temp.mu(9101), pg_temp.mu(9201),
    pg_temp.mu(9010), 'admin_overdue_payout', 'x'),
  'P0001', 'INVALID_CANCELLATION_CONTEXT', 'the generic claim does not accept the overdue refund source');
select throws_ok(
  format('select public.fn_start_shipment_cancellation_refund(%L, %L, %L::jsonb, 0)', pg_temp.mu(9107),
    'f0000000-0000-4000-8000-000000097107', pg_temp.request(9107, 'buyer')),
  'P0001', 'SHIPMENT_NOT_CANCELABLE', 'a live buyer operation cannot start a refund of a completed shipment');
select is((select row(c.success, c.error_message)::text from public.fn_cancel_shipment(pg_temp.mu(9101), 'buyer', 'x') c),
  '(f,CANNOT_CANCEL_IN_THIS_STATUS)', 'fn_cancel_shipment still refuses a completed shipment');
select is(pg_temp.stored(), (select value from before_refusals), 'the refused cancellations leave every stored row unchanged');

-- 3. The claim. ------------------------------------------------------------------
create temporary table claim_9101 as select pg_temp.claim(9010, 9101) as value;
select is((select value - 'claim_token' - 'claim_expires_at' from claim_9101),
  jsonb_build_object('status', 'claimed', 'operation_key', 'cancel_shipment_' || pg_temp.mu(9101),
    'source', 'admin_overdue_payout', 'actor_id', pg_temp.mu(9010), 'reason', 'overdue_payout_seller_rejected',
    'shipment_id', pg_temp.mu(9101), 'order_id', pg_temp.mu(9201), 'payment_intent_id', 'pi_test_9201'),
  'an admin claims the refund and gets the operation, its payment intent, order and shipment');
select ok((select (value ->> 'claim_token') is not null and (value ->> 'claim_expires_at')::timestamptz > now() from claim_9101),
  'the claim carries a token and a live lease');
select is(
  (select row(o.source, o.actor_id, o.claim_token::text, o.external_started_at)::text
   from public.shipment_cancellation_operations o where o.shipment_id = pg_temp.mu(9101)),
  (select row('admin_overdue_payout', pg_temp.mu(9010), value ->> 'claim_token', null::timestamptz)::text from claim_9101),
  'the operation records the admin who claimed it');
select is(
  (select row(a.admin_id, a.details ->> 'operation_key', a.details ->> 'seller_payout_block_reason',
     (a.details ->> 'days_since_completed')::integer)::text
   from public.admin_audit_logs a where a.action_type = 'OVERDUE_PAYOUT_REFUND_CLAIMED' and a.target_id = pg_temp.mu(9101)),
  row(pg_temp.mu(9010), 'cancel_shipment_' || pg_temp.mu(9101), 'onboarding_rejected', 40)::text,
  'the claim is audited with the admin, the operation, the block reason and the days held');
select is(pg_temp.claim(9010, 9101) ->> 'status', 'busy', 'a second claim during the lease is busy');
select is(
  (select count(*) from public.admin_audit_logs where action_type = 'OVERDUE_PAYOUT_REFUND_CLAIMED' and target_id = pg_temp.mu(9101)),
  1::bigint, 'a busy claim writes no audit row');
select throws_ok(
  format('select public.fn_claim_shipment_cancellation(%L, %L, %L, %L, %L)', pg_temp.mu(9101), pg_temp.mu(9201),
    pg_temp.mu(9019), 'buyer', 'Changed my mind'),
  'P0001', 'SHIPMENT_NOT_CANCELABLE', 'a buyer still cannot cancel the claimed shipment');

-- An expired buyer claim that never started is taken over by the admin.
create temporary table claim_9108 as select pg_temp.claim(9010, 9108) as value;
select is(
  (select row(c ->> 'status', c ->> 'source', c ->> 'actor_id', c ->> 'claim_token' <> 'f0000000-0000-4000-8000-000000097108')::text
   from claim_9108 t, lateral (select t.value) x(c)),
  row('claimed', 'admin_overdue_payout', pg_temp.mu(9010)::text, true)::text,
  'an expired buyer operation that never started is re-owned by the admin with a new token');
select is(
  (select row(source, actor_id, reason)::text from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(9108)),
  row('admin_overdue_payout', pg_temp.mu(9010), 'overdue_payout_seller_rejected')::text,
  'the re-owned operation keeps the admin source, actor and reason');

-- 4. Start and record. -----------------------------------------------------------
select throws_ok(format('select pg_temp.start(9108, %L::jsonb, 300, %L)', (select value from claim_9108), 'system'),
  'P0001', 'INVALID_CANCELLATION_REFUND_REQUEST', 'the refund metadata names the admin as the caller');
select is(pg_temp.start(9108, (select value from claim_9108)) ->> 'cancellation_loss_cents', '300',
  'the admin starts the refund of a completed shipment with the frozen loss');

create temporary table before_start_9101 as select pg_temp.stored() as value;
select is(pg_temp.start(9101, (select value from claim_9101)) -> 'refund_request', pg_temp.request(9101),
  'the start freezes the refund request');
select ok((select external_started_at is not null from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(9101)),
  'the start sets the write-ahead fence');
select is(
  (select row(c ->> 'status', c ->> 'operation_key', c ->> 'source', c ->> 'shipment_id')::text from pg_temp.claim(9010, 9101) c),
  row('recovery_required', 'cancel_shipment_' || pg_temp.mu(9101), 'admin_overdue_payout', pg_temp.mu(9101)::text)::text,
  'a claim after the start asks for recovery');

-- 5. Completion waits for a succeeded refund. -------------------------------------
create temporary table before_finish as select pg_temp.stored() as value;
select throws_ok($$select pg_temp.finish(9101)$$, 'P0001', 'REFUND_NOT_SUCCEEDED',
  'the shipment is not refunded before Stripe recorded the refund');
select is(pg_temp.rec(9101, 're_test_9101', 'pending') ->> 'refund_status', 'pending', 'a pending refund is recorded');
select throws_ok($$select pg_temp.finish(9101)$$, 'P0001', 'REFUND_NOT_SUCCEEDED',
  'the shipment is not refunded while the refund is pending');
select is(pg_temp.status(9101), 'completed', 'the shipment stays completed while the refund is pending');
select is(pg_temp.notices(9101, 'shipment.refunded'), 0::bigint, 'the buyer is not told about a pending refund');
select throws_ok($$select pg_temp.finish(9102)$$, 'P0001', 'OVERDUE_REFUND_NOT_STARTED',
  'a shipment without a started overdue refund cannot be completed');
select throws_ok($$select pg_temp.finish(9107)$$, 'P0001', 'OVERDUE_REFUND_NOT_STARTED',
  'a buyer operation never completes through the overdue path');

-- 6. Completion after a succeeded refund. -----------------------------------------
select is(pg_temp.rec(9101, 're_test_9101', 'succeeded') ->> 'refund_status', 'succeeded', 'the refund succeeded');
create temporary table finished_9101 as select pg_temp.finish(9101) as value;
select is((select value from finished_9101),
  jsonb_build_object('shipment_id', pg_temp.mu(9101), 'order_id', pg_temp.mu(9201), 'shipment_status', 'refunded',
    'refund_id', 're_test_9101', 'refund_amount_cents', 11000, 'cancellation_loss_cents', 300,
    'label_cost_loss_cents', 15000),
  'the completion reports the refunded shipment and its losses');
select is(pg_temp.status(9101), 'refunded', 'the shipment is refunded');
select is((select status::text from public.orders where id = pg_temp.mu(9201)), 'refunded', 'the order status is derived from its shipments');
select is((select cancellation_loss_cents from public.orders where id = pg_temp.mu(9201)), 300::bigint,
  'the Stripe fee loss is recorded on the order as a cancellation records it');
select is((select label_cost_loss_cents from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(9101)),
  15000::bigint, 'the label Selene already paid is recorded as lost');
select is(
  (select row(n.user_id, n.type, n.title, n.action_path)::text from public.notifications n
   where n.event_kind = 'shipment.refunded' and n.event_payload ->> 'shipment_id' = pg_temp.mu(9101)::text),
  row(pg_temp.mu(9019), 'success', 'Te devolvimos tu dinero',
    '/profile/orders/' || pg_temp.mu(9201) || '?shipment_id=' || pg_temp.mu(9101))::text,
  'the buyer gets the refund notice');
select is(
  (select count(*) from public.notifications where event_payload ->> 'shipment_id' = pg_temp.mu(9101)::text),
  1::bigint, 'the seller gets no notice and the buyer only one');
select is(pg_temp.finish(9101), (select value from finished_9101), 'a second completion returns the same result');
select is(pg_temp.notices(9101, 'shipment.refunded'), 1::bigint, 'a second completion sends no second notice');
select is((select cancellation_loss_cents from public.orders where id = pg_temp.mu(9201)), 300::bigint,
  'a second completion records the loss once');
select throws_ok($$select pg_temp.claim(9010, 9101)$$, 'P0001', 'SHIPMENT_ALREADY_REFUNDED',
  'a refunded shipment cannot be claimed again');
select is((select row(c.success, c.error_message)::text from public.fn_cancel_shipment(pg_temp.mu(9101), 'buyer', 'x') c),
  '(f,CANNOT_CANCEL_IN_THIS_STATUS)', 'a refunded shipment cannot be cancelled');

-- 7. The fence: a claimed shipment is never transferred. ----------------------------
-- L6 (R3): a hold note on an overdue shipment inside a parked run.
select is((select n.shipment_id from public.fn_admin_record_payout_hold_note(pg_temp.mu(9010), pg_temp.mu(9113),
    'Cuenta rechazada, se evalúa reembolso') n), pg_temp.mu(9113),
  'an admin keeps an overdue shipment inside a parked run on hold with a note');
create temporary table claim_9113 as select pg_temp.claim(9010, 9113) as value;
select is((select value ->> 'status' from claim_9113), 'claimed', 'a shipment inside a parked run can be claimed');
-- The account update resumes the run between the claim and the start.
update public.connect_payout_runs
set status = 'pending_reconciliation', release_stage = 'awaiting_connected_balance', action_required_reason = null, last_error = null
where id = pg_temp.mu(9313);
select throws_ok(format('select public.fn_begin_shipment_transfer(%L, %L, 1)', pg_temp.mu(9313), pg_temp.mu(9113)),
  'P0001', 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE', 'a transfer cannot begin once the refund is claimed');
select lives_ok(format('select pg_temp.start(9113, %L::jsonb)', (select value from claim_9113)), 'the refund starts');
update public.shipment_cancellation_operations set claim_expires_at = now() - interval '1 hour'
where shipment_id = pg_temp.mu(9113);
select throws_ok(format('select public.fn_begin_shipment_transfer(%L, %L, 1)', pg_temp.mu(9313), pg_temp.mu(9113)),
  'P0001', 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE', 'a transfer cannot begin after the refund started, even once the lease expired');
select is(pg_temp.claim(9010, 9113) ->> 'status', 'recovery_required',
  'a started refund still recovers after its run resumed');
select is(
  (select count(*) from public.connect_payout_run_shipments where shipment_id = pg_temp.mu(9113) and transfer_started_at is not null),
  0::bigint, 'no transfer of the claimed shipment was started');

-- 8. A parked run that held only refunded shipments is closed and leaves "Necesita atención".
select is(pg_temp.q('money_9014', 'action-required') -> 'counts' ->> 'action-required', '1', 'the parked run needs attention');
create temporary table claim_9109 as select pg_temp.claim(9010, 9109) as value;
select lives_ok(format('select pg_temp.start(9109, %L::jsonb)', (select value from claim_9109)), 'the refund of the parked shipment starts');
select is(pg_temp.rec(9109, 're_test_9109', 'succeeded') ->> 'refund_status', 'succeeded', 'its refund succeeded');
select is(pg_temp.finish(9109) ->> 'shipment_status', 'refunded', 'the parked shipment is refunded');
select is(pg_temp.mapping(9309, 9109), 'canceled', 'its run mapping that never transferred is closed');
select is(pg_temp.run(9309), 'canceled:action_required:-:overdue_payout_refunded',
  'a run left with no open mapping is closed, so no account update resumes it');
select is(pg_temp.q('money_9014', 'history') -> 'counts',
  '{"ready": 0, "overdue": 0, "processing": 0, "action-required": 0, "history": 1}'::jsonb,
  'the closed run moves to the history');

-- 9. The webhook completes the refund; a run with another shipment stays for an admin.
create temporary table claim_9110 as select pg_temp.claim(9010, 9110) as value;
select lives_ok(format('select pg_temp.start(9110, %L::jsonb)', (select value from claim_9110)), 'the refund of 9110 starts');
set local role service_role;
select is(pg_temp.apply(9110, 're_test_9110', 'succeeded') ->> 'outcome', 'completed', 'the succeeded refund event completes the refund');
reset role;
select is(pg_temp.status(9110), 'refunded', 'the webhook refunds the completed shipment');
select is(pg_temp.notices(9110, 'shipment.refunded'), 1::bigint, 'the webhook path sends the buyer the refund notice');
select is(pg_temp.mapping(9310, 9110) || ':' || pg_temp.mapping(9310, 9111), 'canceled:pending_reconciliation',
  'only the refunded shipment''s mapping is closed');
select is(pg_temp.run(9310), 'reconciliation_needed:action_required:overdue_payout_refunded:-',
  'the run keeps its other shipment for an admin and is no longer resumed by an account update');
select is(pg_temp.apply(9110, 're_test_9110', 'succeeded') ->> 'outcome', 'unchanged', 'a redelivered event changes nothing');
select is(pg_temp.notices(9110, 'shipment.refunded'), 1::bigint, 'a redelivered event sends no second notice');

-- 10. A failed refund leaves the shipment completed and the problem visible.
create temporary table claim_9114 as select pg_temp.claim(9010, 9114) as value;
select lives_ok(format('select pg_temp.start(9114, %L::jsonb)', (select value from claim_9114)), 'the refund of 9114 starts');
select is(pg_temp.apply(9114, 're_test_9114', 'failed') ->> 'outcome', 'failed_before_cancellation',
  'a failed refund event is reported');
select throws_ok($$select pg_temp.finish(9114)$$, 'P0001', 'REFUND_NOT_SUCCEEDED', 'a failed refund never refunds the shipment');
select is(pg_temp.status(9114) || ':' || pg_temp.notices(9114, 'shipment.refund_failed'), 'completed:1',
  'the shipment stays completed and the buyer is told the refund failed');
select is((select kind from public.fn_list_shipment_refund_problems() where shipment_id = pg_temp.mu(9114)), 'refund_failed',
  'admins see the failed refund');

-- 11. The start checks the seller again.
create temporary table claim_9117 as select pg_temp.claim(9010, 9117) as value;
update public.profiles_private set stripe_onboarding_status = 'complete' where id = pg_temp.mu(9015);
select throws_ok(format('select pg_temp.start(9117, %L::jsonb)', (select value from claim_9117)),
  'P0001', 'SELLER_ACCOUNT_NOT_REJECTED', 'the refund does not start once the seller account is no longer rejected');
select is((select external_started_at from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(9117)),
  null, 'a refused start leaves the fence unset');

-- 12. Grants. ----------------------------------------------------------------------
select is(
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')
     || ':' || has_function_privilege('authenticated', p.oid, 'execute')
     || ':' || has_function_privilege('service_role', p.oid, 'execute')
     || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_claim_overdue_payout_refund', 'fn_complete_overdue_payout_refund')),
  'fn_claim_overdue_payout_refund:false:false:true:true:search_path="" '
    || 'fn_complete_overdue_payout_refund:false:false:true:true:search_path=""',
  'only service_role executes the overdue refund RPCs, which run as definer with an empty search_path');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select pg_temp.claim(9010, 9111)$$, '42501', null, 'anon cannot claim an overdue refund');
select throws_ok($$select pg_temp.finish(9111)$$, '42501', null, 'anon cannot complete an overdue refund');
reset role;
select set_config('request.jwt.claims', '{"sub": "' || pg_temp.mu(9010) || '", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select pg_temp.claim(9010, 9111)$$, '42501', null, 'not even an admin session claims an overdue refund directly');
select throws_ok($$select pg_temp.finish(9111)$$, '42501', null, 'not even an admin session completes an overdue refund directly');
reset role;

select * from finish();
rollback;
