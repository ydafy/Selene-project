import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const source = readFileSync(join(root, 'supabase/queries/disputes/fn_resolve_dispute_to_seller.sql'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20260929000000_dispute_seller_verdict_notification.sql'), 'utf8');
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('seller dispute verdict cutover', () => {
  it('wraps the canonical body without changing RPC authority', () => {
    expect(normalize(migration.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1] ?? '')).toBe(normalize(source));
    expect(migration).toContain('public.fn_resolve_dispute_to_seller(\n  p_dispute_id UUID,\n  p_admin_note TEXT');
    expect(migration).toContain('RETURNS TABLE(success BOOLEAN, error_message TEXT)');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).not.toMatch(/DROP FUNCTION|GRANT EXECUTE|REVOKE EXECUTE/i);
  });
  it('fails closed on deployed RPC, UUID audit identity, N4b grants and N4a arbiter', () => {
    for (const marker of ["'public.fn_resolve_dispute_to_seller(uuid,text)'::regprocedure", 'p.prosecdef', "has_function_privilege('service_role', p.oid, 'EXECUTE')", "NOT has_function_privilege('anon', p.oid, 'EXECUTE')", "NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')", "p.proconfig = ARRAY['search_path=public, pg_temp']::text[]", 'gen_random_uuid()', 'notifications_source_event_key_user_id_uidx', 'i.indnkeyatts = 2 AND i.indnatts = 2']) expect(migration).toContain(marker);
    expect(migration).toContain("pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'");
    expect(migration).toMatch(/BEGIN;\s*SET LOCAL lock_timeout = '5s';\s*SET LOCAL statement_timeout = '60s';/);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });
});
