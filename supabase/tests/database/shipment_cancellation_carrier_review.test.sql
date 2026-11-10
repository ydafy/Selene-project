-- Carrier review of a preparing-timeout cancellation (#276 T4):
-- fn_mark_shipment_cancellation_review marks the live claim once,
-- fn_resolve_shipment_cancellation_review lets an active admin approve the
-- refund or close it with a note and derives the label loss in SQL,
-- fn_list_shipment_cancellation_reviews lists the pending ones oldest first,
-- the claim refuses a pending or closed review, and the refund start needs the
-- approval once a review was marked. Also the claim's other refusals.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(64);
\ir ../fixtures/money.psql

-- Users: 8001 seller, 8002 buyer, 8003 admin, 8004 another user, 8005 suspended admin, 8006 another seller.
select pg_temp.money_user(8001);
select pg_temp.money_user(8002);
select pg_temp.money_user(8003, 'admin');
select pg_temp.money_user(8004);
select pg_temp.money_user(8005, 'admin');
select pg_temp.money_user(8006);
update public.profiles_private set status = 'suspended' where id = pg_temp.mu(8005);

-- A preparing shipment with a generated label that cost p_cost cents.
create function pg_temp.prep(p_order integer, p_ship integer, p_cost bigint default 8900)
returns uuid language plpgsql as $$
begin
  perform pg_temp.money_shipment(p_order, p_ship, 8001, 8002, 'preparing');
  update public.shipments set label_generation_state = 'generated', label_provider_cost_cents = p_cost
  where id = pg_temp.mu(p_ship);
  return pg_temp.mu(p_ship);
end $$;

-- The error message of a statement, or 'ok'. The exception block rolls the
-- statement back like a failed call.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

-- The violated constraint of a statement, or 'ok'. The statement is always rolled back.
create function pg_temp.chk(p_sql text) returns text language plpgsql as $$
declare
  v_name text;
begin
  execute p_sql;
  raise exception 'CHK_OK';
exception
  when check_violation then
    get stacked diagnostics v_name = constraint_name;
    return v_name;
  when raise_exception then
    if sqlerrm = 'CHK_OK' then return 'ok'; end if;
    raise;
end $$;

-- Claim tokens by shipment number.
create table pg_temp.tok (n integer primary key, t uuid);

create function pg_temp.claim_json(p_ship integer, p_source text default 'preparing_timeout', p_actor integer default null)
returns jsonb language sql as $$
  select public.fn_claim_shipment_cancellation(pg_temp.mu(p_ship), s.order_id,
    case when p_actor is null then null else pg_temp.mu(p_actor) end, p_source, p_source || ' test')
  from public.shipments s where s.id = pg_temp.mu(p_ship)
$$;

-- Claims and stores the token.
create function pg_temp.claim(p_ship integer, p_source text default 'preparing_timeout') returns uuid
language sql as $$
  insert into pg_temp.tok values (p_ship, (pg_temp.claim_json(p_ship, p_source) ->> 'claim_token')::uuid)
  on conflict (n) do update set t = excluded.t
  returning t
$$;

create function pg_temp.mark(p_ship integer, p_reason text) returns jsonb language sql as $$
  select public.fn_mark_shipment_cancellation_review(pg_temp.mu(p_ship),
    (select t from pg_temp.tok where n = p_ship), p_reason)
$$;

create function pg_temp.resolve(p_ship integer, p_admin integer, p_resolution text, p_note text default 'checked')
returns jsonb language sql as $$
  select public.fn_resolve_shipment_cancellation_review(pg_temp.mu(p_ship),
    case when p_admin is null then null else pg_temp.mu(p_admin) end, p_resolution, p_note)
$$;

create function pg_temp.rec(p_ship integer, p_outcome text, p_returned boolean default null)
returns jsonb language sql as $$
  select public.fn_record_shipment_carrier_cancellation(pg_temp.mu(p_ship),
    (select t from pg_temp.tok where n = p_ship), p_outcome, p_returned, null)
$$;

-- The stored operation row, to prove a refusal changed nothing.
create function pg_temp.op(p_ship integer) returns text language sql as $$
  select row_to_json(o)::text from public.shipment_cancellation_operations o where o.shipment_id = pg_temp.mu(p_ship)
$$;

-- The Stripe refund params fn_start_shipment_cancellation_refund accepts for an operation.
create function pg_temp.req(p_ship integer) returns jsonb language sql as $$
  select jsonb_build_object('payment_intent', s.stripe_payment_intent_id, 'amount', 100000,
    'reason', 'requested_by_customer',
    'metadata', jsonb_build_object('shipment_id', s.id, 'order_id', o.order_id,
      'caller_role', case when o.source in ('buyer', 'seller') then o.source else 'system' end,
      'reason', o.reason, 'seguro_share_cents', 0))
  from public.shipments s join public.shipment_cancellation_operations o on o.shipment_id = s.id
  where s.id = pg_temp.mu(p_ship)
$$;

create function pg_temp.start(p_ship integer) returns text language sql as $$
  select pg_temp.err(format('select public.fn_start_shipment_cancellation_refund(%L, %L, %L, 0)',
    pg_temp.mu(p_ship), (select t from pg_temp.tok where n = p_ship), pg_temp.req(p_ship)))
$$;

create function pg_temp.grants(p_sig text) returns text language sql as $$
  select string_agg(r || ':' || has_function_privilege(r, p_sig, 'execute'), ' ' order by r)
  from unnest(array['anon', 'authenticated', 'service_role']) r
$$;

-- 1. Grants and security mode --------------------------------------------------------
select is(pg_temp.grants('public.fn_mark_shipment_cancellation_review(uuid, uuid, text)'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_mark_shipment_cancellation_review');
select is(pg_temp.grants('public.fn_resolve_shipment_cancellation_review(uuid, uuid, text, text)'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_resolve_shipment_cancellation_review');
select is(pg_temp.grants('public.fn_list_shipment_cancellation_reviews()'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_list_shipment_cancellation_reviews');
select is(pg_temp.grants('public.fn_claim_shipment_cancellation(uuid, uuid, uuid, text, text)'),
  'anon:false authenticated:false service_role:true', 'only service_role can execute fn_claim_shipment_cancellation');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_mark_shipment_cancellation_review', 'fn_resolve_shipment_cancellation_review',
       'fn_list_shipment_cancellation_reviews', 'fn_claim_shipment_cancellation')),
  'fn_claim_shipment_cancellation:true:search_path="" fn_list_shipment_cancellation_reviews:true:search_path="" '
    || 'fn_mark_shipment_cancellation_review:true:search_path="" fn_resolve_shipment_cancellation_review:true:search_path=""',
  'the four functions are SECURITY DEFINER with an empty search_path');

-- Fixtures: one order per shipment.
select pg_temp.prep(8200 + n, 8100 + n) from unnest(array[1, 2, 3, 4, 5, 7, 8, 9]) n;
select pg_temp.prep(8210, 8110);
select pg_temp.prep(8211, 8111, null);
select pg_temp.prep(8200 + n, 8100 + n) from generate_series(12, 19) n;
select pg_temp.money_shipment(8206, 8106, 8001, 8002, 'paid');

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select is(
  pg_temp.err($$select public.fn_mark_shipment_cancellation_review(pg_temp.mu(8101), gen_random_uuid(), 'tracking_unknown')$$) || ',' ||
  pg_temp.err($$select pg_temp.resolve(8101, 8003, 'refund_approved')$$) || ',' ||
  pg_temp.err($$select * from public.fn_list_shipment_cancellation_reviews()$$) || ',' ||
  pg_temp.err($$select pg_temp.claim_json(8101)$$),
  'UNAUTHORIZED,UNAUTHORIZED,UNAUTHORIZED,UNAUTHORIZED',
  'mark, resolve, list and claim refuse a caller without the service_role claim');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

select pg_temp.claim(n) from unnest(array[8101, 8102, 8103, 8104, 8105, 8107, 8108, 8110, 8111, 8112,
  8113, 8114, 8115, 8116, 8117, 8118, 8119]) n;
select pg_temp.claim(8106, 'paid_timeout');

-- 2. Constraints on the review columns --------------------------------------------------------
create function pg_temp.upd(p_set text) returns text language sql as $$
  select pg_temp.chk(format('update public.shipment_cancellation_operations set %s where shipment_id = %L',
    p_set, pg_temp.mu(8104)))
$$;
select is(pg_temp.upd($$review_reason = 'other', review_required_at = now()$$),
  'shipment_cancellation_operations_review_reason_check', 'check: the review reason is one of the three');
select is(pg_temp.upd($$review_reason = 'tracking_unknown'$$),
  'shipment_cancellation_operations_review_recorded', 'check: a review reason needs its time');
select is(pg_temp.upd($$review_resolution = 'closed_no_refund', review_resolved_at = now(), review_resolved_by = pg_temp.mu(8003), review_resolution_note = 'x'$$),
  'shipment_cancellation_operations_review_resolution_after_requir', 'check: a resolution needs a marked review');
select is(pg_temp.upd($$review_reason = 'tracking_unknown', review_required_at = now(), review_resolution = 'refunded', review_resolved_at = now(), review_resolved_by = pg_temp.mu(8003), review_resolution_note = 'x'$$),
  'shipment_cancellation_operations_review_resolution_check', 'check: the resolution is refund_approved or closed_no_refund');
select is(pg_temp.upd($$review_reason = 'tracking_unknown', review_required_at = now(), review_resolution = 'closed_no_refund', review_resolved_at = now(), review_resolved_by = pg_temp.mu(8003)$$),
  'shipment_cancellation_operations_review_resolution_recorded', 'check: a resolution needs its time, admin and note');
select is(pg_temp.upd($$review_reason = 'tracking_unknown', review_required_at = now(), review_resolution = 'closed_no_refund', review_resolved_at = now(), review_resolved_by = pg_temp.mu(8003), review_resolution_note = ' x '$$),
  'shipment_cancellation_operations_review_note_format', 'check: the note is trimmed');
select is(pg_temp.upd($$label_cost_loss_cents = 8900$$),
  'shipment_cancellation_operations_carrier_balance_consistent', 'check: a label loss needs an accepted outcome or an approved refund');
select is(pg_temp.upd($$review_reason = 'tracking_unknown', review_required_at = now(), review_resolution = 'refund_approved', review_resolved_at = now(), review_resolved_by = pg_temp.mu(8003), review_resolution_note = 'x', label_cost_loss_cents = 8900$$),
  'ok', 'check: an approved refund allows a label loss without a carrier outcome');

-- 3. Marking a review -----------------------------------------------------------------
create table pg_temp.res (n integer primary key, r jsonb);
insert into pg_temp.res values
  (8101, pg_temp.mark(8101, 'tracking_unknown')),
  (8102, pg_temp.mark(8102, 'carrier_refused')),
  (8103, pg_temp.mark(8103, 'carrier_ambiguous'));
select is((select r - 'review_required_at' from pg_temp.res where n = 8101),
  '{"marked": true, "review_reason": "tracking_unknown"}'::jsonb, 'mark: the first mark answers marked true with the reason');
select is(
  (select string_agg(review_reason || ':' || (review_required_at is not null)::text, ',' order by shipment_id)
   from public.shipment_cancellation_operations where shipment_id in (pg_temp.mu(8101), pg_temp.mu(8102), pg_temp.mu(8103))),
  'tracking_unknown:true,carrier_refused:true,carrier_ambiguous:true', 'mark: each of the three reasons is stored with its time');
create table pg_temp.before (n integer primary key, v text);
insert into pg_temp.before values (8101, pg_temp.op(8101));
select is(pg_temp.mark(8101, 'carrier_refused'), (select r || '{"marked": false}' from pg_temp.res where n = 8101),
  'mark: a repeat answers marked false with the first reason and time');
select is(pg_temp.op(8101), (select v from pg_temp.before where n = 8101), 'mark: a repeat keeps the first marker');

update public.shipment_cancellation_operations set claim_expires_at = now() - interval '1 minute'
where shipment_id = pg_temp.mu(8105);
update public.shipment_cancellation_operations set external_started_at = now() where shipment_id = pg_temp.mu(8107);
update public.shipments set status = 'shipped' where id = pg_temp.mu(8108);
insert into pg_temp.before select n, pg_temp.op(n) from unnest(array[8104, 8105, 8106, 8107, 8108]) n;
select is(pg_temp.err($$select pg_temp.mark(8104, 'other')$$) || ',' || pg_temp.err($$select pg_temp.mark(8104, null)$$),
  'INVALID_REVIEW_REASON,INVALID_REVIEW_REASON', 'mark: an unknown or NULL reason is INVALID_REVIEW_REASON');
select is(
  pg_temp.err($$select public.fn_mark_shipment_cancellation_review(pg_temp.mu(8104), gen_random_uuid(), 'tracking_unknown')$$) || ',' ||
  pg_temp.err($$select public.fn_mark_shipment_cancellation_review(pg_temp.mu(8104), null, 'tracking_unknown')$$) || ',' ||
  pg_temp.err($$select public.fn_mark_shipment_cancellation_review(pg_temp.mu(8109), gen_random_uuid(), 'tracking_unknown')$$),
  'STALE_CANCELLATION_CLAIM,STALE_CANCELLATION_CLAIM,STALE_CANCELLATION_CLAIM',
  'mark: a wrong token, a NULL token and a shipment without an operation are STALE_CANCELLATION_CLAIM');
select is(pg_temp.err($$select public.fn_mark_shipment_cancellation_review(gen_random_uuid(), gen_random_uuid(), 'tracking_unknown')$$),
  'SHIPMENT_NOT_FOUND', 'mark: an unknown shipment is SHIPMENT_NOT_FOUND');
select is(pg_temp.err($$select pg_temp.mark(8105, 'tracking_unknown')$$), 'CANCELLATION_CLAIM_EXPIRED',
  'mark: an expired claim is CANCELLATION_CLAIM_EXPIRED');
select is(pg_temp.err($$select pg_temp.mark(8106, 'tracking_unknown')$$), 'INVALID_CARRIER_CANCELLATION_SOURCE',
  'mark: a paid_timeout operation is INVALID_CARRIER_CANCELLATION_SOURCE');
select is(pg_temp.err($$select pg_temp.mark(8107, 'tracking_unknown')$$), 'CANCELLATION_EXTERNAL_ALREADY_STARTED',
  'mark: an operation whose external call started is CANCELLATION_EXTERNAL_ALREADY_STARTED');
select is(pg_temp.err($$select pg_temp.mark(8108, 'tracking_unknown')$$), 'SHIPMENT_NOT_CANCELABLE',
  'mark: a shipment that is no longer preparing is SHIPMENT_NOT_CANCELABLE');
select is(
  (select count(*) from pg_temp.before b where b.n between 8104 and 8108 and b.v is distinct from pg_temp.op(b.n)),
  0::bigint, 'mark: every refusal leaves the operation unchanged');

-- 4. The claim during a review ------------------------------------------------------------
update public.shipment_cancellation_operations set claim_expires_at = now() - interval '1 minute'
where shipment_id = pg_temp.mu(8101);
insert into pg_temp.before select n, pg_temp.op(n) from unnest(array[8102]) n;
update pg_temp.before set v = pg_temp.op(8101) where n = 8101;
select is(pg_temp.err($$select pg_temp.claim_json(8101)$$), 'SHIPMENT_CANCELLATION_UNDER_REVIEW',
  'claim: an expired claim with a pending review is SHIPMENT_CANCELLATION_UNDER_REVIEW');
select is(pg_temp.err($$select pg_temp.claim_json(8102)$$), 'SHIPMENT_CANCELLATION_UNDER_REVIEW',
  'claim: a live claim with a pending review is SHIPMENT_CANCELLATION_UNDER_REVIEW, not busy');
select is((select count(*) from pg_temp.before b where b.n in (8101, 8102) and b.v is distinct from pg_temp.op(b.n)),
  0::bigint, 'claim: a pending review keeps the token and the expiry');
select pg_temp.resolve(8103, 8003, 'closed_no_refund');
update public.shipment_cancellation_operations set claim_expires_at = now() - interval '1 minute'
where shipment_id = pg_temp.mu(8103);
insert into pg_temp.before values (8103, pg_temp.op(8103));
select is(pg_temp.err($$select pg_temp.claim_json(8103)$$), 'SHIPMENT_CANCELLATION_REVIEW_CLOSED',
  'claim: a review closed without refund is SHIPMENT_CANCELLATION_REVIEW_CLOSED');
select is(pg_temp.op(8103), (select v from pg_temp.before where n = 8103), 'claim: a closed review keeps the token');

-- 5. Resolving a review -------------------------------------------------------------------
select pg_temp.mark(n, 'tracking_unknown') from unnest(array[8110, 8111, 8113, 8114, 8115, 8116]) n;
-- 8112: accepted with the balance kept records 8900; the label cost changes afterwards.
select pg_temp.rec(8112, 'accepted', false);
select pg_temp.mark(8112, 'tracking_unknown');
update public.shipments set label_provider_cost_cents = 9500 where id = pg_temp.mu(8112);
insert into pg_temp.before values (8110, pg_temp.op(8110));
select is(pg_temp.resolve(8110, 8003, 'refund_approved', '  Label never scanned  ') - 'review_resolved_at',
  jsonb_build_object('review_resolution', 'refund_approved', 'review_resolved_by', pg_temp.mu(8003),
    'review_resolution_note', 'Label never scanned', 'label_cost_loss_cents', 8900),
  'resolve: refund_approved answers the decision, the admin, the trimmed note and the label provider cost as the loss');
select is(
  (select review_resolution || '|' || review_resolved_by || '|' || review_resolution_note || '|'
     || (review_resolved_at is not null)::text || '|' || label_cost_loss_cents
   from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(8110)),
  'refund_approved|' || pg_temp.mu(8003) || '|Label never scanned|true|8900', 'resolve: the decision, admin, time, note and loss are stored');
select is(
  (select row(claim_token, claim_expires_at, external_started_at, refund_request)::text
   from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(8110))
    || (select status::text from public.shipments where id = pg_temp.mu(8110)),
  (select row(o.claim_token, o.claim_expires_at, o.external_started_at, o.refund_request)::text
   from json_populate_record(null::public.shipment_cancellation_operations, (select v from pg_temp.before where n = 8110)::json) o)
    || 'preparing',
  'resolve: the claim, the external start, the refund request and the shipment status stay');
select is(pg_temp.resolve(8111, 8003, 'refund_approved') ->> 'label_cost_loss_cents', null,
  'resolve: refund_approved with an unknown label cost leaves the loss NULL');
select is(pg_temp.resolve(8112, 8003, 'refund_approved') ->> 'label_cost_loss_cents', '8900',
  'resolve: refund_approved keeps the loss an accepted outcome already recorded');
select is(
  (select review_resolution || '|' || coalesce(label_cost_loss_cents::text, '-')
   from public.shipment_cancellation_operations where shipment_id = pg_temp.mu(8103)),
  'closed_no_refund|-', 'resolve: closed_no_refund is stored and leaves the loss NULL');

insert into pg_temp.before values (8113, pg_temp.op(8113));
select is(
  pg_temp.err($$select pg_temp.resolve(8113, 8004, 'refund_approved')$$) || ',' ||
  pg_temp.err($$select pg_temp.resolve(8113, 8999, 'refund_approved')$$) || ',' ||
  pg_temp.err($$select pg_temp.resolve(8113, null, 'refund_approved')$$) || ',' ||
  pg_temp.err($$select pg_temp.resolve(8113, 8005, 'refund_approved')$$),
  'ADMIN_REQUIRED,ADMIN_REQUIRED,ADMIN_REQUIRED,ADMIN_REQUIRED',
  'resolve: a non-admin, an unknown id, a NULL id and a suspended admin are ADMIN_REQUIRED');
select is(pg_temp.err($$select pg_temp.resolve(8113, 8003, 'refunded')$$) || ',' || pg_temp.err($$select pg_temp.resolve(8113, 8003, null)$$),
  'INVALID_REVIEW_RESOLUTION,INVALID_REVIEW_RESOLUTION', 'resolve: an unknown or NULL resolution is INVALID_REVIEW_RESOLUTION');
select is(
  pg_temp.err($$select pg_temp.resolve(8113, 8003, 'refund_approved', '   ')$$) || ',' ||
  pg_temp.err($$select pg_temp.resolve(8113, 8003, 'refund_approved', null)$$) || ',' ||
  pg_temp.err($$select pg_temp.resolve(8113, 8003, 'refund_approved', repeat('x', 501))$$),
  'INVALID_REVIEW_NOTE,INVALID_REVIEW_NOTE,INVALID_REVIEW_NOTE', 'resolve: a blank, NULL or 501-character note is INVALID_REVIEW_NOTE');
select is(pg_temp.op(8113), (select v from pg_temp.before where n = 8113), 'resolve: a refused input leaves the operation unchanged');
select is(pg_temp.err($$select pg_temp.resolve(8114, 8003, 'closed_no_refund', repeat('x', 500))$$), 'ok',
  'resolve: a 500-character note is accepted');
update public.shipment_cancellation_operations set external_started_at = now() where shipment_id = pg_temp.mu(8115);
update public.shipments set status = 'shipped' where id = pg_temp.mu(8116);
select is(pg_temp.err($$select pg_temp.resolve(8199, 8003, 'refund_approved')$$), 'SHIPMENT_NOT_FOUND',
  'resolve: an unknown shipment is SHIPMENT_NOT_FOUND');
select is(pg_temp.err($$select pg_temp.resolve(8109, 8003, 'refund_approved')$$) || ',' || pg_temp.err($$select pg_temp.resolve(8104, 8003, 'refund_approved')$$),
  'CARRIER_REVIEW_NOT_PENDING,CARRIER_REVIEW_NOT_PENDING', 'resolve: no operation or no marked review is CARRIER_REVIEW_NOT_PENDING');
select is(pg_temp.err($$select pg_temp.resolve(8110, 8003, 'closed_no_refund')$$), 'CARRIER_REVIEW_ALREADY_RESOLVED',
  'resolve: a resolved review is CARRIER_REVIEW_ALREADY_RESOLVED');
select is(pg_temp.err($$select pg_temp.resolve(8115, 8003, 'refund_approved')$$), 'CANCELLATION_EXTERNAL_ALREADY_STARTED',
  'resolve: an operation whose external call started is CANCELLATION_EXTERNAL_ALREADY_STARTED');
select is(pg_temp.err($$select pg_temp.resolve(8116, 8003, 'refund_approved')$$), 'SHIPMENT_NOT_CANCELABLE',
  'resolve: a shipment that is no longer preparing is SHIPMENT_NOT_CANCELABLE');

-- 6. The refund start after a review ---------------------------------------------------------
update public.shipment_cancellation_operations set claim_expires_at = now() - interval '1 minute'
where shipment_id = pg_temp.mu(8110);
select is(
  (select (j ->> 'status') || '|' || ((j ->> 'claim_token')::uuid is distinct from (select t from pg_temp.tok where n = 8110))::text
   from pg_temp.claim_json(8110) j),
  'claimed|true', 'start: after refund_approved an expired claim is claimed again with a new token');
update public.shipment_cancellation_operations set claim_expires_at = now() - interval '1 minute'
where shipment_id = pg_temp.mu(8110);
select pg_temp.claim(8110);
select is(pg_temp.start(8110), 'ok', 'start: refund_approved without a carrier outcome starts the refund');
select pg_temp.rec(8117, 'refused');
select pg_temp.mark(8117, 'carrier_refused');
select pg_temp.resolve(8117, 8003, 'refund_approved');
select is(pg_temp.start(8117), 'ok', 'start: refund_approved starts the refund even with a refused outcome');
select pg_temp.rec(n, 'accepted', false) from unnest(array[8118, 8119]) n;
select pg_temp.mark(n, 'carrier_ambiguous') from unnest(array[8118, 8119]) n;
select is(pg_temp.start(8118), 'CARRIER_CANCELLATION_NOT_CONFIRMED',
  'start: an accepted outcome marked for review cannot start while the review is pending, with the live token');
select pg_temp.resolve(8119, 8003, 'closed_no_refund');
select is(pg_temp.start(8119), 'CARRIER_CANCELLATION_NOT_CONFIRMED',
  'start: an accepted outcome whose review was closed without refund cannot start with the live token');
select pg_temp.resolve(8118, 8003, 'refund_approved');
select is(pg_temp.start(8118), 'ok', 'start: an accepted outcome marked for review starts once the refund is approved');

-- 7. Listing pending reviews -------------------------------------------------------------------
-- Pending now: 8101, 8102, 8113, 8115, 8116. 8113 and 8116 share a time, so the shipment id decides.
update public.shipment_cancellation_operations o set review_required_at = now() - v.ago
from (values (8101, interval '1 hour'), (8102, interval '3 hours'), (8113, interval '2 hours'),
  (8115, interval '30 minutes'), (8116, interval '2 hours')) v(n, ago)
where o.shipment_id = pg_temp.mu(v.n);
update public.shipments set tracking_number = 'TRK8102', carrier = 'dhl' where id = pg_temp.mu(8102);
select is(
  (select array_agg(l.shipment_id) from public.fn_list_shipment_cancellation_reviews() l where l.seller_id = pg_temp.mu(8001)),
  array[pg_temp.mu(8102), pg_temp.mu(8113), pg_temp.mu(8116), pg_temp.mu(8101), pg_temp.mu(8115)],
  'list: only pending reviews, oldest first, ties by shipment id; resolved and unmarked operations are left out');
select is(
  (select row(l.*)::text from public.fn_list_shipment_cancellation_reviews() l where l.shipment_id = pg_temp.mu(8102)),
  row(pg_temp.mu(8102), pg_temp.mu(8202), pg_temp.mu(8001), 'TRK8102', 'dhl', 8900::bigint, 'carrier_refused',
    null::text, now() - interval '3 hours')::text,
  'list: a row carries the shipment, order, seller, tracking, carrier, label cost, reason, outcome and time');

-- 8. The claim's other refusals ------------------------------------------------------------------
select pg_temp.money_shipment(8220, 8120, 8001, 8002, 'paid');
select pg_temp.money_shipment(8221, 8121, 8006, 8002, 'paid');
update public.shipments set stripe_transfer_id = 'tr_test_8121' where id = pg_temp.mu(8121);
select pg_temp.money_shipment(8222, 8122, 8001, 8002, 'paid');
update public.shipments set label_generation_state = 'generated' where id = pg_temp.mu(8122);
select pg_temp.money_shipment(8223, 8123, 8001, 8002, 'paid');
select pg_temp.money_payout_run(8301, 8001, 8003, array[8123]);
update public.connect_payout_run_shipments set transfer_started_at = now(), transfer_token = gen_random_uuid()
where shipment_id = pg_temp.mu(8123);
select is(
  pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8120), pg_temp.mu(8220), null, 'admin', 'test')$$) || ',' ||
  pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8120), pg_temp.mu(8220), pg_temp.mu(8002), 'buyer', '  ')$$) || ',' ||
  pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8120), pg_temp.mu(8220), null, 'buyer', 'test')$$) || ',' ||
  pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8120), pg_temp.mu(8220), pg_temp.mu(8002), 'paid_timeout', 'test')$$),
  'INVALID_CANCELLATION_CONTEXT,INVALID_CANCELLATION_CONTEXT,INVALID_CANCELLATION_CONTEXT,INVALID_CANCELLATION_CONTEXT',
  'claim: an unknown source, a blank reason, a buyer without actor and a timeout with an actor are INVALID_CANCELLATION_CONTEXT');
