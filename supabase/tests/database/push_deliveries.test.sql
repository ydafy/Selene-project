-- Push outbox (#277 T13): the push_event_policy allowlist, the fan-out trigger
-- trg_notifications_enqueue_push, fn_claim_push_deliveries (bounds, claim,
-- the 5-minute sending lease, skip reasons) and fn_record_push_results.
-- Receipts and the purge are in push_receipts.test.sql.
-- The dispatcher RPCs check auth.role() in their body; they run here as the
-- owner with service_role claims. Their grants are in function_grants.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(55);
\ir ../fixtures/money.psql

-- A token mu(p_n) of user mu(p_user): 'ExponentPushToken[t13-<p_n>]', ios.
create function pg_temp.tok(p_n integer, p_user integer) returns uuid language sql as $$
  insert into public.push_tokens (id, user_id, token, platform)
  values (pg_temp.mu(p_n), pg_temp.mu(p_user), 'ExponentPushToken[t13-' || p_n || ']', 'ios')
  returning id
$$;
-- A typed notification mu(p_n) for mu(p_user); the trigger fans it out.
create function pg_temp.typed(p_n integer, p_user integer, p_kind text, p_payload jsonb) returns uuid language sql as $$
  insert into public.notifications (id, user_id, title, message, action_path, event_kind, source_event_key, event_payload)
  values (pg_temp.mu(p_n), pg_temp.mu(p_user), 'Title ' || p_n, 'Message ' || p_n, '/p/' || p_n,
    p_kind, 't13-' || p_n, p_payload)
  returning id
$$;
-- The deliveries of notification mu(p_n): 'token:channel' sorted.
create function pg_temp.fanout(p_n integer) returns text language sql as $$
  select coalesce(string_agg(t.token || ':' || d.channel, ',' order by t.token), '')
  from public.push_deliveries d join public.push_tokens t on t.id = d.push_token_id
  where d.notification_id = pg_temp.mu(p_n)
$$;
-- Scenario s: token mu(1600+s) and notification mu(1700+s) of mu(p_user), and
-- delivery mu(1800+s), pending and due one minute ago. The notification is
-- typed without a recipient role, so the trigger adds nothing.
create function pg_temp.scenario(p_s integer, p_user integer) returns uuid language plpgsql as $$
begin
  perform pg_temp.tok(1600 + p_s, p_user);
  perform pg_temp.typed(1700 + p_s, p_user, 'dispute.opened', '{}'::jsonb);
  insert into public.push_deliveries (id, notification_id, push_token_id, user_id, channel, next_attempt_at)
  values (pg_temp.mu(1800 + p_s), pg_temp.mu(1700 + p_s), pg_temp.mu(1600 + p_s), pg_temp.mu(p_user),
    'orders', now() - interval '1 minute');
  return pg_temp.mu(1800 + p_s);
end $$;
-- status:attempts:last_error:claim_token of delivery mu(1800+s).
create function pg_temp.dstate(p_s integer) returns text language sql as $$
  select status || ':' || attempts || ':' || coalesce(last_error, '-') || ':' || coalesce(claim_token::text, '-')
  from public.push_deliveries where id = pg_temp.mu(1800 + p_s)
$$;
create function pg_temp.ids(p_s integer[]) returns text language sql as $$
  select string_agg(pg_temp.mu(1800 + s)::text, ',' order by pg_temp.mu(1800 + s)) from unnest(p_s) as s
$$;
create function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "service_role"}', true)
$$;

select pg_temp.money_user(n) from generate_series(1331, 1333) as n;
update public.profiles set deleted_at = now() where id = pg_temp.mu(1333);
-- Claims scan the whole outbox; start from an empty one.
delete from public.push_deliveries;

-- 1. push_event_policy ------------------------------------------------------
select is(
  (select string_agg(event_kind || '/' || recipient_role || '/' || channel, ',' order by event_kind, recipient_role)
   from public.push_event_policy),
  'dispute.opened/seller/orders,dispute.verdict/buyer/orders,dispute.verdict/seller/orders,'
  || 'order.payment_confirmed/seller/orders,product.approved/seller/orders,'
  || 'product.approved_with_note/seller/orders,product.available/buyer/activity,'
  || 'product.interest/seller/activity,product.rejected/seller/orders,return.delivered/buyer/orders,'
  || 'return.delivered/seller/orders,return.seller_evidence_submitted/buyer/orders,'
  || 'shipment.cancelled/buyer/orders,shipment.cancelled/seller/orders,shipment.delivered/buyer/orders,'
  || 'shipment.funds_released/seller/orders,shipment.in_transit/buyer/orders,'
  || 'shipment.label_deadline/seller/orders,shipment.refund_failed/buyer/orders,shipment.refunded/buyer/orders',
  'push_event_policy holds exactly the allowlist matrix');
