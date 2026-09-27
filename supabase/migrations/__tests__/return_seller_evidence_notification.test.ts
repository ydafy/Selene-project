import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dir, '..', '..', '..');
const source = readFileSync(join(root, 'supabase/queries/return/fn_seller_submit_return_evidence.sql'), 'utf8');
const migration = () => readFileSync(join(root, 'supabase/migrations/20261002000000_return_seller_evidence_notification.sql'), 'utf8');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
describe('seller evidence cutover', () => {
  it('embeds the full canonical body and grants authenticated only after replacement', () => {
    const sql = migration();
    expect(normalize(sql.match(/AS \$function\$([\s\S]*?)\$function\$;/)?.[1] ?? '')).toBe(normalize(source));
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public, pg_temp');
    expect(sql).toContain('p_video_url TEXT DEFAULT NULL');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.fn_seller_submit_return_evidence(uuid,text[],text) TO authenticated;');
    expect(sql.indexOf('GRANT EXECUTE')).toBeGreaterThan(sql.indexOf('$function$;'));
  });
  it('guards original ACL, exact settings, client authority and arbiter; checks final ACL', () => {
    const sql = migration();
    for (const token of ["'public.fn_seller_submit_return_evidence(uuid,text[],text)'::regprocedure", 'p.prosecdef', "has_function_privilege('service_role', p.oid, 'EXECUTE')", "NOT has_function_privilege('anon', p.oid, 'EXECUTE')", "NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')", "p.proconfig = ARRAY['search_path=public, pg_temp']::text[]", 'notifications_source_event_key_user_id_uidx', "pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'"]) expect(sql).toContain(token);
    expect(sql).toContain('p.pronargdefaults = 1');
    expect(sql).toContain("has_function_privilege('authenticated', 'public.fn_seller_submit_return_evidence(uuid,text[],text)', 'EXECUTE')");
    expect(sql).toContain('BEGIN;');
    expect(sql.trimEnd()).toEndWith('COMMIT;');
  });
});
