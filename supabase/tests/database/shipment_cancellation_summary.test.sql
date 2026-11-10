-- What the participants of a shipment cancellation see (#276 T4):
-- fn_get_shipment_cancellation_summary gives the buyer (from the order on the
-- operation) and the seller only the source and a coarse refund state, and
-- nobody else a row; fn_cancel_shipment writes one shipment.cancelled notice
-- per participant, once.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(25);
\ir ../fixtures/money.psql

-- Users: 9001 buyer, 9002 seller, 9003 another user, 9004 admin, 9005 co-seller, 9006 another buyer.
select pg_temp.money_user(9001);
select pg_temp.money_user(9002);
select pg_temp.money_user(9003);
select pg_temp.money_user(9004, 'admin');
select pg_temp.money_user(9005);
select pg_temp.money_user(9006);

-- A started cancellation operation of p_ship with p_source; buyer and seller sources carry their actor.
create function pg_temp.op_ins(p_ship integer, p_source text) returns void language sql as $$
  insert into public.shipment_cancellation_operations (
    shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at, external_started_at
  )
  select s.id, s.order_id, p_source,
    case p_source when 'buyer' then o.buyer_id when 'seller' then s.seller_id end,
    'summary test', gen_random_uuid(), now() + interval '15 minutes', now()
  from public.shipments s join public.orders o on o.id = s.order_id
  where s.id = pg_temp.mu(p_ship)
$$;

-- Records a Stripe refund status on the operation of p_ship.
create function pg_temp.refund(p_ship integer, p_status text) returns void language sql as $$
  update public.shipment_cancellation_operations
  set refund_id = 're_test_' || p_ship, refund_status = p_status, refund_status_updated_at = '2026-11-01 12:00:00+00'
  where shipment_id = pg_temp.mu(p_ship)
$$;

-- The summary rows p_user gets for p_ship as source|state|updated_at; a NULL
-- user calls with service_role claims and no sub.
create function pg_temp.summ(p_user integer, p_ship integer) returns text language plpgsql as $$
declare
  v text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '{"role": "service_role"}'
    else json_build_object('sub', pg_temp.mu(p_user), 'role', 'authenticated')::text end, true);
  select coalesce(string_agg(s.source || '|' || s.refund_state || '|' || coalesce(s.refund_updated_at::text, '-'), ','), '')
  into v from public.fn_get_shipment_cancellation_summary(pg_temp.mu(p_ship)) s;
  return v;
end $$;

create function pg_temp.grants(p_sig text) returns text language sql as $$
  select string_agg(r || ':' || has_function_privilege(r, p_sig, 'execute'), ' ' order by r)
  from unnest(array['anon', 'authenticated', 'service_role']) r
$$;

-- 1. Grants and catalog ------------------------------------------------------------------
select is(pg_temp.grants('public.fn_get_shipment_cancellation_summary(uuid)'),
  'anon:false authenticated:true service_role:true', 'summary: signed-in users can execute it and anon cannot');
select is(
  (select p.prosecdef || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') || ':' || pg_get_function_result(p.oid)
   from pg_proc p where p.oid = 'public.fn_get_shipment_cancellation_summary(uuid)'::regprocedure),
  'true:s:search_path="":TABLE(source text, refund_state text, refund_updated_at timestamp with time zone)',
  'summary: SECURITY DEFINER, STABLE, empty search_path, and only source, refund_state and refund_updated_at');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select * from public.fn_get_shipment_cancellation_summary(gen_random_uuid())$$,
  '42501', null, 'summary: anon gets permission denied');
reset role;

-- Fixtures: one order per shipment, buyer 9001 and seller 9002, except where noted.
select pg_temp.money_shipment(9200 + n, 9100 + n, 9002, 9001, 'paid') from generate_series(1, 12) n;
-- 9113: another seller's shipment in the order of 9101.
select pg_temp.money_shipment(9201, 9113, 9005, 9001, 'paid');
-- 9114 belongs to an order of 9001, but its operation records the order of 9115 (buyer 9006).
select pg_temp.money_shipment(9214, 9114, 9002, 9001, 'paid');
select pg_temp.money_shipment(9215, 9115, 9002, 9006, 'paid');

