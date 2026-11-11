-- Push receipts and outbox purge (#277 T13): fn_list_push_receipts_due (limit,
-- the 15-minute rule, order), fn_record_push_receipts (batch validated first,
-- records once, missing only after 1 hour, a dead device disables its token
-- unless it registered again after the send) and fn_purge_push_deliveries
-- (limit, only finished rows older than 30 days, oldest first).
-- The RPCs check auth.role() in their body; they run here as the owner with
-- service_role claims. Their grants are in function_grants.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(37);
\ir ../fixtures/money.psql

-- Scenario s of mu(1341): token mu(2600+s), notification mu(2700+s) typed
-- without a recipient role (no fan-out) and delivery mu(2800+s), sent 20
-- minutes ago with ticket 'tk-<s>'.
create function pg_temp.scenario(p_s integer) returns uuid language plpgsql as $$
begin
  insert into public.push_tokens (id, user_id, token, platform, updated_at)
  values (pg_temp.mu(2600 + p_s), pg_temp.mu(1341), 'ExponentPushToken[t13-r' || p_s || ']', 'ios', now() - interval '1 day');
  insert into public.notifications (id, user_id, title, event_kind, source_event_key)
  values (pg_temp.mu(2700 + p_s), pg_temp.mu(1341), 'Title', 'dispute.opened', 't13-r' || p_s);
  insert into public.push_deliveries (id, notification_id, push_token_id, user_id, channel, status, attempts,
    expo_ticket_id, sent_at, updated_at)
  values (pg_temp.mu(2800 + p_s), pg_temp.mu(2700 + p_s), pg_temp.mu(2600 + p_s), pg_temp.mu(1341), 'orders',
    'sent', 1, 'tk-' || p_s, now() - interval '20 minutes', now() - interval '20 minutes');
  return pg_temp.mu(2800 + p_s);
end $$;
create function pg_temp.did(p_s integer) returns uuid language sql as $$ select pg_temp.mu(2800 + p_s) $$;
-- '<delivery id>=tk-<s>' for each s, in the given order.
create function pg_temp.due(p_s integer[]) returns text language sql as $$
  select string_agg(pg_temp.did(s)::text || '=tk-' || s, ',' order by o) from unnest(p_s) with ordinality as u(s, o)
$$;
create function pg_temp.listed(p_limit integer) returns text language sql as $$
  select string_agg(delivery_id::text || '=' || ticket_id, ',' order by o)
  from public.fn_list_push_receipts_due(p_limit) with ordinality as r(delivery_id, ticket_id, o)
$$;
-- receipt_status:receipt_error:checked_now of delivery s.
create function pg_temp.receipt(p_s integer) returns text language sql as $$
  select coalesce(receipt_status, '-') || ':' || coalesce(receipt_error, '-') || ':'
    || coalesce((receipt_checked_at = now())::text, '-')
  from public.push_deliveries where id = pg_temp.did(p_s)
$$;
create function pg_temp.token_state(p_s integer) returns text language sql as $$
  select coalesce(disabled_reason, 'active') || ':' || coalesce((disabled_at = now())::text, '-')
  from public.push_tokens where id = pg_temp.mu(2600 + p_s)
$$;
create function pg_temp.rec(p_s integer, p_receipt text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.did(p_s), 'receipt', p_receipt) || p_extra
$$;
create function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "service_role"}', true)
$$;

select pg_temp.money_user(1341);
-- The RPCs scan the whole outbox; start from an empty one.
delete from public.push_deliveries;

-- 1. fn_list_push_receipts_due ----------------------------------------------
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select * from public.fn_list_push_receipts_due(10)$$,
  'P0001', 'UNAUTHORIZED', 'receipts due: a caller other than service_role raises UNAUTHORIZED');
select pg_temp.service();
select throws_ok($$select * from public.fn_list_push_receipts_due(0)$$,
  'P0001', 'INVALID_PUSH_RECEIPT_LIMIT', 'receipts due: a limit of 0 is refused');
select throws_ok($$select * from public.fn_list_push_receipts_due(1001)$$,
  'P0001', 'INVALID_PUSH_RECEIPT_LIMIT', 'receipts due: a limit of 1001 is refused');
select throws_ok($$select * from public.fn_list_push_receipts_due(null)$$,
  'P0001', 'INVALID_PUSH_RECEIPT_LIMIT', 'receipts due: a NULL limit is refused');
select lives_ok($$select * from public.fn_list_push_receipts_due(1000)$$,
  'receipts due: a limit of 1000 is accepted');

