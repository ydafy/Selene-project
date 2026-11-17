-- Live notifications over a private Realtime Broadcast channel per user (#425,
-- odd/tasks/notifications-realtime-broadcast.md T1, S1 and S2). The statement-
-- level triggers on public.notifications send one private message per distinct
-- user and statement to 'user:<user_id>:notifications', event 'changed', with no
-- notification text. The SELECT policy on realtime.messages lets an
-- authenticated user read (join) only their own topic's broadcast messages;
-- Realtime sets realtime.topic before it checks the policy, as this file does.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(24);
\ir ../fixtures/money.psql

-- Users: 42001 user A, 42002 user B.
select pg_temp.money_user(n) from unnest(array[42001, 42002]) n;

create function pg_temp.topic(p_user integer) returns text language sql as $$
  select 'user:' || pg_temp.mu(p_user) || ':notifications'
$$;
-- The messages on user p_user's topic; p_op NULL counts every op.
create function pg_temp.msgs(p_user integer, p_op text default null) returns integer language sql as $$
  select count(*)::integer from realtime.messages
  where topic = pg_temp.topic(p_user) and (p_op is null or payload->>'op' = p_op)
$$;
-- Notification mu(p_n) for mu(p_user), inserted by the owner (the server path).
create function pg_temp.notify(p_n integer, p_user integer) returns void language sql as $$
  insert into public.notifications (id, user_id, type, title, message)
  values (pg_temp.mu(p_n), pg_temp.mu(p_user), 'info', 'Title ' || p_n, 'Message ' || p_n)
$$;
-- Acts as p_role ('authenticated' as mu(p_user), or 'anon') on Realtime topic p_topic.
create function pg_temp.act_as(p_role text, p_user integer, p_topic text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_role = 'anon' then '{"role": "anon"}'
      else jsonb_build_object('sub', pg_temp.mu(p_user), 'role', 'authenticated')::text end, true);
  select set_config('realtime.topic', coalesce(p_topic, ''), true);
$$;

select is(pg_temp.msgs(42001) + pg_temp.msgs(42002), 0,
  'setup: creating the users sends no notification message');

-- 1. One insert -------------------------------------------------------------------
select pg_temp.notify(42101, 42001);

select is(pg_temp.msgs(42001), 1,
  'insert: one notification sends exactly one message on its owner''s topic');
select results_eq(
  format($$select event, private, extension, payload - 'id' from realtime.messages where topic = %L$$,
    pg_temp.topic(42001)),
  $$values ('changed'::text, true, 'broadcast'::text, '{"op": "insert"}'::jsonb)$$,
  'insert: the message is a private broadcast, event changed, payload {"op": "insert"}');
select ok(not exists(select 1 from realtime.messages
    where topic = pg_temp.topic(42001) and payload ?| array['title', 'message', 'user_id']),
  'insert: the payload carries no notification text');
select is(pg_temp.msgs(42002), 0,
  'insert: another user''s topic gets nothing');

-- 2. Several rows of one user in one statement ------------------------------------
insert into public.notifications (id, user_id, type, title, message)
select pg_temp.mu(n), pg_temp.mu(42001), 'info', 'Title ' || n, 'Message ' || n
from unnest(array[42102, 42103]) n;

select is(pg_temp.msgs(42001, 'insert'), 2,
  'insert: a statement inserting two rows of one user sends one more message');

-- 3. Mark all as read, as the owner through RLS -----------------------------------
select pg_temp.act_as('authenticated', 42001, null);
set local role authenticated;
update public.notifications set read = true where user_id = pg_temp.mu(42001) and not read;
reset role;

select is((select count(*)::integer from public.notifications
    where user_id = pg_temp.mu(42001) and read), 3,
  'update: mark all as read updated the owner''s three notifications');
select is(pg_temp.msgs(42001, 'update'), 1,
  'update: marking three rows read sends exactly one message');
select results_eq(
  format($$select event, private, payload - 'id' from realtime.messages
    where topic = %L and payload->>'op' = 'update'$$, pg_temp.topic(42001)),
  $$values ('changed'::text, true, '{"op": "update"}'::jsonb)$$,
  'update: the message is private, event changed, payload {"op": "update"}');

update public.notifications set read = false where false;
select is(pg_temp.msgs(42001, 'update'), 1,
  'update: a statement that changes no row sends nothing');

