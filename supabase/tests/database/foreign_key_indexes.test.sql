-- Foreign key and duplicate index lints (#310 T4, S5, S7): the Supabase
-- performance advisor's `unindexed_foreign_keys` and `duplicate_index`
-- checks, so CI fails before the advisor does. Reads the catalog only; needs
-- no rows.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(2);

-- (a) Every foreign key in public or internal has an index on its table whose
-- leading columns are the foreign key columns, in the constraint's order.
-- Deletes and updates on the referenced row, and joins from it, then use the
-- index. A partial index counts only when its predicate is `<column> IS NOT NULL`
-- on a single-column foreign key: the referential check never looks up NULL.
-- Any other predicate leaves rows the check must still scan.
select is(
  (
    select coalesce(array_agg(format('%s: %s (%s)', c.conrelid::regclass, c.conname,
             (select string_agg(a.attname, ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum))
             order by c.conrelid::regclass::text, c.conname), '{}')
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f'
      and n.nspname in ('public', 'internal')
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey
          and (
            i.indpred is null
            or (cardinality(c.conkey) = 1
                and pg_get_expr(i.indpred, i.indrelid) = format('(%I IS NOT NULL)',
                  (select a.attname from pg_attribute a
                   where a.attrelid = c.conrelid and a.attnum = c.conkey[1])))
          )
      )
  ),
  '{}'::text[],
  'every foreign key in public or internal has an index led by its columns'
);

-- (b) No two indexes on one table have the same key columns, expressions,
-- predicate, operator classes, collations, sort options and access method:
-- one of them only costs writes and storage. Names each pair.
select is(
  (
    select coalesce(array_agg(format('%s: %s, %s', a.indrelid::regclass,
             a.indexrelid::regclass, b.indexrelid::regclass)
             order by a.indrelid::regclass::text, a.indexrelid::regclass::text), '{}')
    from pg_index a
    join pg_index b on b.indrelid = a.indrelid and b.indexrelid > a.indexrelid
    join pg_class t on t.oid = a.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class ai on ai.oid = a.indexrelid
    join pg_class bi on bi.oid = b.indexrelid
    where n.nspname in ('public', 'internal')
      and ai.relam = bi.relam
      and a.indkey::text = b.indkey::text
      and a.indclass::text = b.indclass::text
      and a.indcollation::text = b.indcollation::text
      and a.indoption::text = b.indoption::text
      and coalesce(pg_get_expr(a.indexprs, a.indrelid), '') = coalesce(pg_get_expr(b.indexprs, b.indrelid), '')
      and coalesce(pg_get_expr(a.indpred, a.indrelid), '') = coalesce(pg_get_expr(b.indpred, b.indrelid), '')
  ),
  '{}'::text[],
  'no table in public or internal has two indexes with the same definition'
);

select * from finish();
rollback;
