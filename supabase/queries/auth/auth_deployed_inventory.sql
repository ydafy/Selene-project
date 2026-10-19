-- Catalog evidence only: one read-only JSONB row, never application records.
-- Review/sanitize definitions before sharing; static matching is incomplete discovery.
WITH RECURSIVE
role_names(name) AS (VALUES ('anon'), ('authenticated'), ('service_role')),
helper_names(name) AS (VALUES ('is_admin'), ('fn_admin_update_user_status'),
  ('fn_admin_toggle_verified_seller'), ('fn_on_auth_user_created'), ('fn_on_auth_user_updated')),
relation_names(name) AS (VALUES ('profiles'), ('profiles_private'), ('products'), ('orders'),
  ('shipments'), ('wallets'), ('payout_requests'), ('disputes'), ('admin_user_directory_view')),
schemas AS (
  SELECT n.* FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public', 'private', 'auth')
),
relations AS (
  SELECT c.*, n.nspname FROM pg_catalog.pg_class c
  JOIN schemas n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY(SELECT name FROM relation_names))
),
views AS (
  SELECT c.*, n.nspname FROM pg_catalog.pg_class c
  JOIN schemas n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('v', 'm')
    AND (c.relname = 'admin_user_directory_view' OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_rewrite rw JOIN pg_catalog.pg_depend d ON d.objid = rw.oid
      JOIN relations target ON target.oid = d.refobjid AND target.relname = 'profiles_private'
      WHERE rw.ev_class = c.oid AND d.classid = pg_catalog.to_regclass('pg_catalog.pg_rewrite')
        AND d.refclassid = pg_catalog.to_regclass('pg_catalog.pg_class')))
),
all_relations AS (
  SELECT * FROM relations UNION SELECT * FROM views
),
columns AS (
  SELECT a.*, c.nspname, c.relname, c.relowner,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
    pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression
  FROM pg_catalog.pg_attribute a JOIN all_relations c ON c.oid = a.attrelid
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
),
triggers AS (
  SELECT t.*, n.nspname, c.relname FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN schemas n ON n.oid = c.relnamespace
  WHERE (n.nspname = 'auth' AND c.relname = 'users')
    OR (n.nspname = 'public' AND c.relname IN ('profiles', 'profiles_private'))
),
functions AS (
  SELECT p.*, n.nspname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_catalog.pg_get_functiondef(p.oid) AS definition,
    p.proname = ANY(ARRAY(SELECT name FROM helper_names)) AS explicit_helper,
    p.prosrc ~* '(profiles_private|is_admin|account_status)' AS static_text_match
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p') AND (
    (n.nspname IN ('public', 'private') AND (
      p.proname = ANY(ARRAY(SELECT name FROM helper_names))
      OR p.prosrc ~* '(profiles_private|is_admin|account_status)'))
    OR p.oid IN (SELECT tgfoid FROM triggers))
),
relevant_role_ids(oid) AS (
  SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = ANY(ARRAY(SELECT name FROM role_names))
  UNION SELECT relowner FROM all_relations
  UNION SELECT proowner FROM functions
),
role_closure(oid) AS (
  SELECT oid FROM relevant_role_ids
  UNION SELECT m.roleid FROM pg_catalog.pg_auth_members m JOIN role_closure r ON r.oid = m.member
),
roles AS (
  SELECT r.oid, r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb,
    r.rolcanlogin, r.rolreplication, r.rolbypassrls
  FROM pg_catalog.pg_roles r WHERE r.oid IN (SELECT oid FROM role_closure)
),
clients AS (SELECT r.* FROM roles r JOIN role_names w ON w.name = r.rolname),
acl_objects AS (
  SELECT 'schema'::text AS kind, n.nspname::text AS identity, n.oid, 0 AS subid,
    n.nspowner AS owner, n.nspacl AS raw_acl, pg_catalog.acldefault('n', n.nspowner) AS fallback
  FROM schemas n
  UNION ALL SELECT 'relation', c.nspname || '.' || c.relname, c.oid, 0, c.relowner,
    c.relacl, pg_catalog.acldefault('r', c.relowner) FROM all_relations c
  UNION ALL SELECT 'column', a.nspname || '.' || a.relname || '.' || a.attname,
    a.attrelid, a.attnum, a.relowner, a.attacl, '{}'::aclitem[] FROM columns a
  UNION ALL SELECT 'function', p.nspname || '.' || p.proname || '(' || p.identity_arguments || ')',
    p.oid, 0, p.proowner, p.proacl, pg_catalog.acldefault('f', p.proowner) FROM functions p
),
-- Shared ACL expansion preserves PostgreSQL default ACL semantics, including PUBLIC.
raw_acls AS (
  SELECT o.kind, o.identity, o.raw_acl::text, o.raw_acl IS NULL AS uses_builtin_default,
    x.grantor, x.grantee,
    CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END AS grantee_name,
    x.privilege_type, x.is_grantable
  FROM acl_objects o CROSS JOIN LATERAL pg_catalog.aclexplode(CASE WHEN
    pg_catalog.cardinality(COALESCE(o.raw_acl, o.fallback)) > 0
    THEN COALESCE(o.raw_acl, o.fallback) END) x
),
effective_privileges AS (
  SELECT o.kind, o.identity, r.rolname, v.privilege,
    CASE o.kind
      WHEN 'schema' THEN pg_catalog.has_schema_privilege(r.oid, o.oid, v.privilege)
      WHEN 'relation' THEN pg_catalog.has_table_privilege(r.oid, o.oid, v.privilege)
      WHEN 'column' THEN pg_catalog.has_column_privilege(r.oid, o.oid, o.subid::smallint, v.privilege)
      WHEN 'function' THEN pg_catalog.has_function_privilege(r.oid, o.oid, v.privilege)
    END AS effective
  FROM acl_objects o CROSS JOIN clients r
  CROSS JOIN LATERAL pg_catalog.unnest(CASE o.kind
    WHEN 'schema' THEN ARRAY['USAGE', 'CREATE']
    WHEN 'relation' THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    WHEN 'column' THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    WHEN 'function' THEN ARRAY['EXECUTE'] END) v(privilege)
),
sections(name) AS (VALUES ('roles'), ('schemas'), ('relations'), ('columns'), ('constraints'),
  ('policies'), ('functions'), ('views'), ('triggers'), ('raw_acls'), ('effective_privileges'),
  ('default_acls'), ('memberships'), ('expected_objects')),
