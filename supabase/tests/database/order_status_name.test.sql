-- Enum types carry no `_enum` suffix (odd/tasks/integrity-constraints.md S10,
-- T9). `order_status_enum` is renamed in place to `order_status`: same labels
-- in the same order, and every column that used it keeps its type and default.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(9);

select has_type('public', 'order_status', 'public.order_status exists');
select hasnt_type('public', 'order_status_enum', 'public.order_status_enum is gone');

select enum_has_labels('public', 'order_status',
  array['pending', 'paid', 'preparing', 'shipped', 'delivered', 'completed',
        'cancelled', 'dispute', 'refunded'],
  'order_status keeps its labels in order');

select col_type_is('public', 'orders', 'status', 'public', 'order_status',
  'orders.status is public.order_status');
select col_type_is('public', 'shipments', 'status', 'public', 'order_status',
  'shipments.status is public.order_status');
select is(
  (select array_agg((n.nspname || '.' || c.relname || '.' || a.attname)::text
      order by n.nspname, c.relname, a.attname)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where a.attnum > 0 and not a.attisdropped and c.relkind = 'r'
      and a.atttypid = 'public.order_status'::regtype),
  array['public.orders.status', 'public.shipments.status']::text[],
  'exactly orders.status and shipments.status use order_status');

select col_default_is('public', 'orders', 'status', 'pending',
  'orders.status defaults to pending');
select col_default_is('public', 'shipments', 'status', 'paid',
  'shipments.status defaults to paid');

select is('completed'::public.order_status::text, 'completed',
  'a cast to public.order_status works');

select * from finish();
rollback;