select pg_temp.scenario(s) from generate_series(1, 8) as s;
update public.push_deliveries set sent_at = now() - interval '15 minutes' where id = pg_temp.did(1);
update public.push_deliveries set sent_at = now() - interval '14 minutes 59 seconds' where id = pg_temp.did(2);
update public.push_deliveries set sent_at = now() - interval '1 hour', receipt_checked_at = now() - interval '15 minutes'
where id = pg_temp.did(3);
update public.push_deliveries set sent_at = now() - interval '2 hours', receipt_checked_at = now() - interval '14 minutes 59 seconds'
where id = pg_temp.did(4);
update public.push_deliveries set sent_at = now() - interval '1 hour', receipt_status = 'ok' where id = pg_temp.did(5);
update public.push_deliveries set sent_at = now() - interval '1 hour', status = 'failed' where id = pg_temp.did(6);
update public.push_deliveries set sent_at = now() - interval '1 hour', expo_ticket_id = null where id = pg_temp.did(7);
update public.push_deliveries set sent_at = now() - interval '30 minutes' where id = pg_temp.did(8);

select pg_temp.service();
select is(pg_temp.listed(1000), pg_temp.due(array[8, 1, 3]),
  'receipts due: sent tickets 15 minutes old with no receipt, unchecked first, then by send time');
select is(pg_temp.listed(2), pg_temp.due(array[8, 1]), 'receipts due: the limit keeps the first rows');

-- 2. fn_record_push_receipts ------------------------------------------------
delete from public.push_deliveries;
select pg_temp.scenario(s) from generate_series(11, 19) as s;
update public.push_deliveries set sent_at = now() - interval '59 minutes 59 seconds' where id = pg_temp.did(13);
update public.push_deliveries set sent_at = now() - interval '1 hour' where id = pg_temp.did(14);
update public.push_deliveries set receipt_status = 'ok' where id = pg_temp.did(15);
update public.push_deliveries set status = 'failed' where id = pg_temp.did(16);
update public.push_tokens set updated_at = now() where id = pg_temp.mu(2618);
update public.push_tokens set updated_at = now() - interval '20 minutes' where id = pg_temp.mu(2619);

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select public.fn_record_push_receipts('[]')$$,
  'P0001', 'UNAUTHORIZED', 'record receipts: a caller other than service_role raises UNAUTHORIZED');
select pg_temp.service();
select throws_like($$select public.fn_record_push_receipts('{}')$$,
  'INVALID_PUSH_RECEIPTS%', 'record receipts: a non-array batch is refused');
select throws_like($$select public.fn_record_push_receipts(null)$$,
  'INVALID_PUSH_RECEIPTS%', 'record receipts: a NULL batch is refused');
select throws_like($$select public.fn_record_push_receipts('[{"receipt": "ok"}]')$$,
  'INVALID_PUSH_RECEIPTS%', 'record receipts: an item without id is refused');
select throws_like($$select public.fn_record_push_receipts(jsonb_build_array(pg_temp.rec(11, 'done')))$$,
  'INVALID_PUSH_RECEIPTS%', 'record receipts: an unknown receipt is refused');
select throws_like($$select public.fn_record_push_receipts(jsonb_build_array(pg_temp.rec(17, 'error', '{"token_dead": "yes"}')))$$,
  'INVALID_PUSH_RECEIPTS%', 'record receipts: a non-boolean token_dead is refused');
select throws_like($$select public.fn_record_push_receipts(jsonb_build_array(pg_temp.rec(11, 'ok', '{"token_dead": true}')))$$,
  'INVALID_PUSH_RECEIPTS%', 'record receipts: token_dead with a receipt other than error is refused');
select throws_like(
  $$select public.fn_record_push_receipts(jsonb_build_array(pg_temp.rec(11, 'ok'), '{"id": "not-a-uuid", "receipt": "ok"}'::jsonb))$$,
  'INVALID_PUSH_RECEIPTS%', 'record receipts: the whole batch is validated before any row is processed');
select is(pg_temp.receipt(11), '-:-:-', 'record receipts: a refused batch changes nothing');

select is(
  public.fn_record_push_receipts(jsonb_build_array(
    pg_temp.rec(11, 'ok'),
    pg_temp.rec(12, 'error', '{"error": "MessageTooBig"}'),
    pg_temp.rec(13, 'missing'),
    pg_temp.rec(14, 'missing'),
    pg_temp.rec(15, 'error', '{"error": "late"}'),
    pg_temp.rec(16, 'ok'),
    jsonb_build_object('id', pg_temp.mu(2999), 'receipt', 'ok'),
    pg_temp.rec(17, 'error', '{"error": "Dead17", "token_dead": true}'),
    pg_temp.rec(18, 'error', '{"error": "Dead18", "token_dead": true}'),
    pg_temp.rec(19, 'error', '{"token_dead": true}'))),
  '{"ok": 1, "error": 4, "missing": 1, "pending": 1, "ignored": 3, "tokens_disabled": 2}'::jsonb,
  'record receipts: returns the count per outcome, the ignored rows and the disabled tokens');
