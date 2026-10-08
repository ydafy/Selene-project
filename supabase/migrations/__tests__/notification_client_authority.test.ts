import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = () => readFileSync(join(import.meta.dir, '..', '20260923000000_notification_client_authority.sql'), 'utf8');

describe('N4b notification client authority (static guards only)', () => {
  it('precedes N4a in one bounded transaction', () => {
    expect('20260923000000_notification_client_authority.sql' < '20260924000000_notification_event_metadata.sql').toBe(true);
    expect(sql()).toMatch(/BEGIN;\s*SET LOCAL lock_timeout = '5s';\s*SET LOCAL statement_timeout = '60s';/);
    expect(sql().trimEnd()).toMatch(/COMMIT;$/);
  });
  it('fails closed on legacy relation, columns, policy and grants before changing authority', () => {
    const text = sql();
    for (const marker of ['pg_class', 'pg_attribute', 'pg_policy', 'pg_get_expr', 'aclexplode', 'pg_attribute', 'has_schema_privilege', 'has_table_privilege', 'has_function_privilege', 'service_role', 'notifications_all']) expect(text).toContain(marker);
    expect(text.indexOf('RAISE EXCEPTION')).toBeLessThan(text.indexOf('REVOKE ALL'));
    expect(text).toContain('attacl');
  });
  it('compares ordered catalog column names as text[] with the exact fail-closed guard', () => {
    const text = sql();
    expect(text).toMatch(/expected_columns text\[\]/);
    expect(text).toMatch(/array_agg\(a\.attname::text ORDER BY a\.attnum\) FROM pg_catalog\.pg_attribute a\s+WHERE a\.attrelid = relation_oid AND a\.attnum > 0 AND NOT a\.attisdropped\)\s+IS DISTINCT FROM expected_columns THEN\s+RAISE EXCEPTION 'Unexpected legacy notifications relation or column shape'/);
    expect(text).not.toMatch(/array_agg\(a\.attname ORDER BY a\.attnum\)/);
  });
  it('limits client mutation and retains server insert and RPC execution', () => {
    const text = sql();
    expect(text).toMatch(/REVOKE ALL ON TABLE public\.notifications FROM PUBLIC, anon, authenticated/i);
    expect(text).toMatch(/GRANT SELECT ON TABLE public\.notifications TO authenticated/i);
    expect(text).toMatch(/GRANT UPDATE \(read, deleted_at\) ON public\.notifications TO authenticated/i);
    expect(text).not.toMatch(/REVOKE[^;]*FROM service_role|REVOKE[^;]*FUNCTION/i);
    expect(text).toMatch(/CREATE POLICY notifications_owner_select[^;]*FOR SELECT TO authenticated USING \(\(SELECT auth\.uid\(\)\) = user_id\)/i);
    expect(text).toMatch(/CREATE POLICY notifications_owner_update[^;]*FOR UPDATE TO authenticated USING \(\(SELECT auth\.uid\(\)\) = user_id\) WITH CHECK \(\(SELECT auth\.uid\(\)\) = user_id\)/i);
  });
  it('postchecks effective table and column privileges including PG17 privileges and policies', () => {
    const text = sql();
    for (const marker of ['TRUNCATE', 'MAINTAIN', 'has_column_privilege', 'has_table_privilege', 'has_function_privilege', 'pg_policy', 'notifications_owner_select', 'notifications_owner_update']) expect(text).toContain(marker);
  });
});