items(section, sort_key, payload) AS (
  SELECT 'roles', r.rolname::text, pg_catalog.to_jsonb(r) FROM roles r
  UNION ALL SELECT 'schemas', n.nspname::text, pg_catalog.jsonb_build_object(
    'schema', n.nspname, 'owner', pg_catalog.pg_get_userbyid(n.nspowner), 'raw_acl', n.nspacl) FROM schemas n
  UNION ALL SELECT 'relations', c.relname::text, pg_catalog.jsonb_build_object(
    'schema', c.nspname, 'name', c.relname, 'kind', c.relkind,
    'owner', pg_catalog.pg_get_userbyid(c.relowner), 'relrowsecurity', c.relrowsecurity,
    'relforcerowsecurity', c.relforcerowsecurity, 'raw_acl', c.relacl) FROM relations c
  UNION ALL SELECT 'columns', a.nspname || '.' || a.relname || '.' || pg_catalog.lpad(a.attnum::text, 5, '0'),
    pg_catalog.jsonb_build_object('schema', a.nspname, 'relation', a.relname, 'name', a.attname,
      'data_type', a.data_type, 'default', a.default_expression, 'not_null', a.attnotnull,
      'identity', a.attidentity, 'generated', a.attgenerated, 'raw_acl', a.attacl) FROM columns a
  UNION ALL SELECT 'constraints', c.relname || '.' || con.conname, pg_catalog.jsonb_build_object(
    'relation', c.relname, 'name', con.conname, 'type', con.contype, 'validated', con.convalidated,
    'definition', pg_catalog.pg_get_constraintdef(con.oid))
    FROM pg_catalog.pg_constraint con JOIN relations c ON c.oid = con.conrelid
    WHERE c.relname IN ('profiles', 'profiles_private')
  UNION ALL SELECT 'policies', c.relname || '.' || p.polname, pg_catalog.jsonb_build_object(
    'relation', c.relname, 'name', p.polname, 'command', p.polcmd, 'permissive', p.polpermissive,
    'roles', ARRAY(SELECT CASE WHEN x = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x) END
      FROM pg_catalog.unnest(p.polroles) x ORDER BY 1),
    'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
    'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))
    FROM pg_catalog.pg_policy p JOIN relations c ON c.oid = p.polrelid
  UNION ALL SELECT 'functions', p.nspname || '.' || p.proname || '(' || p.identity_arguments || ')',
    pg_catalog.jsonb_build_object('schema', p.nspname, 'name', p.proname,
      'identity_arguments', p.identity_arguments, 'arguments_with_defaults', pg_catalog.pg_get_function_arguments(p.oid),
      'pronargdefaults', p.pronargdefaults, 'return_type', pg_catalog.pg_get_function_result(p.oid),
      'owner', pg_catalog.pg_get_userbyid(p.proowner), 'prosecdef', p.prosecdef, 'proconfig', p.proconfig,
      'search_path', ARRAY(SELECT s FROM pg_catalog.unnest(p.proconfig) s WHERE s LIKE 'search_path=%' ORDER BY s),
      'raw_acl', p.proacl, 'explicit_helper', p.explicit_helper, 'static_text_match', p.static_text_match,
      'trigger_link', EXISTS (SELECT 1 FROM triggers t WHERE t.tgfoid = p.oid), 'definition', p.definition) FROM functions p
  UNION ALL SELECT 'views', v.nspname || '.' || v.relname, pg_catalog.jsonb_build_object(
    'schema', v.nspname, 'name', v.relname, 'owner', pg_catalog.pg_get_userbyid(v.relowner),
    'reloptions', v.reloptions, 'raw_acl', v.relacl, 'definition', pg_catalog.pg_get_viewdef(v.oid, true)) FROM views v
  UNION ALL SELECT 'triggers', t.nspname || '.' || t.relname || '.' || t.tgname,
    pg_catalog.jsonb_build_object('schema', t.nspname, 'relation', t.relname, 'name', t.tgname,
      'tgenabled', t.tgenabled, 'internal', t.tgisinternal, 'definition', pg_catalog.pg_get_triggerdef(t.oid),
      'function_schema', p.nspname, 'function_name', p.proname, 'identity_arguments', p.identity_arguments,
      'function_definition', p.definition) FROM triggers t LEFT JOIN functions p ON p.oid = t.tgfoid
  UNION ALL SELECT 'raw_acls', a.kind || '.' || a.identity || '.' || a.grantee || '.' || a.grantor || '.' || a.privilege_type,
    pg_catalog.to_jsonb(a) FROM raw_acls a
  UNION ALL SELECT 'effective_privileges', e.kind || '.' || e.identity || '.' || e.rolname || '.' || e.privilege,
    pg_catalog.to_jsonb(e) FROM effective_privileges e
  UNION ALL SELECT 'default_acls', d.defaclrole::text || '.' || d.defaclnamespace::text || '.' || d.defaclobjtype::text,
    pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(d.defaclrole),
      'schema', n.nspname, 'global', d.defaclnamespace = 0, 'object_type', d.defaclobjtype, 'raw_acl', d.defaclacl,
      'expanded', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) ORDER BY x.grantee, x.grantor, x.privilege_type), '[]'::jsonb)
        FROM pg_catalog.aclexplode(CASE WHEN pg_catalog.cardinality(d.defaclacl) > 0
          THEN d.defaclacl END) x))
    FROM pg_catalog.pg_default_acl d LEFT JOIN schemas n ON n.oid = d.defaclnamespace
    WHERE (d.defaclnamespace = 0 OR n.oid IS NOT NULL)
      AND d.defaclrole IN (SELECT oid FROM roles)
  UNION ALL SELECT 'memberships', m.member || '.' || m.roleid || '.' || m.grantor,
    pg_catalog.jsonb_build_object('member', pg_catalog.pg_get_userbyid(m.member),
      'role', pg_catalog.pg_get_userbyid(m.roleid), 'grantor', pg_catalog.pg_get_userbyid(m.grantor),
      'admin_option', m.admin_option)
    FROM pg_catalog.pg_auth_members m WHERE m.member IN (SELECT oid FROM role_closure)
  UNION ALL SELECT 'expected_objects', 'role.' || w.name, pg_catalog.jsonb_build_object(
    'kind', 'role', 'name', w.name, 'present', EXISTS (SELECT 1 FROM roles r WHERE r.rolname = w.name)) FROM role_names w
  UNION ALL SELECT 'expected_objects', 'relation.' || w.name, pg_catalog.jsonb_build_object(
    'kind', 'relation', 'schema', 'public', 'name', w.name,
    'present', EXISTS (SELECT 1 FROM relations c WHERE c.relname = w.name)) FROM relation_names w
  UNION ALL SELECT 'expected_objects', 'helper.' || w.name, pg_catalog.jsonb_build_object(
    'kind', 'helper', 'name', w.name, 'overload_count', (SELECT count(*) FROM functions p WHERE p.proname = w.name)) FROM helper_names w
  UNION ALL SELECT 'expected_objects', 'schema.' || w.name, pg_catalog.jsonb_build_object(
    'kind', 'schema', 'name', w.name, 'present', EXISTS (SELECT 1 FROM schemas n WHERE n.nspname = w.name))
    FROM (VALUES ('public'), ('private'), ('auth')) w(name)
  UNION ALL SELECT 'expected_objects', 'trigger_relation.auth.users', pg_catalog.jsonb_build_object(
    'kind', 'trigger_relation', 'name', 'auth.users', 'present', pg_catalog.to_regclass('auth.users') IS NOT NULL)
),
section_arrays AS (
  SELECT s.name, COALESCE((SELECT pg_catalog.jsonb_agg(payload ORDER BY sort_key)
    FROM items i WHERE i.section = s.name), '[]'::jsonb) AS entries FROM sections s
)
SELECT pg_catalog.jsonb_object_agg(name, entries ORDER BY name) AS inventory FROM section_arrays;