select is_empty(
  $$select 1 from public.push_event_policy where event_kind = 'order.payment_confirmed' and recipient_role = 'buyer'$$,
  'order.payment_confirmed is never pushed to the buyer');
select throws_ok(
  $$insert into public.push_event_policy values ('dispute.opened', 'admin', 'orders')$$,
  '23514', null, 'push_event_policy: the recipient role is buyer or seller');
select throws_ok(
  $$insert into public.push_event_policy values ('dispute.opened', 'buyer', 'email')$$,
  '23514', null, 'push_event_policy: the channel is orders or activity');

-- 2. Fan-out trigger --------------------------------------------------------
select pg_temp.tok(1401, 1331);
select pg_temp.tok(1402, 1331);
select pg_temp.tok(1403, 1331);
update public.push_tokens set disabled_at = now() where id = pg_temp.mu(1403);
select pg_temp.tok(1404, 1333);
select pg_temp.tok(1405, 1332);

select pg_temp.typed(1501, 1331, 'order.payment_confirmed', '{"recipient_role": "seller"}');
select is(pg_temp.fanout(1501),
  'ExponentPushToken[t13-1401]:orders,ExponentPushToken[t13-1402]:orders',
  'fan-out: one delivery per active token of the recipient, on the policy channel');
select is(
  (select string_agg(status || ':' || attempts || ':' || (user_id = pg_temp.mu(1331))::text || ':'
     || (next_attempt_at = now())::text || ':' || coalesce(claim_token::text, '-'), ',')
   from public.push_deliveries where notification_id = pg_temp.mu(1501)),
  'pending:0:true:true:-,pending:0:true:true:-', 'fan-out: deliveries start pending, due now, for the recipient');
select pg_temp.typed(1502, 1331, 'order.payment_confirmed', '{"recipient_role": "buyer"}');
select is(pg_temp.fanout(1502), '', 'fan-out: a recipient role outside the allowlist gets nothing');
select pg_temp.typed(1503, 1331, 'shipment.delivered', '{"recipient_role": "seller"}');
select is(pg_temp.fanout(1503), '', 'fan-out: an allowlisted kind for another role gets nothing');
select pg_temp.typed(1504, 1331, 'product.available', '{"recipient_role": "buyer"}');
select is(pg_temp.fanout(1504),
  'ExponentPushToken[t13-1401]:activity,ExponentPushToken[t13-1402]:activity',
  'fan-out: the channel comes from the policy row');
select pg_temp.typed(1505, 1333, 'order.payment_confirmed', '{"recipient_role": "seller"}');
select is(pg_temp.fanout(1505), '', 'fan-out: a closed account gets nothing');
select lives_ok(
  $$select pg_temp.typed(1506, 1332, 'order.payment_confirmed', '{}')$$,
  'fan-out: a typed row without a recipient role never fails the producer');
select is(pg_temp.fanout(1506), '', 'fan-out: a typed row without a recipient role gets nothing');
select throws_ok(
  $$insert into public.push_deliveries (notification_id, push_token_id, user_id, channel)
    values (pg_temp.mu(1501), pg_temp.mu(1401), pg_temp.mu(1331), 'orders')$$,
  '23505', null, 'push_deliveries: one row per notification and token');

-- 3. fn_claim_push_deliveries: refusals -------------------------------------
delete from public.push_deliveries;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select * from public.fn_claim_push_deliveries(10)$$,
  'P0001', 'UNAUTHORIZED', 'claim: a caller other than service_role raises UNAUTHORIZED');
select pg_temp.service();
select throws_ok($$select * from public.fn_claim_push_deliveries(0)$$,
  'P0001', 'INVALID_PUSH_CLAIM_LIMIT', 'claim: a limit of 0 is refused');
select throws_ok($$select * from public.fn_claim_push_deliveries(501)$$,
  'P0001', 'INVALID_PUSH_CLAIM_LIMIT', 'claim: a limit of 501 is refused');
