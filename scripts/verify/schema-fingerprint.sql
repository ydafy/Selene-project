-- Catalog fingerprint for the schema drift check (supabase/AGENTS.md, "Schema drift check").
-- Run it unchanged on both sides and compare the rows:
--   local:  supabase db query --local -f scripts/verify/schema-fingerprint.sql
--   remote: paste the whole file into the Supabase MCP `execute_sql` (read-only)
-- Each row is one kind of object with its count and a hash of every object's definition.
-- When a kind differs, replace the final SELECT with the drill-down at the end of this file.
--
-- Covered: schemas, tables, views, sequences, columns, constraints, indexes, policies,
-- functions (body and EXECUTE grants), owners, table and column grants, enums and domains,
-- extensions and their schema, Realtime publication tables, Storage buckets, default privileges,
-- and our triggers on auth and storage tables. Not covered: cron jobs (cron.job), Vault secrets,
-- Auth settings and Edge Functions (docs/go-live.md), and table rows.
-- Left out on purpose because the platform manages them: extension versions, Supabase-owned
-- schemas, and Supabase's own triggers and publications.
-- Grantors are stripped from ACLs, whitespace from function, view and policy text, and
-- search_path is pinned so expressions print schema-qualified on both sides. It is one
-- statement because `supabase db query` runs a prepared statement: `ns` sets search_path
-- for this transaction, and every other part of the query reads `ns` before printing.
with ns as materialized (
  select oid, nspname from pg_namespace
  where set_config('search_path', 'pg_catalog', true) is not null
    and nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'auth', 'storage', 'realtime',
      'extensions', 'graphql', 'graphql_public', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron',
      'supabase_functions', 'supabase_migrations', '_realtime', '_analytics', 'pgbouncer', 'topology',
      'pgmq', '_supavisor')
    and nspname not like 'pg\_temp%' and nspname not like 'pg\_toast\_temp%'
),
extmember as (select objid from pg_depend where deptype = 'e'),
rel as (
  select c.oid, n.nspname || '.' || c.relname as name, c.relkind, c.relrowsecurity,
    c.relforcerowsecurity, c.relacl, c.reloptions, c.relowner
  from pg_class c join ns n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.oid not in (select objid from extmember)
),
hooked as ( -- tables whose policies and triggers count, including auth and storage tables
  select c.oid, n.nspname || '.' || c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and (n.nspname in ('auth', 'storage') or n.oid in (select oid from ns))
),
objs(kind, grp, ident, detail) as (
  -- text, not name: the first branch sets the column types, and name cuts at 63 bytes
  select 'schema'::text, nspname::text, nspname::text,
    (select string_agg(x, ',' order by x)
     from (select regexp_replace(a::text, '/.*$', '') x from unnest(nspacl) a) s)
  from pg_namespace where oid in (select oid from ns)
  union all
  select 'relation', name, name, concat_ws('|', relkind, relrowsecurity, relforcerowsecurity,
    array_to_string(reloptions, ','),
    (select string_agg(x, ',' order by x)
     from (select regexp_replace(a::text, '/.*$', '') x from unnest(relacl) a) s),
    case when relkind in ('v', 'm') then regexp_replace(pg_get_viewdef(oid), '\s+', '', 'g') end)
  from rel
  union all
  select 'owner', name, name, pg_get_userbyid(relowner) from rel
  union all
  select 'column', r.name, r.name || '.' || a.attname, concat_ws('|',
    format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid),
    a.attidentity, a.attgenerated,
    (select string_agg(x, ',' order by x)
     from (select regexp_replace(ac::text, '/.*$', '') x from unnest(a.attacl) ac) s))
  from rel r
  join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 'constraint', r.name, r.name || '.' || co.conname, pg_get_constraintdef(co.oid)
  from rel r join pg_constraint co on co.conrelid = r.oid
  union all
  select 'index', r.name, r.name || '.' || ic.relname, pg_get_indexdef(i.indexrelid)
  from rel r join pg_index i on i.indrelid = r.oid join pg_class ic on ic.oid = i.indexrelid
  union all
  select 'trigger', h.name, h.name || '.' || t.tgname, pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text
  from hooked h
  join pg_trigger t on t.tgrelid = h.oid and not t.tgisinternal
  join pg_proc tp on tp.oid = t.tgfoid
  where tp.pronamespace in (select oid from ns)
  union all
  select 'policy', h.name, h.name || '.' || p.polname, concat_ws('|', p.polcmd, p.polpermissive,
    (select string_agg(r, ',' order by r)
     from (select case when x = 0 then 'public' else pg_get_userbyid(x) end r
           from unnest(p.polroles) x) roles),
    regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', '', 'g'),
    regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+', '', 'g'))
  from hooked h join pg_policy p on p.polrelid = h.oid
  union all
  select 'function', n.nspname || '.' || p.proname,
    n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    concat_ws('|',
      case when p.prokind in ('f', 'p') then regexp_replace(pg_get_functiondef(p.oid), '\s+', '', 'g')
        else p.prokind::text end,
      (select string_agg(x, ',' order by x)
       from (select regexp_replace(a::text, '/.*$', '') x from unnest(p.proacl) a) s),
      pg_get_userbyid(p.proowner))
  from pg_proc p join ns n on n.oid = p.pronamespace
  where p.oid not in (select objid from extmember)
  union all
  select 'type', n.nspname || '.' || t.typname, n.nspname || '.' || t.typname, concat_ws('|', t.typtype,
    (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid),
    case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
    (select string_agg(pg_get_constraintdef(dc.oid), ',' order by dc.conname)
     from pg_constraint dc where dc.contypid = t.oid))
  from pg_type t join ns n on n.oid = t.typnamespace
  where t.typtype in ('e', 'd')
    or (t.typtype = 'c' and (select relkind from pg_class where oid = t.typrelid) = 'c')
  union all
  select 'extension', e.extname, e.extname, n.nspname
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  union all
  select 'publication', p.pubname, p.pubname || '.' || pn.nspname || '.' || pc.relname, ''
  from pg_publication p
  join pg_publication_rel pr on pr.prpubid = p.oid
  join pg_class pc on pc.oid = pr.prrelid
  join pg_namespace pn on pn.oid = pc.relnamespace
  where pn.oid in (select oid from ns)
  union all
  select 'bucket', b.id, b.id,
    concat_ws('|', b.public, b.file_size_limit, array_to_string(b.allowed_mime_types, ','))
  from storage.buckets b
  union all
  select 'default_acl', coalesce(n.nspname, '*'),
    pg_get_userbyid(d.defaclrole) || '.' || coalesce(n.nspname, '*') || '.' || d.defaclobjtype::text,
    (select string_agg(x, ',' order by x)
     from (select regexp_replace(a::text, '/.*$', '') x from unnest(d.defaclacl) a) s)
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  where d.defaclnamespace = 0 or d.defaclnamespace in (select oid from ns)
)
select kind, count(*) as objects,
  left(md5(string_agg(ident || ':' || md5(coalesce(detail, '')), ',' order by ident)), 12) as hash
from objs
group by kind
order by kind;

-- Drill-down: replace the SELECT above with this one, set the kind, and compare the rows.
-- Group hashes first (one row per table or function name); then, for a differing group,
-- select ident and detail where grp = '<group>'.
--
-- select grp, left(md5(string_agg(ident || ':' || md5(coalesce(detail, '')), ',' order by ident)), 12) as hash
-- from objs where kind = '<kind>' group by grp order by grp;
