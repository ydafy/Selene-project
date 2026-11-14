-- Rates are fractions between 0 and 1, stored as numeric(5,4), and the
-- database rejects any other unit (odd/tasks/money-integer-cents.md S6, T1).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(9);

create temporary table rate_columns (table_name text, column_name text) on commit drop;
insert into rate_columns values
  ('system_settings', 'service_fee_pct'),
  ('system_settings', 'insurance_rate'),
  ('system_settings', 'isr_withholding_pct'),
  ('system_settings', 'iva_withholding_pct'),
  ('products', 'publication_commission_rate'),
  ('products', 'publication_insurance_rate');

select is_empty(
  $$select r.table_name, r.column_name, format_type(a.atttypid, a.atttypmod)
    from rate_columns r
    join pg_attribute a
      on a.attrelid = ('public.' || r.table_name)::regclass
     and a.attname = r.column_name
    where format_type(a.atttypid, a.atttypmod) <> 'numeric(5,4)'$$,
  'every rate column is numeric(5,4)');

select is_empty(
  $$select a.attname from pg_attribute a
    where a.attrelid = 'public.system_settings'::regclass
      and a.attname in ('service_fee_pct', 'insurance_rate', 'isr_withholding_pct', 'iva_withholding_pct')
      and not a.attnotnull$$,
  'the system_settings rates are NOT NULL');

select throws_ok(
  $$update public.system_settings set service_fee_pct = 1.5 where id = 1$$,
  '23514', null, 'a service fee above 1 is rejected');

select throws_ok(
  $$update public.system_settings set insurance_rate = -0.01 where id = 1$$,
  '23514', null, 'a negative insurance rate is rejected');

select throws_ok(
  $$update public.system_settings set isr_withholding_pct = 1.01 where id = 1$$,
  '23514', null, 'an ISR withholding above 1 is rejected');

select throws_ok(
  $$update public.system_settings set iva_withholding_pct = -1 where id = 1$$,
  '23514', null, 'a negative IVA withholding is rejected');

select lives_ok(
  $$update public.system_settings
    set service_fee_pct = 0, insurance_rate = 1, isr_withholding_pct = 0.0100, iva_withholding_pct = 0.08
    where id = 1$$,
  'the bounds 0 and 1 are accepted');

select is(
  (select array[service_fee_pct, insurance_rate, isr_withholding_pct, iva_withholding_pct]
   from public.system_settings where id = 1),
  array[0, 1, 0.01, 0.08]::numeric[],
  'accepted rates are stored as written');

select hasnt_function('internal', 'normalize_publication_rate', array['numeric'],
  'the unit-guessing rate helper is gone');

select * from finish();
rollback;
