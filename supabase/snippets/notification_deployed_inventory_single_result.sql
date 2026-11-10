-- Read-only deployed catalog snapshot: one JSONB row containing queries 01-11.
-- Output may contain catalog literals: sanitize before sharing. This inventory does
-- not guarantee completeness. If Dashboard errors, provide the error text instead.
-- Query 12 is separately exported by the maintainer; do not duplicate it here.
SELECT jsonb_build_object(
  '01', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
    SELECT current_setting('server_version') AS postgres_version,
           to_regclass('public.notifications')::text AS notifications_relation
  ) q),
  '02', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
    SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
           c.reltuples::bigint AS estimated_rows, pg_relation_size(c.oid) AS table_bytes,
           pg_total_relation_size(c.oid) AS total_bytes,
           s.n_tup_ins, s.n_tup_upd, s.n_tup_del
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public' AND c.relname = 'notifications'
  ) q),
  '03', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
    SELECT a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull, a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = 'notifications' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  ) q),
  '04', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
    SELECT con.conname, con.contype, con.convalidated, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con WHERE con.conrelid = to_regclass('public.notifications') ORDER BY con.conname
  ) q),
  '05', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
    SELECT ic.relname AS index_name, i.indisunique, i.indisvalid, i.indisready,
           pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE i.indrelid = to_regclass('public.notifications') ORDER BY ic.relname
  ) q),
  '06', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
    SELECT p.polname, p.polcmd, p.polpermissive,
           CASE WHEN 0 = ANY(p.polroles) THEN ARRAY['PUBLIC']::text[] ELSE ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.oid = ANY(p.polroles) ORDER BY r.rolname) END AS declared_roles,
           pg_get_expr(p.polqual, p.polrelid) AS using_expression,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
    FROM pg_policy p WHERE p.polrelid = to_regclass('public.notifications') ORDER BY p.polname
  ) q),
  '07', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
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
    ORDER BY grantee, column_name, privilege_type
  ) q),
  '08', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
    SELECT r.rolname AS client_role, v.privilege,
           has_schema_privilege(r.oid, 'public', 'USAGE') AS schema_usage,
           has_table_privilege(r.oid, c.oid, v.privilege) AS effective_table_privilege
    FROM pg_roles r CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege)
    JOIN pg_class c ON c.oid = to_regclass('public.notifications')
    WHERE r.rolname IN ('anon','authenticated') ORDER BY r.rolname, v.privilege
  ) q),
  '09', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
    SELECT r.rolname AS client_role, a.attname AS column_name, v.privilege,
           has_column_privilege(r.oid, c.oid, a.attname, v.privilege) AS effective_column_privilege
    FROM pg_roles r JOIN pg_class c ON c.oid = to_regclass('public.notifications')
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(privilege)
    WHERE r.rolname IN ('anon','authenticated') ORDER BY r.rolname, a.attnum, v.privilege
  ) q),
  '10', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
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
    ORDER BY n.nspname, p.proname, signature, r.rolname
  ) q),
  '11', (SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
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
    ORDER BY schema_name, signature, grantee
  ) q)
) AS inventory;