select pg_temp.op_ins(9101, 'buyer');
select pg_temp.op_ins(9102, 'seller');
select pg_temp.refund(9102, 'pending');
select pg_temp.op_ins(9103, 'paid_timeout');
select pg_temp.refund(9103, 'requires_action');
select pg_temp.op_ins(n, 'preparing_timeout') from unnest(array[9104, 9110, 9111]) n;
update public.shipment_cancellation_operations
set review_reason = 'tracking_unknown', review_required_at = now()
where shipment_id in (pg_temp.mu(9104), pg_temp.mu(9110), pg_temp.mu(9111));
update public.shipment_cancellation_operations
set review_resolution = case when shipment_id = pg_temp.mu(9104) then 'refund_approved' else 'closed_no_refund' end,
  review_resolved_at = now(), review_resolved_by = pg_temp.mu(9004), review_resolution_note = 'checked'
where shipment_id in (pg_temp.mu(9104), pg_temp.mu(9111));
select pg_temp.op_ins(n, 'paid_timeout') from unnest(array[9105, 9106, 9107, 9108, 9109]) n;
select pg_temp.refund(9105, 'succeeded');
select pg_temp.refund(n, 'failed') from unnest(array[9106, 9107]) n;
select pg_temp.refund(9108, 'canceled');
update public.shipment_cancellation_operations
set refund_resolved_at = now(), refund_resolved_by = pg_temp.mu(9004), refund_resolution_reference = 'SPEI-9106'
where shipment_id = pg_temp.mu(9106);
update public.shipment_cancellation_operations
set recovery_escalated_at = now(), recovery_escalation_reason = 'refund_not_found'
where shipment_id = pg_temp.mu(9109);
select pg_temp.op_ins(9114, 'paid_timeout');
update public.shipment_cancellation_operations set order_id = pg_temp.mu(9215) where shipment_id = pg_temp.mu(9114);

-- 2. Who gets a row ---------------------------------------------------------------------------
set local role authenticated;
select is(pg_temp.summ(9001, 9101), 'buyer|processing|-', 'summary: the buyer gets one row');
select is(pg_temp.summ(9002, 9101), 'buyer|processing|-', 'summary: the seller gets the same row');
select is(pg_temp.summ(9003, 9101) || ',' || pg_temp.summ(9001, 9199) || ',' || pg_temp.summ(9001, 9112), ',,',
  'summary: another signed-in user, an unknown shipment and a shipment without an operation get zero rows');
select is(pg_temp.summ(9005, 9101) || ',' || pg_temp.summ(9004, 9101), ',',
  'summary: a co-seller of the same order and a non-participant admin get zero rows');
select is(pg_temp.summ(9006, 9114) || ',' || pg_temp.summ(9001, 9114), 'paid_timeout|processing|-,',
  'summary: the buyer comes from the order recorded on the operation, not the shipment''s current order');
reset role;
select is(pg_temp.summ(null, 9101), '', 'summary: the service role gets zero rows (no auth.uid())');

-- 3. Source and refund state --------------------------------------------------------------------
select is(pg_temp.summ(9002, 9101) || ' ' || pg_temp.summ(9002, 9102) || ' ' || pg_temp.summ(9002, 9103) || ' ' || pg_temp.summ(9002, 9104),
  'buyer|processing|- seller|processing|2026-11-01 12:00:00+00 paid_timeout|processing|2026-11-01 12:00:00+00 preparing_timeout|processing|-',
  'summary: processing with no refund, pending, requires_action and approved-after-review without a refund; source verbatim; refund time from the refund status');
select is(pg_temp.summ(9002, 9105), 'paid_timeout|refunded|2026-11-01 12:00:00+00', 'summary: a succeeded refund is refunded');
select is(pg_temp.summ(9002, 9106), 'paid_timeout|refunded|2026-11-01 12:00:00+00', 'summary: a failed refund an admin resolved is refunded');
select is(pg_temp.summ(9002, 9107) || ' ' || pg_temp.summ(9002, 9108),
  'paid_timeout|delayed|2026-11-01 12:00:00+00 paid_timeout|delayed|2026-11-01 12:00:00+00', 'summary: a failed or canceled refund is delayed');