select is(pg_temp.err($$select public.fn_claim_shipment_cancellation(gen_random_uuid(), pg_temp.mu(8220), null, 'paid_timeout', 'test')$$),
  'SHIPMENT_NOT_FOUND', 'claim: an unknown shipment is SHIPMENT_NOT_FOUND');
select is(pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8120), pg_temp.mu(8221), null, 'paid_timeout', 'test')$$),
  'SHIPMENT_ORDER_MISMATCH', 'claim: another order is SHIPMENT_ORDER_MISMATCH');
select is(pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8120), pg_temp.mu(8220), pg_temp.mu(8004), 'buyer', 'test')$$),
  'ORDER_BUYER_MISMATCH', 'claim: a buyer cancellation by someone else is ORDER_BUYER_MISMATCH');
select is(pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8120), pg_temp.mu(8220), pg_temp.mu(8002), 'seller', 'test')$$),
  'SHIPMENT_SELLER_MISMATCH', 'claim: a seller cancellation by someone else is SHIPMENT_SELLER_MISMATCH');
select is(
  pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8104), pg_temp.mu(8204), pg_temp.mu(8002), 'buyer', 'test')$$) || ',' ||
  pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8120), pg_temp.mu(8220), null, 'preparing_timeout', 'test')$$),
  'SHIPMENT_NOT_CANCELABLE,SHIPMENT_NOT_CANCELABLE',
  'claim: a buyer cannot cancel a preparing shipment and a preparing timeout cannot claim a paid one');
select is(pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8121), pg_temp.mu(8221), null, 'paid_timeout', 'test')$$),
  'SHIPMENT_FUNDS_ALREADY_RELEASED', 'claim: a shipment with a Stripe transfer is SHIPMENT_FUNDS_ALREADY_RELEASED');
select is(pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8122), pg_temp.mu(8222), null, 'paid_timeout', 'test')$$),
  'SHIPMENT_LABEL_OPERATION_ACTIVE', 'claim: a paid shipment with a generated label is SHIPMENT_LABEL_OPERATION_ACTIVE');
select is(pg_temp.err($$select public.fn_claim_shipment_cancellation(pg_temp.mu(8123), pg_temp.mu(8223), null, 'paid_timeout', 'test')$$),
  'SHIPMENT_TRANSFER_OPERATION_ACTIVE', 'claim: a shipment whose payout transfer started is SHIPMENT_TRANSFER_OPERATION_ACTIVE');

select * from finish();
rollback;