-- 4. One statement for two users --------------------------------------------------
insert into public.notifications (id, user_id, type, title, message)
select pg_temp.mu(n), pg_temp.mu(u), 'info', 'Title ' || n, 'Message ' || n
from (values (42104, 42001), (42105, 42001), (42201, 42002)) v(n, u);

select is(pg_temp.msgs(42001, 'insert'), 3,
  'insert: a statement for two users sends one message to the first user');
select is(pg_temp.msgs(42002, 'insert'), 1,
  'insert: a statement for two users sends one message to the second user');

-- A presence row on A's topic, which the policy must not expose.
insert into realtime.messages (topic, extension, payload, event, private)
values (pg_temp.topic(42001), 'presence', '{}'::jsonb, 'sync', true);

-- 5. Who can read (join) which topic ---------------------------------------------
select pg_temp.act_as('authenticated', 42001, pg_temp.topic(42001));
set local role authenticated;
select is((select count(*)::integer from realtime.messages
    where topic = pg_temp.topic(42001) and extension = 'broadcast'), 4,
  'policy: user A on their own topic reads its broadcast messages');
select is((select count(*)::integer from realtime.messages
    where topic = pg_temp.topic(42001) and extension = 'presence'), 0,
  'policy: user A on their own topic reads no presence message');
reset role;

select pg_temp.act_as('authenticated', 42001, pg_temp.topic(42002));
set local role authenticated;
select is((select count(*)::integer from realtime.messages
    where topic in (pg_temp.topic(42001), pg_temp.topic(42002))), 0,
  'policy: user A on user B''s topic reads nothing');
reset role;

select pg_temp.act_as('authenticated', 42001, 'user:' || pg_temp.mu(42001) || ':other');
set local role authenticated;
select is((select count(*)::integer from realtime.messages
    where topic in (pg_temp.topic(42001), pg_temp.topic(42002))), 0,
  'policy: user A on another topic of their own id reads nothing');
reset role;

select pg_temp.act_as('authenticated', 42001, null);
set local role authenticated;
select is((select count(*)::integer from realtime.messages
    where topic in (pg_temp.topic(42001), pg_temp.topic(42002))), 0,
  'policy: user A with no topic set reads nothing');
reset role;

select pg_temp.act_as('authenticated', 42002, pg_temp.topic(42002));
set local role authenticated;
select is((select count(*)::integer from realtime.messages
    where topic = pg_temp.topic(42002)), 1,
  'policy: user B on their own topic reads their message');
reset role;

select pg_temp.act_as('anon', null, pg_temp.topic(42001));
set local role anon;
select is((select count(*)::integer from realtime.messages
    where topic in (pg_temp.topic(42001), pg_temp.topic(42002))), 0,
  'policy: anon on user A''s topic reads nothing');
reset role;

-- 6. The trigger function ---------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.fn_broadcast_notification_changes()', 'execute'),
  'function: anon cannot execute the broadcast trigger function');
select ok(not has_function_privilege('authenticated', 'public.fn_broadcast_notification_changes()', 'execute'),
  'function: authenticated cannot execute the broadcast trigger function');
select ok((select prosecdef from pg_proc where oid = 'public.fn_broadcast_notification_changes()'::regprocedure),
  'function: the broadcast trigger function is SECURITY DEFINER');
-- Each trigger as 'name:statement_level:new_table:has_when', sorted.
select is(
  (select string_agg(format('%s:%s:%s:%s', tgname, (tgtype & 1) = 0, tgnewtable is not null,
      pg_get_triggerdef(oid) like '% WHEN %'), ',' order by tgname)
    from pg_trigger where tgrelid = 'public.notifications'::regclass
      and tgfoid = 'public.fn_broadcast_notification_changes()'::regprocedure),
  'trg_notifications_broadcast_insert:t:t:f,trg_notifications_broadcast_update:t:t:f',
  'triggers: one statement-level insert and one update trigger read the new transition table, with no WHEN');
select is((select count(*)::integer from pg_policies
    where schemaname = 'realtime' and tablename = 'messages' and cmd = 'SELECT'
      and roles = '{authenticated}'), 1,
  'policy: realtime.messages has one SELECT policy, for authenticated only');

select * from finish();
rollback;
