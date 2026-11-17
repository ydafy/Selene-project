-- updated_at is maintained by one trigger function on every table that has the
-- column (odd/tasks/integrity-constraints.md S7). A new table with updated_at
-- fails here until it gets its `<table>_set_updated_at` trigger, or a row in
-- timer_tables below with its reason.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(6);

-- Every base table in public and internal with an updated_at column.
create temporary view updated_at_tables as
select c.oid, n.nspname || '.' || c.relname as tbl, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
where c.relkind in ('r', 'p') and n.nspname in ('public', 'internal');

-- Tables whose updated_at is a state-change timer that crons and the app read,
-- so a trigger moving it on every write would reset the timer. They get the
-- trigger once the timer has its own column (#574).
create temporary table timer_tables (tbl text primary key, reason text not null) on commit drop;
insert into timer_tables values
  ('public.shipments', 'auto-cancel-preparing and the order countdown read updated_at as the label time; track-shipments writes preparing rows every 5 minutes'),
  ('public.disputes', 'the dispute shipping and payout timeout crons and the dispute countdown read updated_at; fn_lock_dispute and fn_unlock_dispute write without it');

-- (a) Each of them, except the timer tables, has an enabled BEFORE UPDATE FOR
-- EACH ROW trigger named <table>_set_updated_at that calls
-- internal.fn_set_updated_at().
select is_empty(
  $$select t.tbl from updated_at_tables t
    where t.tbl not in (select tbl from timer_tables)
      and not exists (
      select 1 from pg_trigger g
      where g.tgrelid = t.oid and not g.tgisinternal
        and g.tgname = t.relname || '_set_updated_at'
        and g.tgfoid = to_regprocedure('internal.fn_set_updated_at()')
        and g.tgenabled <> 'D'
        and (g.tgtype & 1) = 1    -- FOR EACH ROW
        and (g.tgtype & 2) = 2    -- BEFORE
        and (g.tgtype & 16) = 16  -- UPDATE
    )
    order by 1$$,
  'every table in public and internal with updated_at has its set_updated_at trigger');

-- (b) That function is the only one maintaining updated_at.
select is_empty(
  $$select n.nspname || '.' || p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.prorettype = 'trigger'::regtype
      and p.proname ilike '%updated_at%'
      and p.oid is distinct from to_regprocedure('internal.fn_set_updated_at()')
    order by 1$$,
  'no other trigger function in public or internal maintains updated_at');

select is_empty(
  $$select g.tgrelid::regclass::text || '.' || g.tgname
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'internal') and not g.tgisinternal
      and (g.tgfoid = to_regprocedure('internal.fn_set_updated_at()') or g.tgname like '%updated_at%')
      and (g.tgname <> c.relname || '_set_updated_at'
           or g.tgfoid is distinct from to_regprocedure('internal.fn_set_updated_at()')
           or c.oid not in (select oid from updated_at_tables)
           or n.nspname || '.' || c.relname in (select tbl from timer_tables))
    order by 1$$,
  'no stray updated_at trigger (tr_orders_updated_at is gone)');

select is(
  (select array_to_string(p.proconfig, ',') || ':' || p.prosecdef::text
   from pg_proc p where p.oid = to_regprocedure('internal.fn_set_updated_at()')),
  'search_path="":false',
  'internal.fn_set_updated_at() pins an empty search_path and is SECURITY INVOKER');

-- (c) Behavior on system_settings, which nothing updated before.
insert into public.system_settings (
  id, service_fee_pct, insurance_rate, shipping_buffer_cents, return_label_fee_cents
) values (1, 0.06, 0.012, 3000, 30000) on conflict (id) do nothing;
update public.system_settings set updated_at = timestamptz '2026-01-01 00:00:00+00' where id = 1;
select is(
  (select updated_at from public.system_settings where id = 1),
  timestamptz '2026-01-01 00:00:00+00',
  'an update that sets updated_at on purpose keeps that value');

update public.system_settings set order_expiration_hours = order_expiration_hours where id = 1;
select is(
  (select updated_at from public.system_settings where id = 1),
  now(),
  'an update that leaves updated_at alone moves it to now()');

select * from finish();
rollback;