select is(pg_temp.summ(9002, 9109), 'paid_timeout|delayed|-', 'summary: an escalation without a refund is delayed');
select is(pg_temp.summ(9002, 9110), 'preparing_timeout|delayed|-', 'summary: a pending carrier review is delayed');
select is(pg_temp.summ(9002, 9111), 'preparing_timeout|delayed|-', 'summary: a review closed without refund is delayed');

-- 4. The shipment.cancelled notice of fn_cancel_shipment -------------------------------------------
select is(pg_get_function_arguments('public.fn_cancel_shipment(uuid, text, text, bigint)'::regprocedure),
  'p_shipment_id uuid, p_cancelled_by_role text, p_reason text, p_cancellation_loss_cents bigint DEFAULT NULL::bigint',
  'cancel: four arguments, the Stripe fee loss defaulting to NULL');
select is(pg_temp.grants('public.fn_cancel_shipment(uuid, text, text, bigint)'),
  'anon:false authenticated:false service_role:true', 'cancel: only service_role can execute fn_cancel_shipment');
select is((select prosecdef from pg_proc where oid = 'public.fn_cancel_shipment(uuid, text, text, bigint)'::regprocedure), true,
  'cancel: fn_cancel_shipment is SECURITY DEFINER');
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'notifications_source_event_key_user_id_uidx'),
  'CREATE UNIQUE INDEX notifications_source_event_key_user_id_uidx ON public.notifications USING btree (source_event_key, user_id) WHERE (source_event_key IS NOT NULL)',
  'cancel: notices are unique per source event key and user');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
-- 9106 already has the buyer notice, as a retried cancellation would.
insert into public.notifications (user_id, event_kind, source_event_key, title)
values (pg_temp.mu(9001), 'shipment.cancelled', 'shipment.cancelled:' || pg_temp.mu(9106), 'Pedido cancelado');

create function pg_temp.cancel(p_ship integer) returns text language sql as $$
  select c.success::text || ':' || coalesce(c.error_message, '-')
  from public.fn_cancel_shipment(pg_temp.mu(p_ship), 'system', 'summary test') c
$$;
-- The shipment.cancelled notices of p_ship as user:type:role:path, buyer first.
create function pg_temp.notices(p_ship integer) returns text language sql as $$
  select string_agg(
    case n.user_id when pg_temp.mu(9001) then 'buyer' when pg_temp.mu(9002) then 'seller' else n.user_id::text end
      || ':' || coalesce(n.type, '-') || ':' || coalesce(n.event_payload ->> 'recipient_role', '-') || ':'
      || coalesce(replace(replace(n.action_path, pg_temp.mu(p_ship)::text, 'S'), s.order_id::text, 'O'), '-'),
    ' ' order by n.user_id)
  from public.notifications n join public.shipments s on s.id = pg_temp.mu(p_ship)
  where n.event_kind = 'shipment.cancelled' and n.source_event_key = 'shipment.cancelled:' || pg_temp.mu(p_ship)
$$;

select is(pg_temp.cancel(9105), 'true:-', 'cancel: a shipment whose refund succeeded is cancelled');
select is(pg_temp.notices(9105), 'buyer:info:buyer:/profile/orders/O?shipment_id=S seller:warning:seller:/profile/orders/O?shipment_id=S',
  'cancel: the buyer and the seller each get one shipment.cancelled notice linking to the shipment');
select is(
  (select count(*) from public.notifications n
   where n.source_event_key = 'shipment.cancelled:' || pg_temp.mu(9105)
     and n.event_payload = jsonb_build_object('order_id', pg_temp.mu(9205), 'shipment_id', pg_temp.mu(9105),
       'recipient_role', n.event_payload ->> 'recipient_role')),
  2::bigint, 'cancel: each notice carries the order, the shipment and the recipient role');
select is(pg_temp.cancel(9105) || ' ' || pg_temp.notices(9105),
  'true:ALREADY_CANCELLED buyer:info:buyer:/profile/orders/O?shipment_id=S seller:warning:seller:/profile/orders/O?shipment_id=S',
  'cancel: a second call is ALREADY_CANCELLED and writes no notice');
select is(pg_temp.cancel(9106) || ' ' || pg_temp.notices(9106), 'true:- buyer:-:-:- seller:warning:seller:/profile/orders/O?shipment_id=S',
  'cancel: an existing notice for the same event and user is kept and not duplicated; the seller still gets one');

select * from finish();
rollback;