select throws_ok($$select * from public.fn_claim_push_deliveries(null)$$,
  'P0001', 'INVALID_PUSH_CLAIM_LIMIT', 'claim: a NULL limit is refused');
select lives_ok($$select * from public.fn_claim_push_deliveries(500)$$, 'claim: a limit of 500 is accepted');
select throws_ok($$select * from public.fn_claim_push_deliveries(10, null)$$,
  'P0001', 'INVALID_PUSH_CLAIM_MAX_AGE', 'claim: a NULL max age is refused');
select throws_ok($$select * from public.fn_claim_push_deliveries(10, interval '0')$$,
  'P0001', 'INVALID_PUSH_CLAIM_MAX_AGE', 'claim: a zero max age is refused');
select throws_ok($$select * from public.fn_claim_push_deliveries(10, interval '-1 hour')$$,
  'P0001', 'INVALID_PUSH_CLAIM_MAX_AGE', 'claim: a negative max age is refused');

-- 4. fn_claim_push_deliveries: selection and skips --------------------------
select pg_temp.scenario(s, case when s = 11 then 1333 else 1331 end) from generate_series(1, 13) as s;
-- s1 due; s2 due in one second; s13 due exactly now.
update public.push_deliveries set next_attempt_at = now() + interval '1 second' where id = pg_temp.mu(1802);
update public.push_deliveries set next_attempt_at = now() where id = pg_temp.mu(1813);
-- s3 sending, lease taken 5 minutes ago; s4 4m59s ago; s12 sending with 5 attempts.
update public.push_deliveries set status = 'sending', attempts = 1, claim_token = pg_temp.mu(1903),
  claimed_at = now() - interval '5 minutes' where id = pg_temp.mu(1803);
update public.push_deliveries set status = 'sending', attempts = 1, claim_token = pg_temp.mu(1904),
  claimed_at = now() - interval '4 minutes 59 seconds' where id = pg_temp.mu(1804);
update public.push_deliveries set status = 'sending', attempts = 5, claim_token = pg_temp.mu(1912),
  claimed_at = now() - interval '10 minutes', last_error = 'previous' where id = pg_temp.mu(1812);
update public.notifications set read = true where id = pg_temp.mu(1705);
update public.notifications set deleted_at = now() where id = pg_temp.mu(1706);
update public.notifications set created_at = now() - interval '6 hours 1 second' where id = pg_temp.mu(1707);
update public.notifications set created_at = now() - interval '6 hours' where id = pg_temp.mu(1708);
update public.push_tokens set user_id = pg_temp.mu(1332) where id = pg_temp.mu(1609);
update public.push_tokens set disabled_at = now() where id = pg_temp.mu(1610);

select pg_temp.service();
create temp table t13_claim as select * from public.fn_claim_push_deliveries(100);

select is((select string_agg(delivery_id::text, ',' order by delivery_id) from t13_claim),
  pg_temp.ids(array[1, 3, 8, 13]),
  'claim: returns due pending rows (next_attempt_at <= now), stale leases and rows exactly 6 hours old');
select is(
  (select expo_token || '|' || platform || '|' || channel || '|' || title || '|' || message || '|'
     || action_path || '|' || (notification_id = pg_temp.mu(1701))::text || '|' || event_kind
   from t13_claim where delivery_id = pg_temp.mu(1801)),
  'ExponentPushToken[t13-1601]|ios|orders|Title 1701|Message 1701|/p/1701|true|dispute.opened',
  'claim: returns the token, platform, channel and notification content');
select is(pg_temp.dstate(1),
  'sending:1:-:' || (select claim_token::text from t13_claim where delivery_id = pg_temp.mu(1801)),
  'claim: the row is sending with one attempt and the returned claim token');
select is((select claimed_at from public.push_deliveries where id = pg_temp.mu(1801)), now(),
  'claim: claimed_at is the claim time');
select is(
  (select attempts || ':' || (claim_token <> pg_temp.mu(1903))::text || ':' || (claimed_at = now())::text || ':'
     || (claim_token = (select c.claim_token from t13_claim c where c.delivery_id = pg_temp.mu(1803)))::text
   from public.push_deliveries where id = pg_temp.mu(1803)),
  '2:true:true:true', 'claim: a sending row whose 5-minute lease expired is claimed again with a new token');
