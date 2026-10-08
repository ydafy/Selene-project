import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const source = readFileSync(join(root, 'supabase/queries/products/fn_resolve_product_verdict.sql'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20260927000000_product_verdict_notification.sql'), 'utf8').replace(/\r\n/g, '\n');
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const body = migration.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1];

describe('product verdict cutover', () => {
  it('replaces the exact canonical body without dropping or changing ACL', () => {
    expect(normalize(body!)).toBe(normalize(source));
    expect(migration).toContain('fn_resolve_product_verdict(\n  p_product_id UUID,');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).not.toMatch(/DROP FUNCTION|GRANT EXECUTE|REVOKE EXECUTE/i);
  });
  it('fails closed on expected RPC authority, audit identity, N4b grants and N4a arbiter', () => {
    expect(migration).toContain("'public.fn_resolve_product_verdict(uuid,text,text,text)'::regprocedure");
    expect(migration).toContain('p.prosecdef');
    expect(migration).toContain("has_function_privilege('authenticated', p.oid, 'EXECUTE')");
    expect(migration).toContain("has_function_privilege('service_role', p.oid, 'EXECUTE')");
    expect(migration).toContain("NOT has_function_privilege('anon', p.oid, 'EXECUTE')");
    expect(migration).toContain("p.proconfig = ARRAY['search_path=public, pg_temp']::text[]");
    expect(migration).not.toContain('p.proconfig @>');
    expect(migration).toContain('admin_audit_logs');
    expect(migration).toContain('gen_random_uuid()');
    expect(migration).toContain('notifications_source_event_key_user_id_uidx');
    expect(migration).toContain('i.indnkeyatts = 2 AND i.indnatts = 2');
    expect(migration).toContain("pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'");
    expect(migration).toMatch(/\nBEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';/);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });
});
