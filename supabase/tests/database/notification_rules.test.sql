-- Notification rows (#277 T13): the event metadata CHECKs and the per-recipient
-- dedupe index, and the owner policies: a user reads and updates only their
-- own notifications. The column grants (SELECT, UPDATE of read and deleted_at)
-- are asserted in schema_invariants.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(18);
\ir ../fixtures/money.psql

select pg_temp.money_user(1311);
select pg_temp.money_user(1312);

-- 1. Event metadata CHECKs --------------------------------------------------
select throws_ok(
  $$insert into public.notifications (user_id, title, event_payload) values (pg_temp.mu(1311), 'T', '[]'::jsonb)$$,
  '23514', null, 'event_payload must be a JSON object, not an array');
select throws_ok(
  $$insert into public.notifications (user_id, title, event_payload) values (pg_temp.mu(1311), 'T', '"x"'::jsonb)$$,
  '23514', null, 'event_payload must be a JSON object, not a scalar');
select throws_ok(
  $$insert into public.notifications (user_id, title, event_kind) values (pg_temp.mu(1311), 'T', 'dispute.opened')$$,
  '23514', null, 'event_kind without source_event_key is refused');
select throws_ok(
  $$insert into public.notifications (user_id, title, source_event_key) values (pg_temp.mu(1311), 'T', 't13-rules-key')$$,
  '23514', null, 'source_event_key without event_kind is refused');
select throws_ok(
  $$insert into public.notifications (user_id, title, event_kind, source_event_key) values (pg_temp.mu(1311), 'T', 'dispute.opened', '   ')$$,
  '23514', null, 'a blank source_event_key is refused');
select throws_ok(
  $$insert into public.notifications (user_id, title, event_kind, source_event_key) values (pg_temp.mu(1311), 'T', 'order.unknown', 't13-rules-unknown')$$,
  '23514', null, 'an event_kind outside the catalogue is refused');
select lives_ok(
  $$insert into public.notifications (user_id, title) values (pg_temp.mu(1311), 'Untyped')$$,
  'an untyped row (no kind, no key, default payload) is accepted');
select is((select event_payload from public.notifications where user_id = pg_temp.mu(1311) and title = 'Untyped'),
  '{}'::jsonb, 'event_payload defaults to an empty object');

-- 2. Dedupe per recipient ---------------------------------------------------
insert into public.notifications (id, user_id, title, event_kind, source_event_key)
values (pg_temp.mu(1321), pg_temp.mu(1311), 'Typed A', 'dispute.opened', 't13-rules-dup');
select throws_ok(
  $$insert into public.notifications (user_id, title, event_kind, source_event_key) values (pg_temp.mu(1311), 'Again', 'dispute.verdict', 't13-rules-dup')$$,
  '23505', null, 'the same source_event_key for the same recipient is refused');
select lives_ok(
  $$insert into public.notifications (id, user_id, title, event_kind, source_event_key) values (pg_temp.mu(1322), pg_temp.mu(1312), 'Typed B', 'dispute.opened', 't13-rules-dup')$$,
  'the same source_event_key for another recipient is accepted');
select lives_ok(
  $$insert into public.notifications (user_id, title) values (pg_temp.mu(1311), 'Untyped'), (pg_temp.mu(1311), 'Untyped')$$,
  'rows without a source_event_key are never deduped');

-- 3. Owner policies ---------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(1311), 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*) from public.notifications where user_id in (pg_temp.mu(1311), pg_temp.mu(1312))),
  4::bigint, 'a user sees their own notifications');
select is(
  (select count(*) from public.notifications where user_id = pg_temp.mu(1312)),
  0::bigint, 'a user sees no notification of another user');
select is(
  (select count(*) from public.notifications where user_id <> pg_temp.mu(1311)),
  0::bigint, 'a user sees nothing but their own rows');

update public.notifications set read = true, deleted_at = now() where id = pg_temp.mu(1322);
update public.notifications set read = true where id = pg_temp.mu(1321);
reset role;
select is(
  (select read::text || ':' || coalesce(deleted_at::text, 'kept') from public.notifications where id = pg_temp.mu(1322)),
  'false:kept', 'updating another user''s notification changes nothing');
select is((select read from public.notifications where id = pg_temp.mu(1321)), true,
  'a user marks their own notification as read');

select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(1311), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.notifications set deleted_at = now() where id = pg_temp.mu(1321);
reset role;
select isnt((select deleted_at from public.notifications where id = pg_temp.mu(1321)), null,
  'a user deletes their own notification (soft delete)');

select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.mu(1312), 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*) from public.notifications where user_id in (pg_temp.mu(1311), pg_temp.mu(1312))),
  1::bigint, 'the other user sees only their own row');
reset role;

select * from finish();
rollback;
