-- Read-only deployed catalog snapshot for N4b design. Run each numbered SELECT
-- separately in Supabase SQL Editor and capture its result set before the next one.
-- No notification rows, function bodies, credentials, or unbounded user data are selected.
-- Catalog expressions (defaults, policy predicates, index definitions) can contain literals:
-- sanitize output before sharing. A static function-body search is incomplete.
-- 01: PostgreSQL version and notification table identity.
SELECT current_setting('server_version') AS postgres_version,
       to_regclass('public.notifications')::text AS notifications_relation;

-- 02: Table size and cumulative writes.
SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
       c.reltuples::bigint AS estimated_rows, pg_relation_size(c.oid) AS table_bytes,
       pg_total_relation_size(c.oid) AS total_bytes,
       s.n_tup_ins, s.n_tup_upd, s.n_tup_del
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
WHERE n.nspname = 'public' AND c.relname = 'notifications';

-- 03: Columns and defaults.
SELECT a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull, a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relname = 'notifications' AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

-- 04: Constraints.
SELECT con.conname, con.contype, con.convalidated, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con WHERE con.conrelid = to_regclass('public.notifications') ORDER BY con.conname;

-- 05: Indexes.
SELECT ic.relname AS index_name, i.indisunique, i.indisvalid, i.indisready,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
WHERE i.indrelid = to_regclass('public.notifications') ORDER BY ic.relname;

-- 06: Declared RLS policies (role inheritance not resolved).
SELECT p.polname, p.polcmd, p.polpermissive,
       CASE WHEN 0 = ANY(p.polroles) THEN ARRAY['PUBLIC']::text[] ELSE ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.oid = ANY(p.polroles) ORDER BY r.rolname) END AS declared_roles,
       pg_get_expr(p.polqual, p.polrelid) AS using_expression,
       pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
FROM pg_policy p WHERE p.polrelid = to_regclass('public.notifications') ORDER BY p.polname;

-- 07: Explicit table and column ACLs.
SELECT COALESCE(grantee.rolname, 'PUBLIC') AS grantee, grantor.rolname AS grantor, acl.privilege_type,
       acl.is_grantable, NULL::name AS column_name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
WHERE n.nspname = 'public' AND c.relname = 'notifications'
UNION ALL
SELECT grantee.rolname, grantor.rolname, acl.privilege_type, acl.is_grantable, a.attname
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(a.attacl) acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
WHERE n.nspname = 'public' AND c.relname = 'notifications' AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY grantee, column_name, privilege_type;

-- 08: Effective table privileges for client roles.
SELECT r.rolname AS client_role, v.privilege,
       has_schema_privilege(r.oid, 'public', 'USAGE') AS schema_usage,
       has_table_privilege(r.oid, c.oid, v.privilege) AS effective_table_privilege
FROM pg_roles r CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege)
JOIN pg_class c ON c.oid = to_regclass('public.notifications')
WHERE r.rolname IN ('anon','authenticated') ORDER BY r.rolname, v.privilege;

-- 09: Effective column privileges for client roles.
SELECT r.rolname AS client_role, a.attname AS column_name, v.privilege,
       has_column_privilege(r.oid, c.oid, a.attname, v.privilege) AS effective_column_privilege
FROM pg_roles r JOIN pg_class c ON c.oid = to_regclass('public.notifications')
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(privilege)
WHERE r.rolname IN ('anon','authenticated') ORDER BY r.rolname, a.attnum, v.privilege;

-- Candidate discovery only: name/dependency/source text search misses dynamic SQL,
-- wrappers, indirect callers, and external Edge/service-role producers. No body returned.
-- Include canonical settlement, moderation and cancellation RPC names even when text matching misses them.
-- 10: Function candidates and effective client EXECUTE privileges.
SELECT n.nspname AS schema_name, p.proname, p.oid::regprocedure::text AS signature,
       CASE WHEN p.prokind = 'f' THEN pg_get_function_result(p.oid) ELSE NULL END AS return_type, p.prosecdef AS security_definer,
       p.provolatile AS volatility, ARRAY(SELECT split_part(setting, '=', 1) FROM unnest(p.proconfig) AS setting ORDER BY 1) AS setting_names,
       (p.proacl IS NULL) AS default_execute_acl,
       r.rolname AS client_role, has_schema_privilege(r.oid, n.oid, 'USAGE') AS schema_usage,
       has_function_privilege(r.oid, p.oid, 'EXECUTE') AS effective_execute,
       EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
         AND d.objid = p.oid AND d.refobjid = to_regclass('public.notifications')) AS catalog_dependency,
       (p.proname ILIKE '%notif%' OR CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ILIKE '%notifications%' ELSE false END) AS static_text_match
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND r.rolname IN ('anon','authenticated')
  AND (p.proname IN ('fn_create_shipments_from_single_payment', 'fn_resolve_product_verdict', 'fn_cancel_shipment', 'fn_cancel_order') OR p.proname ILIKE '%notif%' OR CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ILIKE '%notifications%' ELSE false END
       OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
         AND d.objid = p.oid AND d.refobjid = to_regclass('public.notifications')))
ORDER BY n.nspname, p.proname, signature, r.rolname;

-- 11: Candidate function ACLs (NULL proacl expands to PostgreSQL default ACL).
SELECT n.nspname AS schema_name, p.oid::regprocedure::text AS signature,
       COALESCE(grantee.rolname, 'PUBLIC') AS grantee, grantor.rolname AS grantor,
       acl.privilege_type, acl.is_grantable
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND (p.proname IN ('fn_create_shipments_from_single_payment', 'fn_resolve_product_verdict', 'fn_cancel_shipment', 'fn_cancel_order') OR p.proname ILIKE '%notif%' OR CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ILIKE '%notifications%' ELSE false END
       OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
         AND d.objid = p.oid AND d.refobjid = to_regclass('public.notifications')))
ORDER BY schema_name, signature, grantee;

-- 12: All public-table triggers, including other tables whose functions may write
-- notifications. Identity only; no trigger/function body or complete call graph.
SELECT tn.nspname AS table_schema, tc.relname AS table_name,
       t.tgname AS trigger_name, t.tgenabled AS enabled, t.tgisinternal AS internal,
       pn.nspname AS function_schema, p.oid::regprocedure::text AS function_signature,
       p.prosecdef AS security_definer
FROM pg_trigger t JOIN pg_class tc ON tc.oid = t.tgrelid
JOIN pg_namespace tn ON tn.oid = tc.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace pn ON pn.oid = p.pronamespace
WHERE tn.nspname = 'public'
ORDER BY tc.relname, t.tgname;
