-- Connect account state (#277 T10). The per-account refresh generation:
-- fn_acquire_connect_account_refresh opens a pending refresh that fails closed,
-- fn_commit_connect_account_refresh accepts only the current generation and
-- rebuilds the gate from the bank snapshot (the blocked external-account
-- statuses), and fn_get_connect_account_actionability hides a pending bit and
-- defaults an account without a row to actionable. connect_account_events is
-- append-only evidence keyed by the Stripe event id. Run projection onto payout
-- runs lives in payout_resume_actionability_account.test.sql; table and
-- function grants live in profile_grants.test.sql and function_grants.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(26);

create function pg_temp.rec(p_acct text, p_evt text, p_bank text default null) returns boolean language sql as $$
  select public.fn_record_connect_account_event(p_evt, p_acct, 'account.updated', now(), null, null, p_bank)
$$;

-- generation:pending:is_actionable:blocked_reason:source_event:current bank:observed
create function pg_temp.acct_row(p_acct text) returns text language sql as $$
  select refresh_generation || ':' || refresh_pending || ':' || is_actionable || ':'
    || coalesce(blocked_reason, '-') || ':' || coalesce(source_event_id, '-') || ':'
    || coalesce(current_external_account_id, '-') || ':' || (current_observed_at is not null)
  from public.connect_account_actionability where stripe_account_id = p_acct
$$;
create function pg_temp.acct_json(p_acct text) returns jsonb language sql as $$
  select to_jsonb(c) from public.connect_account_actionability c where stripe_account_id = p_acct
$$;

-- is_actionable:blocked_reason as the payout worker reads them.
create function pg_temp.gate(p_acct text) returns text language sql as $$
  select g.is_actionable || ':' || coalesce(g.blocked_reason, '-')
  from public.fn_get_connect_account_actionability(p_acct) g
$$;

-- A commit with one MXN default bank in p_status.
create function pg_temp.commit_bank(
  p_acct text, p_generation bigint, p_evt text, p_actionable boolean, p_reason text, p_status text
) returns boolean language sql as $$
  select public.fn_commit_connect_account_refresh(p_acct, p_generation, p_evt, p_actionable, p_reason, true,
    'ba_t10default', p_status, 'mxn', true, 1)
$$;

-- A blocked commit for p_status, then the gate: 'error <message>' if it raised.
create function pg_temp.commit_blocked(p_acct text, p_evt text, p_status text) returns text language plpgsql as $$
begin
  return pg_temp.commit_bank(p_acct, 1, p_evt, false, p_status, p_status) || '|' || pg_temp.gate(p_acct);
exception when others then
  return 'error ' || sqlerrm;
end $$;

-- 1. Evidence: idempotent by Stripe event id, append-only ----------------------
select is(pg_temp.rec('acct_t10main', 'evt_t10m1', 'ba_t10bank'), true, 'events: an account event is recorded');
select is(
  (select external_account_id from public.connect_account_events where stripe_event_id = 'evt_t10m1'),
  'ba_t10bank', 'events: the external bank account id is stored with the event');
select pg_temp.rec('acct_t10main', 'evt_t10m2');
select pg_temp.rec('acct_t10del', 'evt_t10d1');
select throws_ok($$select pg_temp.rec('acct_t10other', 'evt_t10m1')$$,
  'P0001', 'ACCOUNT_EVENT_IDENTITY_MISMATCH', 'events: an event id already bound to another account is refused');
select throws_ok(
  $$insert into public.connect_account_events (stripe_event_id, stripe_account_id, event_type, stripe_created)
    values ('evt_t10m1', 'acct_t10main', 'account.updated', now())$$,
  '23505', null, 'events: stripe_event_id is unique');
select throws_ok(
  $$update public.connect_account_events set external_account_id = 'ba_t10other' where stripe_event_id = 'evt_t10m1'$$,
  'P0001', 'connect_account_events is append-only and immutable', 'events: an update is refused');
select throws_ok(
  $$delete from public.connect_account_events where stripe_event_id = 'evt_t10d1'$$,
  'P0001', 'connect_account_events is append-only and immutable', 'events: a delete is refused');

-- 2. Both tables keep RLS on with no policy, so a client reads no row even if a
-- grant appeared (the missing grants are asserted in profile_grants.test.sql).
select is(
  (select array_agg(relrowsecurity order by relname) from pg_class
   where oid in ('public.connect_account_actionability'::regclass, 'public.connect_account_events'::regclass)),
  array[true, true], 'rls: enabled on connect_account_actionability and connect_account_events');
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public'
   and tablename in ('connect_account_actionability', 'connect_account_events')),
  0, 'rls: neither table has a policy');

