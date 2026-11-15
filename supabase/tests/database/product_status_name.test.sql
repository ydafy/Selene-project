-- Enum types carry no `_enum` suffix (odd/tasks/integrity-constraints.md S10,
-- T9). `product_status_enum` is renamed in place to `product_status`: same
-- labels in the same order (lowercase values are T11), and every column that
-- used it keeps its type and default.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(9);

select has_type('public', 'product_status', 'public.product_status exists');
select hasnt_type('public', 'product_status_enum', 'public.product_status_enum is gone');

select enum_has_labels('public', 'product_status',
  array['PENDING_VERIFICATION', 'IN_REVIEW', 'VERIFIED', 'SOLD', 'REJECTED',
        'HIDDEN', 'RESERVED', 'IN_DISPUTE'],
  'product_status keeps its labels in order');

select col_type_is('public', 'products', 'status', 'public', 'product_status',
  'products.status is public.product_status');
select col_type_is('public', 'products', 'status_before_account_hold', 'public', 'product_status',
  'products.status_before_account_hold is public.product_status');
select is(
  (select array_agg((n.nspname || '.' || c.relname || '.' || a.attname)::text
      order by n.nspname, c.relname, a.attname)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where a.attnum > 0 and not a.attisdropped and c.relkind = 'r'
      and a.atttypid = 'public.product_status'::regtype),
  array['public.products.status', 'public.products.status_before_account_hold']::text[],
  'exactly products.status and products.status_before_account_hold use product_status');

select col_default_is('public', 'products', 'status', 'PENDING_VERIFICATION',
  'products.status defaults to PENDING_VERIFICATION');

select is('SOLD'::public.product_status::text, 'SOLD',
  'a cast to public.product_status works');

-- With both renames done, no enum type in any schema keeps the suffix.
select is(
  (select array_agg(n.nspname || '.' || t.typname order by n.nspname, t.typname)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typtype = 'e' and t.typname like '%\_enum'),
  null,
  'no enum type in any schema ends in _enum');

select * from finish();
rollback;
