import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const source = readFileSync(join(root, 'supabase/queries/disputes/fn_resolve_dispute_to_buyer.sql'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20260928000000_dispute_buyer_verdict_notification.sql'), 'utf8').replace(/\r\n/g, '\n');
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('buyer dispute verdict cutover', () => {
  it('wraps the canonical body with the existing signature and unchanged ACL', () => {
    expect(normalize(migration.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1] ?? '')).toBe(normalize(source));
    expect(migration).toContain('public.fn_resolve_dispute_to_buyer(\n  p_dispute_id UUID,\n  p_admin_note TEXT');
    expect(migration).toContain('RETURNS TABLE(success BOOLEAN, error_message TEXT)');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).not.toMatch(/DROP FUNCTION|GRANT EXECUTE|REVOKE EXECUTE/i);
  });
  it('requires exact legacy config independently of the hardened replacement', () => {
    const preflight = migration.match(/DO \$preflight\$([\s\S]*?)\$preflight\$;/)?.[1] ?? '';
    const configGuard = preflight.match(/AND p\.proconfig[^\n]*/g) ?? [];
    expect(configGuard).toEqual(["AND p.proconfig = ARRAY['search_path=public']::text[]"]);
    expect(preflight).not.toMatch(/p\.proconfig\s*(?:@>|<@)|search_path=public, pg_temp|OR\s+p\.proconfig/i);
    const replacement = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(replacement).toContain('SET search_path = public, pg_temp');
  });
  it('fails closed on deployed RPC, audit identity, N4b authority and N4a arbiter', () => {
    for (const marker of ["'public.fn_resolve_dispute_to_buyer(uuid,text)'::regprocedure", 'p.prosecdef', "has_function_privilege('service_role', p.oid, 'EXECUTE')", "NOT has_function_privilege('anon', p.oid, 'EXECUTE')", "NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')", "p.proconfig = ARRAY['search_path=public']::text[]", 'gen_random_uuid()', 'notifications_source_event_key_user_id_uidx', 'i.indnkeyatts = 2 AND i.indnatts = 2']) expect(migration).toContain(marker);
    expect(migration).not.toMatch(/RAISE EXCEPTION 'N5d blocked/i);
    expect(migration).toContain("pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'");
    expect(migration).toMatch(/BEGIN;\s*SET LOCAL lock_timeout = '5s';\s*SET LOCAL statement_timeout = '60s';/);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });
});