-- 3. An account without a row is actionable --------------------------------------
select is(pg_temp.gate('acct_t10none'), 'true:-', 'gate: an account without evidence is actionable by default');

-- 4. Acquisition opens a new pending generation that fails closed -----------------
create table pg_temp.gen as select public.fn_acquire_connect_account_refresh('acct_t10main', 'evt_t10m1') as g;
select is((select g from pg_temp.gen) || '|' || pg_temp.acct_row('acct_t10main'),
  '1|1:true:false:account_refresh_pending:evt_t10m1:-:false',
  'acquire: the first refresh is generation 1, pending and not actionable');
select is(pg_temp.commit_bank('acct_t10main', 1, 'evt_t10m1', true, null, 'verified'), true,
  'commit: the current generation is accepted');
select is(pg_temp.acct_row('acct_t10main'), '1:false:true:-:evt_t10m1:ba_t10default:true',
  'commit: the snapshot is stored and the refresh is no longer pending');
select is(pg_temp.gate('acct_t10main'), 'true:-', 'gate: an accepted healthy refresh is actionable');
update pg_temp.gen set g = public.fn_acquire_connect_account_refresh('acct_t10main', 'evt_t10m2');
select is((select g from pg_temp.gen) || '|' || pg_temp.acct_row('acct_t10main'),
  '2|2:true:false:account_refresh_pending:evt_t10m2:ba_t10default:true',
  'acquire: the next refresh increments the generation, is pending and clears the healthy bit');
select throws_ok($$select public.fn_acquire_connect_account_refresh('acct_t10other', 'evt_t10m1')$$,
  'P0001', 'ACCOUNT_EVENT_IDENTITY_MISMATCH', 'acquire: an event of another account is refused');

-- 5. A stale or mismatched commit is refused and writes nothing -----------------
create table pg_temp.before as select pg_temp.acct_json('acct_t10main') as v;
select is(pg_temp.commit_bank('acct_t10main', 1, 'evt_t10m2', true, null, 'verified'), false,
  'commit: a superseded generation is refused');
select is(pg_temp.acct_json('acct_t10main'), (select v from pg_temp.before),
  'commit: the superseded commit wrote nothing');
select is(pg_temp.commit_bank('acct_t10main', 2, 'evt_t10m1', true, null, 'verified'), false,
  'commit: a commit naming another trigger event is refused');
select is(pg_temp.acct_json('acct_t10main'), (select v from pg_temp.before),
  'commit: the mismatched commit wrote nothing');

-- 6. The getter hides a healthy bit while a refresh is pending ------------------
update public.connect_account_actionability set is_actionable = true, blocked_reason = null
where stripe_account_id = 'acct_t10main';
select is(pg_temp.gate('acct_t10main'), 'false:account_refresh_pending',
  'gate: a pending refresh reports account_refresh_pending even over a healthy bit');

-- 7. The blocked external-account statuses make the account not actionable ------
select pg_temp.rec(a, e) from (values ('acct_t10err', 'evt_t10e1'), ('acct_t10vfail', 'evt_t10v1'),
  ('acct_t10tok', 'evt_t10t1')) as x(a, e);
select public.fn_acquire_connect_account_refresh(a, e) from (values ('acct_t10err', 'evt_t10e1'),
  ('acct_t10vfail', 'evt_t10v1'), ('acct_t10tok', 'evt_t10t1')) as x(a, e);
select throws_ok(
  format('select pg_temp.commit_bank(%L, 1, %L, true, null, %L)', a, e, s),
  'P0001', 'INVALID_CURRENT_ACCOUNT_SNAPSHOT', 'blocked: a commit calling a ' || s || ' bank actionable is refused')
from (values ('acct_t10err', 'evt_t10e1', 'errored'), ('acct_t10vfail', 'evt_t10v1', 'verification_failed'),
  ('acct_t10tok', 'evt_t10t1', 'tokenized_account_number_deactivated')) as x(a, e, s);
select is(pg_temp.commit_blocked(a, e, s), 'true|false:' || s,
  'blocked: a ' || s || ' bank is accepted as not actionable')
from (values ('acct_t10err', 'evt_t10e1', 'errored'), ('acct_t10vfail', 'evt_t10v1', 'verification_failed'),
  ('acct_t10tok', 'evt_t10t1', 'tokenized_account_number_deactivated')) as x(a, e, s);

select * from finish();
rollback;