select is(pg_temp.dstate(2), 'pending:0:-:-', 'claim: a row due in the future is left alone');
select is(pg_temp.dstate(4), 'sending:1:-:' || pg_temp.mu(1904), 'claim: a sending row inside its lease is left alone');
select is(pg_temp.dstate(5), 'skipped:0:notification_read:-', 'claim: a read notification is skipped');
select is(pg_temp.dstate(6), 'skipped:0:notification_deleted:-', 'claim: a deleted notification is skipped');
select is(pg_temp.dstate(7), 'skipped:0:expired:-', 'claim: a notification older than the max age is skipped');
select is(pg_temp.dstate(9), 'skipped:0:token_reassigned:-', 'claim: a token that moved to another user is skipped');
select is(pg_temp.dstate(10), 'skipped:0:token_disabled:-', 'claim: a disabled token is skipped');
select is(pg_temp.dstate(11), 'skipped:0:account_closed:-', 'claim: a closed account is skipped');
select is(pg_temp.dstate(12), 'failed:5:attempts_exhausted:-', 'claim: a stale sending row with 5 attempts fails');

-- Limit, order and the max age argument.
delete from public.push_deliveries;
select pg_temp.scenario(s, 1331) from generate_series(21, 24) as s;
-- s21 due 3 minutes ago, s22 2 minutes ago, s23 and s24 1 minute ago; the
-- notification of s24 is 2 hours old.
update public.push_deliveries set next_attempt_at = now() - interval '3 minutes' where id = pg_temp.mu(1821);
update public.push_deliveries set next_attempt_at = now() - interval '2 minutes' where id = pg_temp.mu(1822);
update public.push_deliveries set created_at = now() + interval '1 second' where id = pg_temp.mu(1824);
update public.notifications set created_at = now() - interval '2 hours' where id = pg_temp.mu(1724);
select pg_temp.service();
select is((select string_agg(delivery_id::text, ',' order by delivery_id) from public.fn_claim_push_deliveries(2)),
  pg_temp.ids(array[21, 22]), 'claim: the limit takes the oldest next_attempt_at first');
select is(pg_temp.dstate(23) || ',' || pg_temp.dstate(24), 'pending:0:-:-,pending:0:-:-',
  'claim: rows past the limit stay pending');
select pg_temp.service();
select is((select string_agg(delivery_id::text, ',') from public.fn_claim_push_deliveries(10, interval '1 hour')),
  pg_temp.ids(array[23]), 'claim: the max age argument replaces the 6-hour default');
select is(pg_temp.dstate(24), 'skipped:0:expired:-', 'claim: a row older than the given max age is skipped');

-- 5. fn_record_push_results -------------------------------------------------
delete from public.push_deliveries;
select pg_temp.scenario(s, 1331) from generate_series(31, 40) as s;
update public.push_deliveries d set status = 'sending', claim_token = pg_temp.mu(1900 + s.n), claimed_at = now(),
  attempts = s.att
from (values (31, 1), (32, 1), (33, 2), (34, 3), (35, 5), (36, 1), (37, 1), (38, 1), (40, 1)) as s(n, att)
where d.id = pg_temp.mu(1800 + s.n);
update public.push_deliveries set claim_token = pg_temp.mu(1939) where id = pg_temp.mu(1839);

create function pg_temp.res(p_s integer, p_outcome text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.mu(1800 + p_s), 'claim_token', pg_temp.mu(1900 + p_s), 'outcome', p_outcome) || p_extra
$$;

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select public.fn_record_push_results('[]')$$,
  'P0001', 'UNAUTHORIZED', 'results: a caller other than service_role raises UNAUTHORIZED');
select pg_temp.service();
select throws_like($$select public.fn_record_push_results('{}')$$,
  'INVALID_PUSH_RESULTS%', 'results: a non-array batch is refused');
select throws_like($$select public.fn_record_push_results(null)$$,
  'INVALID_PUSH_RESULTS%', 'results: a NULL batch is refused');
select throws_like($$select public.fn_record_push_results(jsonb_build_array(pg_temp.res(31, 'sent', '{"ticket_id": "t"}') - 'claim_token'))$$,
  'INVALID_PUSH_RESULTS%', 'results: an item without claim_token is refused');
