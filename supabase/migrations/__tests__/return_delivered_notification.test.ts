import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dir, '..', '..', '..');
const source = readFileSync(join(root, 'supabase/queries/return/fn_mark_return_delivered.sql'), 'utf8');
const migration = () => readFileSync(join(root, 'supabase/migrations/20261001000000_return_delivered_notification.sql'), 'utf8');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
describe('return delivered cutover', () => {
  it('wraps the full canonical body with unchanged service-only signature', () => {
    const sql = migration();
    expect(normalize(sql.match(/AS \$function\$([\s\S]*?)\$function\$;/)?.[1] ?? '')).toBe(normalize(source));
    expect(sql).toContain('public.fn_mark_return_delivered(p_dispute_id UUID)');
    expect(sql).toContain('RETURNS TABLE(success BOOLEAN, error_message TEXT)');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public, pg_temp');
    expect(sql).not.toMatch(/DROP FUNCTION|GRANT EXECUTE/i);
  });
  it('checks deployed authority, restrictive grants and exact partial arbiter', () => {
    const sql = migration();
    for (const token of ["'public.fn_mark_return_delivered(uuid)'::regprocedure", 'p.prosecdef', "has_function_privilege('service_role', p.oid, 'EXECUTE')", "NOT has_function_privilege('anon', p.oid, 'EXECUTE')", "NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')", "p.proconfig = ARRAY['search_path=public, pg_temp']::text[]", 'notifications_source_event_key_user_id_uidx', 'i.indnkeyatts = 2 AND i.indnatts = 2', "pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'"]) expect(sql).toContain(token);
    expect(sql).toContain("has_table_privilege('service_role', 'public.notifications', 'INSERT')");
    expect(sql).toContain('BEGIN;');
    expect(sql.trimEnd()).toEndWith('COMMIT;');
  });
});