select is(pg_temp.receipt(11), 'ok:-:true', 'record receipts: ok is stored with the check time');
select is(pg_temp.receipt(12), 'error:MessageTooBig:true', 'record receipts: error is stored with its code');
select is(pg_temp.receipt(13), '-:-:true', 'record receipts: missing before 1 hour stays due, with the check time');
select is(pg_temp.receipt(14), 'missing:-:true', 'record receipts: missing 1 hour after sending is stored');
select is(pg_temp.receipt(15) || ',' || pg_temp.receipt(16), 'ok:-:-,-:-:-',
  'record receipts: a row that already has a receipt or is not sent is left alone');
select is(pg_temp.token_state(17), 'Dead17:true', 'record receipts: a dead device disables its token with the error as reason');
select is(pg_temp.token_state(18) || ',' || pg_temp.receipt(18), 'active:-,error:Dead18:true',
  'record receipts: a token registered again after the send stays active');
select is(pg_temp.token_state(19), 'DeviceNotRegistered:true',
  'record receipts: a token last registered 20 minutes ago (at the send) is disabled, DeviceNotRegistered by default');
select is(pg_temp.token_state(12), 'active:-', 'record receipts: an error without token_dead keeps the token');

select pg_temp.service();
select is(public.fn_record_push_receipts(jsonb_build_array(pg_temp.rec(11, 'error', '{"error": "x"}'))),
  '{"ok": 0, "error": 0, "missing": 0, "pending": 0, "ignored": 1, "tokens_disabled": 0}'::jsonb,
  'record receipts: a second receipt for the same row is ignored');
select is(pg_temp.receipt(11), 'ok:-:true', 'record receipts: the first receipt is kept');

-- 3. fn_purge_push_deliveries -----------------------------------------------
delete from public.push_deliveries;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select public.fn_purge_push_deliveries(10)$$,
  'P0001', 'UNAUTHORIZED', 'purge: a caller other than service_role raises UNAUTHORIZED');
select pg_temp.service();
select throws_ok($$select public.fn_purge_push_deliveries(0)$$,
  'P0001', 'INVALID_PUSH_PURGE_LIMIT', 'purge: a limit of 0 is refused');
select throws_ok($$select public.fn_purge_push_deliveries(10001)$$,
  'P0001', 'INVALID_PUSH_PURGE_LIMIT', 'purge: a limit of 10001 is refused');
select throws_ok($$select public.fn_purge_push_deliveries(null)$$,
  'P0001', 'INVALID_PUSH_PURGE_LIMIT', 'purge: a NULL limit is refused');
select lives_ok($$select public.fn_purge_push_deliveries(10000)$$, 'purge: a limit of 10000 is accepted');

select pg_temp.scenario(s) from generate_series(31, 37) as s;
update public.push_deliveries d set status = v.status, updated_at = now() - v.age
from (values
  (31, 'sent', interval '30 days 1 second'), (32, 'failed', interval '31 days'), (33, 'skipped', interval '32 days'),
  (34, 'pending', interval '40 days'), (35, 'sending', interval '40 days'), (36, 'sent', interval '30 days'),
  (37, 'sent', interval '1 day')) as v(s, status, age)
where d.id = pg_temp.did(v.s);

create function pg_temp.left_ids() returns text language sql as $$
  select string_agg(id::text, ',' order by id) from public.push_deliveries
$$;
create function pg_temp.ids(p_s integer[]) returns text language sql as $$
  select string_agg(pg_temp.did(s)::text, ',' order by pg_temp.did(s)) from unnest(p_s) as s
$$;

select pg_temp.service();
select is(public.fn_purge_push_deliveries(2), 2, 'purge: deletes at most the limit');
select is(pg_temp.left_ids(), pg_temp.ids(array[31, 34, 35, 36, 37]), 'purge: the oldest finished rows go first');
select pg_temp.service();
select is(public.fn_purge_push_deliveries(100), 1, 'purge: returns the number of rows deleted');
select is(pg_temp.left_ids(), pg_temp.ids(array[34, 35, 36, 37]),
  'purge: pending, sending and rows exactly 30 days old or younger are kept');

select * from finish();
rollback;