select throws_like($$select public.fn_record_push_results(jsonb_build_array(pg_temp.res(31, 'done')))$$,
  'INVALID_PUSH_RESULTS%', 'results: an unknown outcome is refused');
select throws_like($$select public.fn_record_push_results(jsonb_build_array(pg_temp.res(31, 'sent')))$$,
  'INVALID_PUSH_RESULTS%', 'results: sent without a ticket_id is refused');
select throws_like($$select public.fn_record_push_results(jsonb_build_array(pg_temp.res(36, 'failed', '{"token_dead": "yes"}')))$$,
  'INVALID_PUSH_RESULTS%', 'results: a non-boolean token_dead is refused');
select throws_like($$select public.fn_record_push_results(jsonb_build_array(pg_temp.res(36, 'retry', '{"token_dead": true}')))$$,
  'INVALID_PUSH_RESULTS%', 'results: token_dead with an outcome other than failed is refused');
select throws_like(
  $$select public.fn_record_push_results(jsonb_build_array(pg_temp.res(31, 'sent', '{"ticket_id": "t"}'),
    pg_temp.res(32, 'sent', '{"ticket_id": "t"}') || '{"id": "not-a-uuid"}'))$$,
  'INVALID_PUSH_RESULTS%', 'results: the whole batch is validated before any row is processed');
select is(pg_temp.dstate(31), 'sending:1:-:' || pg_temp.mu(1931), 'results: a refused batch changes nothing');

select is(
  public.fn_record_push_results(jsonb_build_array(
    pg_temp.res(31, 'sent', '{"ticket_id": "ticket-31"}'),
    pg_temp.res(32, 'retry', '{"error": "e32"}'),
    pg_temp.res(33, 'retry', '{"error": "e33"}'),
    pg_temp.res(34, 'retry', '{"error": "e34"}'),
    pg_temp.res(35, 'retry', '{"error": "e35"}'),
    pg_temp.res(36, 'failed', '{"error": "DeviceNotRegistered-36", "token_dead": true}'),
    pg_temp.res(37, 'failed', '{"token_dead": true}'),
    pg_temp.res(38, 'sent', '{"ticket_id": "ticket-38"}') || jsonb_build_object('claim_token', pg_temp.mu(1999)),
    pg_temp.res(39, 'sent', '{"ticket_id": "ticket-39"}'),
    pg_temp.res(40, 'failed', '{"error": "e40", "token_dead": false}'))),
  '{"sent": 1, "retry": 3, "failed": 4, "ignored": 2}'::jsonb,
  'results: returns the count per outcome and the ignored stale claims');
select is(
  (select pg_temp.dstate(31) || ':' || expo_ticket_id || ':' || (sent_at = now())::text || ':' || coalesce(claimed_at::text, '-')
   from public.push_deliveries where id = pg_temp.mu(1831)),
  'sent:1:-:-:ticket-31:true:-', 'results: sent stores the ticket and the send time and drops the claim');
select is(
  (select string_agg(pg_temp.dstate(s) || ':' || (d.next_attempt_at - now())::text, ',' order by s)
   from generate_series(32, 34) as s join public.push_deliveries d on d.id = pg_temp.mu(1800 + s)),
  'pending:1:e32:-:00:01:00,pending:2:e33:-:00:05:00,pending:3:e34:-:00:15:00',
  'results: retry goes back to pending after 1, 5 and 15 minutes');
select is(pg_temp.dstate(35), 'failed:5:e35:-', 'results: retry after the fifth attempt fails the row');
select is(
  (select string_agg(pg_temp.dstate(s) || ':' || coalesce(t.disabled_reason, 'active') || ':'
     || coalesce((t.disabled_at = now())::text, '-'), ',' order by s)
   from unnest(array[36, 37, 40]) as s join public.push_tokens t on t.id = pg_temp.mu(1600 + s)),
  'failed:1:DeviceNotRegistered-36:-:DeviceNotRegistered-36:true,failed:1:-:-:DeviceNotRegistered:true,failed:1:e40:-:active:-',
  'results: a dead token is disabled with the error as reason, DeviceNotRegistered by default');
select is(pg_temp.dstate(38) || ',' || pg_temp.dstate(39),
  'sending:1:-:' || pg_temp.mu(1938) || ',pending:0:-:' || pg_temp.mu(1939),
  'results: a wrong claim token or a row that is not sending is left alone');

select * from finish();
rollback;
