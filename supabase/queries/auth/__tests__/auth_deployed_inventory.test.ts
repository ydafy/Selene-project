import { expect, test } from 'bun:test';

const sqlPath = new URL('../auth_deployed_inventory.sql', import.meta.url);
const docPath = new URL('../auth_deployed_inventory.md', import.meta.url);

test('auth inventory source stays a single catalog-only SELECT (not a PostgreSQL execution test)', async () => {
  const sql = await Bun.file(sqlPath).text();
  const source = sql.replace(/--[^\n]*/g, '').trim();
  expect(source).toMatch(/^WITH\b/i);
  expect(source.match(/;/g)).toHaveLength(1);
  expect(source).toMatch(/;$/);
  const code = source.replace(/'(?:''|[^'])*'/g, "''");
  expect(code).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|EXECUTE|COPY|INTO|SET)\b/i);
  expect(code).not.toMatch(/\b(?:public|private|auth|vault|cron)\s*\./i);
  expect(code).not.toMatch(/pg_authid|pg_read_file|dblink|http_|current_setting|::\s*reg(?:class|procedure)/i);
  const catalogSources = [...code.matchAll(/\b(?:FROM|JOIN)\s+pg_catalog\.(\w+)/gi)].map((m) => m[1]);
  expect(catalogSources.length).toBeGreaterThan(10);
  expect(new Set(catalogSources)).toEqual(new Set(['pg_roles', 'pg_namespace', 'pg_class', 'pg_attribute', 'pg_attrdef', 'pg_constraint', 'pg_policy', 'pg_proc', 'pg_trigger', 'pg_depend', 'pg_rewrite', 'pg_default_acl', 'pg_auth_members', 'unnest', 'aclexplode']));
  for (const section of ['roles', 'schemas', 'relations', 'columns', 'constraints', 'policies', 'functions', 'views', 'triggers', 'raw_acls', 'effective_privileges', 'default_acls', 'memberships', 'expected_objects']) expect(sql).toContain(`'${section}'`);
  for (const field of ['relrowsecurity', 'relforcerowsecurity', 'prosecdef', 'proconfig', 'search_path', 'pg_get_function_identity_arguments', 'pg_get_function_arguments', 'pronargdefaults', 'pg_get_function_result', 'pg_get_functiondef', 'pg_get_triggerdef', 'tgenabled', 'reloptions', 'has_schema_privilege', 'has_table_privilege', 'has_column_privilege', 'has_function_privilege', 'aclexplode', 'acldefault']) expect(sql).toContain(field);
  for (const name of ['profiles', 'profiles_private', 'products', 'orders', 'shipments', 'wallets', 'payout_requests', 'disputes', 'admin_user_directory_view', 'is_admin', 'fn_admin_update_user_status', 'fn_admin_toggle_verified_seller', 'fn_on_auth_user_created', 'fn_on_auth_user_updated', 'anon', 'authenticated', 'service_role', 'PUBLIC']) expect(sql).toContain(`'${name}'`);
  expect(sql).toContain("n.nspname IN ('public', 'private')");
  expect(sql).toContain('p.proname = ANY');
  expect(sql).not.toMatch(/to_regprocedure|LIMIT\s+1|DISTINCT\s+ON/i);
  expect(sql).toContain('jsonb_agg(payload ORDER BY sort_key)');
  expect(sql).toContain("'[]'::jsonb");
  expect(sql).toContain('jsonb_object_agg');
});

test('default ACL sort key casts catalog identifiers explicitly to text (42725 regression guard)', async () => {
  const sql = await Bun.file(sqlPath).text();
  expect(sql).toContain(
    "'default_acls', d.defaclrole::text || '.' || d.defaclnamespace::text || '.' || d.defaclobjtype::text,",
  );
});

test('ACL expansion skips empty arrays without substituting default grants (22023 source guard)', async () => {
  const sql = (await Bun.file(sqlPath).text()).replace(/\s+/g, ' ');
  expect(sql.match(/pg_catalog\.aclexplode\(/g)).toHaveLength(2);
  for (const acl of ['COALESCE(o.raw_acl, o.fallback)', 'd.defaclacl']) {
    expect(
      sql.includes(`pg_catalog.aclexplode(CASE WHEN pg_catalog.cardinality(${acl}) > 0 THEN ${acl} END) x`),
    ).toBe(true);
  }
});

test('manual handoff distinguishes catalog evidence from behavioral and deployment proof', async () => {
  const doc = await Bun.file(docPath).text();
  for (const text of ['SQL Editor', 'single', 'JSONB', 'sanitize', 'not behavioral proof', 'incomplete', 'dynamic SQL', 'public', 'private', 'PUBLIC', 'missing', 'PostgreSQL', 'not executed', 'db:types', 'No deployment', 'error']) expect(doc).toContain(text);
});
