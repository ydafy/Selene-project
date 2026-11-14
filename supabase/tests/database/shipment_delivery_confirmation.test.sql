-- Delivery confirmation (#277 T8): fn_confirm_shipment_delivery completes a
-- delivered, undisputed Connect shipment once, for the buyer at any time or
-- automatically 48 hours after delivery, with one shipment_completion_events
-- row as its audit. It refuses the rest, in the order the body checks them,
-- without changing anything. The role check, the started-cancellation guard
-- and the plain auto success live in shipment_cancellation_tracking.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(47);
\ir ../fixtures/money.psql

-- Users: 8001 seller, 8002 buyer, 8003 another user.
select pg_temp.money_user(8001);
select pg_temp.money_user(8002);
select pg_temp.money_user(8003);

-- success:error:completion_source:idempotent of a call. The key defaults to
-- the one the source expects for p_ship; p_actor is a user number or NULL.
create function pg_temp.confirm(p_ship integer, p_source text, p_actor integer, p_key text default '-') returns text language sql as $$
  select c.success::text || ':' || coalesce(c.error, '-') || ':' || coalesce(c.completion_source, '-') || ':' || c.idempotent::text
  from public.fn_confirm_shipment_delivery(pg_temp.mu(p_ship), p_source, pg_temp.mu(p_actor),
    case when p_key = '-' then
      case when p_source = 'auto' then 'auto_completion_' else 'confirm_shipment_' end || pg_temp.mu(p_ship)
    else p_key end) c
$$;

-- status|completed_at|buyer_confirmed_at|updated_at of a shipment.
create function pg_temp.sig(p_ship integer) returns text language sql as $$
  select s.status::text || '|' || coalesce(s.completed_at::text, '-') || '|'
    || coalesce(s.buyer_confirmed_at::text, '-') || '|' || s.updated_at::text
  from public.shipments s where s.id = pg_temp.mu(p_ship)
$$;

-- order|source|actor|key|completed_at|is_connect of the completion event of a shipment.
create function pg_temp.event(p_ship integer) returns text language sql as $$
  select e.order_id || '|' || e.source || '|' || coalesce(e.actor_id::text, '-') || '|' || e.idempotency_key
    || '|' || e.completed_at::text || '|' || e.is_connect::text
  from public.shipment_completion_events e where e.shipment_id = pg_temp.mu(p_ship)
$$;

-- level|message|metadata of every system_logs row about a shipment.
create function pg_temp.logs(p_ship integer) returns text language sql as $$
  select coalesce(string_agg(l.level || '|' || l.message || '|' || l.metadata::text, ' / ' order by l.created_at), '-')
  from public.system_logs l where l.metadata ->> 'shipment_id' = pg_temp.mu(p_ship)::text
$$;

-- Fixtures: shipment n of order n + 100. 8108 and 8114 have no Connect payment.
select pg_temp.money_shipment(8201, 8101, 8001, 8002, 'delivered', interval '3 days');
select pg_temp.money_shipment(8202, 8102, 8001, 8002, 'completed', interval '3 days');
select pg_temp.money_shipment(8203, 8103, 8001, 8002, 'shipped');
select pg_temp.money_shipment(8200 + n, 8100 + n, 8001, 8002, 'delivered', interval '3 days')
from unnest(array[5, 7, 9, 10, 21, 22, 23]) n;
select pg_temp.money_shipment(8208, 8108, 8001, 8002, 'delivered', interval '3 days', 90000, null);
select pg_temp.money_shipment(8211, 8111, 8001, 8002, 'delivered');
select pg_temp.money_shipment(8212, 8112, 8001, 8002, 'delivered', interval '48 hours' - interval '1 second');
select pg_temp.money_shipment(8213, 8113, 8001, 8002, 'delivered', interval '48 hours');
select pg_temp.money_shipment(8214, 8114, 8001, 8002, 'delivered', interval '1 hour', 90000, null);
select pg_temp.money_shipment(8220, 8120, 8001, 8002, 'delivered', interval '1 hour');
select pg_temp.money_dispute(8303, 8103);
select pg_temp.money_dispute(8305, 8105);
update public.shipments set buyer_confirmed_at = now() - interval '1 day' where id = pg_temp.mu(8110);
-- The successful completions must show they write updated_at.
update public.shipments set updated_at = now() - interval '1 day' where id in (pg_temp.mu(8113), pg_temp.mu(8120));
create table pg_temp.before as
select n, pg_temp.sig(n) as sig from unnest(array[8101, 8102, 8103, 8105, 8107, 8108, 8109, 8110, 8111, 8112, 8114]) n;

-- Moves dispute 8305 to p_status, then confirms 8105 for user 8003.
create function pg_temp.dispute_as(p_status public.dispute_status) returns text language plpgsql as $$
begin
  update public.disputes set status = p_status where id = pg_temp.mu(8305);
  return p_status::text || '=' || pg_temp.confirm(8105, 'buyer', 8003);
end $$;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 1. Source and idempotency key, checked before the shipment is read -------------------------
select is(pg_temp.confirm(8101, null, 8002, '') || ' ' || pg_temp.confirm(8101, 'admin', 8002),
  'false:INVALID_COMPLETION_SOURCE:-:false false:INVALID_COMPLETION_SOURCE:-:false',
  'INVALID_COMPLETION_SOURCE for a NULL or unknown source, before the key is checked');
select is(pg_temp.confirm(8101, 'buyer', 8002, null) || ' ' || pg_temp.confirm(8101, 'buyer', 8002, '')
    || ' ' || pg_temp.confirm(8101, 'auto', null, ''),
  'false:IDEMPOTENCY_KEY_REQUIRED:-:false false:IDEMPOTENCY_KEY_REQUIRED:-:false false:IDEMPOTENCY_KEY_REQUIRED:-:false',
  'IDEMPOTENCY_KEY_REQUIRED for a NULL or empty key');
select is(pg_temp.confirm(8101, 'buyer', 8002, 'auto_completion_' || pg_temp.mu(8101)),
  'false:INVALID_IDEMPOTENCY_KEY:-:false', 'INVALID_IDEMPOTENCY_KEY: a buyer confirmation needs confirm_shipment_<id>');
select is(pg_temp.confirm(8101, 'auto', null, 'confirm_shipment_' || pg_temp.mu(8101)),
  'false:INVALID_IDEMPOTENCY_KEY:-:false', 'INVALID_IDEMPOTENCY_KEY: an automatic completion needs auto_completion_<id>');
select is(pg_temp.confirm(8101, 'buyer', 8002, 'confirm_shipment_' || pg_temp.mu(8120)),
  'false:INVALID_IDEMPOTENCY_KEY:-:false', 'INVALID_IDEMPOTENCY_KEY: the key must name this shipment');
select is(pg_temp.confirm(8999, 'buyer', 8002, 'confirm_shipment_x'),
  'false:INVALID_IDEMPOTENCY_KEY:-:false', 'the key is checked before the shipment is looked up');

-- 2. The shipment, in check order ---------------------------------------------------------------
select is(pg_temp.confirm(8999, 'buyer', 8002) || ' ' || pg_temp.confirm(8999, 'auto', null),
  'false:SHIPMENT_NOT_FOUND:-:false false:SHIPMENT_NOT_FOUND:-:false', 'SHIPMENT_NOT_FOUND for an unknown shipment');
select is(pg_temp.confirm(8102, 'buyer', 8003) || ' ' || pg_temp.confirm(8102, 'auto', null),
  'false:COMPLETION_AUDIT_MISSING:-:false false:COMPLETION_AUDIT_MISSING:-:false',
  'COMPLETION_AUDIT_MISSING: a completed shipment without a completion event, before the actor is checked');
select is(pg_temp.confirm(8103, 'buyer', 8002) || ' ' || pg_temp.confirm(8103, 'auto', null),
  'false:SHIPMENT_NOT_IN_CONFIRMABLE_STATE:-:false false:SHIPMENT_NOT_IN_CONFIRMABLE_STATE:-:false',
  'SHIPMENT_NOT_IN_CONFIRMABLE_STATE: a shipped shipment, checked before its open dispute');
select is(
  (select string_agg(pg_temp.dispute_as(st), ' ' order by o)
   from unnest(array['open', 'under_review', 'waiting_return', 'return_shipped', 'return_delivered']::public.dispute_status[])
     with ordinality u(st, o)),
  'open=false:SHIPMENT_HAS_ACTIVE_DISPUTE:-:false under_review=false:SHIPMENT_HAS_ACTIVE_DISPUTE:-:false '
    || 'waiting_return=false:SHIPMENT_HAS_ACTIVE_DISPUTE:-:false return_shipped=false:SHIPMENT_HAS_ACTIVE_DISPUTE:-:false '
    || 'return_delivered=false:SHIPMENT_HAS_ACTIVE_DISPUTE:-:false',
  'SHIPMENT_HAS_ACTIVE_DISPUTE for every dispute status but resolved and rejected, before the actor is checked');
select is(pg_temp.confirm(8105, 'auto', null), 'false:SHIPMENT_HAS_ACTIVE_DISPUTE:-:false',
  'SHIPMENT_HAS_ACTIVE_DISPUTE also refuses an automatic completion');
update public.disputes set status = 'resolved' where id = pg_temp.mu(8305);
select is(pg_temp.confirm(8105, 'buyer', 8003), 'false:BUYER_REQUIRED:-:false',
  'a resolved dispute is not active: the check moves on to the actor');
update public.disputes set status = 'rejected' where id = pg_temp.mu(8305);
select is(pg_temp.confirm(8105, 'buyer', 8003), 'false:BUYER_REQUIRED:-:false',
  'a rejected dispute is not active: the check moves on to the actor');
select is(pg_temp.confirm(8107, 'buyer', null) || ' ' || pg_temp.confirm(8107, 'buyer', 8003) || ' ' || pg_temp.confirm(8107, 'buyer', 8001),
  'false:BUYER_REQUIRED:-:false false:BUYER_REQUIRED:-:false false:BUYER_REQUIRED:-:false',
  'BUYER_REQUIRED: the buyer actor must be the order''s buyer, not NULL, another user or the seller');
select is(pg_temp.confirm(8108, 'buyer', 8003), 'false:BUYER_REQUIRED:-:false',
  'the buyer is checked before the Connect payment');
select is(pg_temp.confirm(8109, 'auto', 8002), 'false:AUTO_COMPLETION_NOT_DUE:-:false',
  'AUTO_COMPLETION_NOT_DUE: an automatic completion carries no actor');
select is(pg_temp.confirm(8110, 'auto', null), 'false:AUTO_COMPLETION_NOT_DUE:-:false',
  'AUTO_COMPLETION_NOT_DUE: a shipment the buyer already confirmed is not auto-completed');
select is(pg_temp.confirm(8111, 'auto', null), 'false:AUTO_COMPLETION_NOT_DUE:-:false',
  'AUTO_COMPLETION_NOT_DUE: a shipment without a delivery time');
select is(pg_temp.confirm(8112, 'auto', null), 'false:AUTO_COMPLETION_NOT_DUE:-:false',
  'AUTO_COMPLETION_NOT_DUE: one second short of 48 hours after delivery');
select is(pg_temp.confirm(8114, 'auto', null), 'false:AUTO_COMPLETION_NOT_DUE:-:false',
  'the 48-hour rule is checked before the Connect payment');
select is(pg_temp.confirm(8108, 'buyer', 8002) || ' ' || pg_temp.confirm(8108, 'auto', null),
  'false:SHIPMENT_NOT_CONNECT:-:false false:SHIPMENT_NOT_CONNECT:-:false',
  'SHIPMENT_NOT_CONNECT: a shipment without a Stripe payment intent is refused for the buyer and automatically');

-- 3. A refusal changes nothing ------------------------------------------------------------------
select is((select count(*) from pg_temp.before b where pg_temp.sig(b.n) is distinct from b.sig), 0::bigint,
  'every refused shipment keeps its status, completed_at, buyer_confirmed_at and updated_at');
select is((select count(*) from public.shipment_completion_events e join pg_temp.before b on e.shipment_id = pg_temp.mu(b.n)), 0::bigint,
  'no refusal writes a completion event');
select is((select count(*) from public.system_logs l join pg_temp.before b on l.metadata ->> 'shipment_id' = pg_temp.mu(b.n)::text),
  0::bigint, 'no refusal writes a system log');

-- 4. Buyer confirmation, then replay -------------------------------------------------------------
select is(pg_temp.confirm(8120, 'buyer', 8002), 'true:-:buyer:false',
  'the buyer confirms a delivered Connect shipment an hour after delivery');
select is(pg_temp.sig(8120), 'completed|' || now() || '|' || now() || '|' || now(),
  'buyer: the shipment is completed, with completed_at, buyer_confirmed_at and updated_at set to now');
select is(pg_temp.event(8120),
  pg_temp.mu(8220) || '|buyer|' || pg_temp.mu(8002) || '|confirm_shipment_' || pg_temp.mu(8120) || '|' || now() || '|true',
  'buyer: one completion event with the order, source buyer, the buyer as actor, the key, the time and is_connect');
select is(pg_temp.logs(8120),
  'INFO|Connect shipment completion skipped deprecated wallet release|'
    || jsonb_build_object('source', 'buyer', 'is_connect', true, 'shipment_id', pg_temp.mu(8120))::text,
  'buyer: one INFO system log with the shipment, source and is_connect');
create table pg_temp.done as select pg_temp.sig(8120) as sig;
select is(pg_temp.confirm(8120, 'buyer', 8002), 'true:-:buyer:true', 'replay with the same key answers success, idempotent');
select is(pg_temp.confirm(8120, 'buyer', 8003) || ' ' || pg_temp.confirm(8120, 'auto', null),
  'true:-:buyer:true true:-:buyer:true',
  'a completed shipment answers its stored source as idempotent before the actor or the 48-hour rule is checked');
select is(pg_temp.sig(8120) || ' ' || (select count(*) from public.shipment_completion_events where shipment_id = pg_temp.mu(8120))
    || ' ' || (select count(*) from public.system_logs where metadata ->> 'shipment_id' = pg_temp.mu(8120)::text),
  (select sig from pg_temp.done) || ' 1 1', 'a replay writes nothing');

-- 5. Automatic completion at exactly 48 hours ---------------------------------------------------
select is(pg_temp.confirm(8113, 'auto', null), 'true:-:auto:false', 'auto: due at exactly 48 hours after delivery');
select is(pg_temp.sig(8113), 'completed|' || now() || '|-|' || now(),
  'auto: the shipment is completed and buyer_confirmed_at stays empty');
select is(pg_temp.event(8113),
  pg_temp.mu(8213) || '|auto|-|auto_completion_' || pg_temp.mu(8113) || '|' || now() || '|true',
  'auto: one completion event with source auto and no actor');
select is(pg_temp.logs(8113),
  'INFO|Connect shipment completion skipped deprecated wallet release|'
    || jsonb_build_object('source', 'auto', 'is_connect', true, 'shipment_id', pg_temp.mu(8113))::text,
  'auto: one INFO system log');

-- 6. Unexpected errors -----------------------------------------------------------------------------
-- 8122 holds a completion event that took 8121's key: the insert fails on UNIQUE(idempotency_key).
update public.shipments set status = 'completed' where id = pg_temp.mu(8122);
insert into public.shipment_completion_events (shipment_id, order_id, source, actor_id, idempotency_key, is_connect)
values (pg_temp.mu(8122), pg_temp.mu(8222), 'buyer', pg_temp.mu(8002), 'confirm_shipment_' || pg_temp.mu(8121), true);
create table pg_temp.before_err as select pg_temp.sig(8121) as sig;
select is(pg_temp.confirm(8121, 'buyer', 8002), 'false:INTERNAL_ERROR:-:false',
  'INTERNAL_ERROR when the completion event cannot be written');
select is(pg_temp.sig(8121) || ' ' || (select count(*) from public.shipment_completion_events where shipment_id = pg_temp.mu(8121)),
  (select sig from pg_temp.before_err) || ' 0', 'INTERNAL_ERROR: the shipment is unchanged and no event is written');
select is(pg_temp.logs(8121),
  'ERROR|Shipment completion RPC failed|' || jsonb_build_object('sqlstate', '23505', 'shipment_id', pg_temp.mu(8121))::text,
  'INTERNAL_ERROR: only an ERROR system log with the shipment and the SQLSTATE remains');

-- 7. shipment_completion_events constraints ---------------------------------------------------------
create function pg_temp.ev_ins(p_ship integer, p_source text, p_actor integer, p_key text) returns void language sql as $$
  insert into public.shipment_completion_events (shipment_id, order_id, source, actor_id, idempotency_key, is_connect)
  values (pg_temp.mu(p_ship), pg_temp.mu(p_ship + 100), p_source, pg_temp.mu(p_actor), p_key, true)
$$;
select throws_ok($$select pg_temp.ev_ins(8120, 'auto', null, 'second_8120')$$, '23505', null,
  'UNIQUE(shipment_id): a shipment has one completion event');
select throws_ok(format($$select pg_temp.ev_ins(8123, 'auto', null, %L)$$, 'auto_completion_' || pg_temp.mu(8113)), '23505', null,
  'UNIQUE(idempotency_key): a key is used once');
select throws_ok($$select pg_temp.ev_ins(8123, 'admin', null, 'k_8123')$$, '23514', null,
  'CHECK: the source is buyer or auto');
select throws_ok($$select pg_temp.ev_ins(8123, 'buyer', null, 'k_8123')$$, '23514', null,
  'CHECK: a buyer completion names its actor');
select throws_ok($$select pg_temp.ev_ins(8123, 'auto', 8002, 'k_8123')$$, '23514', null,
  'CHECK: an automatic completion has no actor');
select lives_ok($$select pg_temp.ev_ins(8123, 'auto', null, 'k_8123')$$, 'an automatic event without an actor is accepted');
select is((select relrowsecurity from pg_class where oid = 'public.shipment_completion_events'::regclass), true,
  'shipment_completion_events has row level security on');
select is(pg_get_indexdef('public.idx_shipments_auto_completion_due'::regclass),
  'CREATE INDEX idx_shipments_auto_completion_due ON public.shipments USING btree (delivered_at) '
    || 'WHERE ((status = ''delivered''::order_status_enum) AND (buyer_confirmed_at IS NULL) AND (delivered_at IS NOT NULL))',
  'the auto-completion due index covers delivered, unconfirmed shipments with a delivery time');
select hasnt_function('public', 'fn_confirm_delivery', array['uuid'], 'the legacy order-level fn_confirm_delivery(uuid) is gone');

select * from finish();
rollback;
