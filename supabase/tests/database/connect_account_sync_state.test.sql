-- Connect account sync state (#381). fn_get_connect_account_sync_state is the
-- read-only view of the account refresh that local tooling uses to wait for the
-- account webhooks: the raw pending bit, the gate and the current bank of the
-- projection, plus how many of the given Stripe event ids stripe-webhooks has
-- recorded for that account. Only service_role executes it.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(15);

-- pending:is_actionable:current bank:recorded count, as the sandbox wait reads them.
create function pg_temp.sync(p_acct text, p_events text[]) returns text language sql as $$
  select coalesce(s.refresh_pending::text, '-') || ':' || coalesce(s.is_actionable::text, '-') || ':'
    || coalesce(s.current_external_account_id, '-') || ':' || s.recorded_event_count
  from public.fn_get_connect_account_sync_state(p_acct, p_events) s
$$;

-- 1. Contract ------------------------------------------------------------------
select is_definer('public', 'fn_get_connect_account_sync_state', array['text', 'text[]'],
  'sync state: SECURITY DEFINER');
select is(
  (select provolatile from pg_proc where oid = 'public.fn_get_connect_account_sync_state(text, text[])'::regprocedure),
  's'::"char", 'sync state: STABLE, it never writes');
select ok(
  (select 'search_path=public' = any(proconfig) from pg_proc
    where oid = 'public.fn_get_connect_account_sync_state(text, text[])'::regprocedure),
  'sync state: search_path pinned to public');
select is(
  array[
    has_function_privilege('service_role', 'public.fn_get_connect_account_sync_state(text, text[])', 'EXECUTE'),
    has_function_privilege('anon', 'public.fn_get_connect_account_sync_state(text, text[])', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.fn_get_connect_account_sync_state(text, text[])', 'EXECUTE')
  ],
  array[true, false, false], 'sync state: only service_role executes it');

-- 2. Observations ----------------------------------------------------------------
select is(pg_temp.sync('acct_381none', array['evt_381x']), '-:-:-:0',
  'sync state: an account without a projection row has no pending bit, gate or bank');
select throws_ok($$select pg_temp.sync(' ', array[]::text[])$$,
  'P0001', 'MISSING_STRIPE_ACCOUNT_ID', 'sync state: a blank account id is refused');

select public.fn_record_connect_account_event('evt_381a', 'acct_381main', 'account.external_account.created', now(), null, null, 'ba_381new');
select public.fn_record_connect_account_event('evt_381b', 'acct_381other', 'account.updated', now(), null, null, null);
select is(pg_temp.sync('acct_381main', array['evt_381a', 'evt_381b', 'evt_381missing']), '-:-:-:1',
  'sync state: counts only the given events recorded for this account');
select is(pg_temp.sync('acct_381main', null), '-:-:-:0', 'sync state: no event ids count zero');

select is(public.fn_acquire_connect_account_refresh('acct_381main', 'evt_381a'), 1::bigint,
  'sync state setup: the webhook opens refresh generation 1');
select is(pg_temp.sync('acct_381main', array['evt_381a']), 'true:false:-:1',
  'sync state: an open refresh shows the raw pending bit');

select ok(public.fn_commit_connect_account_refresh('acct_381main', 1, 'evt_381a', true, null, true,
  'ba_381new', 'new', 'mxn', true, 1, 'manual'), 'sync state setup: the webhook commits the refresh');
select is(pg_temp.sync('acct_381main', array['evt_381a']), 'false:true:ba_381new:1',
  'sync state: a committed refresh shows the gate and the current bank');

-- 3. As the Edge Functions and Bruno call it ---------------------------------------
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select recorded_event_count from public.fn_get_connect_account_sync_state('acct_381main', array['evt_381a'])),
  1, 'sync state: service_role reads it without any table privilege');
reset role;

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select * from public.fn_get_connect_account_sync_state('acct_381main', array['evt_381a'])$$,
  '42501', null, 'sync state: anon cannot call it');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-000000000381", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.fn_get_connect_account_sync_state('acct_381main', array['evt_381a'])$$,
  '42501', null, 'sync state: a signed-in user cannot call it');
reset role;

select * from finish();
rollback;
