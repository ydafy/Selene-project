import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root = join(import.meta.dir, '..', '..', '..');
const source = readFileSync(join(root, 'supabase/queries/return/fn_seller_submit_return_evidence.sql'), 'utf8');
const migration = () => readFileSync(join(root, 'supabase/migrations/20261002000000_return_seller_evidence_notification.sql'), 'utf8');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
describe('seller evidence cutover', () => {
  it('embeds the full canonical body and grants authenticated only after replacement', () => {
    const sql = migration();
    const installed = sql.match(/AS \$function\$([\s\S]*?)\$function\$;/)![1].replace(/\r\n/g, '\n');
    const forward = readFileSync(join(root, 'supabase/migrations/20261008013951_notification_copy_polish.sql'), 'utf8');
    const signature = 'public.fn_seller_submit_return_evidence(uuid,text[],text)';
    expect(forward.split(`('${signature}',`)).toHaveLength(2);
    for (const guard of ["md5(btrim(replace(body, E'\\r\\n', E'\\n'), E'\\n'))", 'IS DISTINCT FROM target.expected_body_md5', 'pg_catalog.quote_literal(target.old_copy[i])', 'pg_catalog.quote_literal(target.new_copy[i])', '/ length(old_literal) <> 1', 'strpos(definition, new_literal) <> 0', "after_catalog - 'prosrc' - 'proargdefaults'", 'after_defaults IS DISTINCT FROM before_defaults', "(after_catalog->>'prosrc') IS DISTINCT FROM patched_body", 'pg_catalog.to_regprocedure(target.identity)::oid IS DISTINCT FROM function_oid']) expect(forward).toContain(guard);
    const target = forward.split(`('${signature}',`)[1]?.split(/\n      \('public\.|\) AS targets/)[0] ?? '';
    const priorFingerprint = 'f41050fdee9a7fc407f581f2d070573d';
    expect(createHash('md5').update(installed.replace(/^\n+|\n+$/g, '')).digest('hex')).toBe(priorFingerprint);
    expect(target).toContain(`'${priorFingerprint}', 1,`);
    const pairs = [
      ['Evidencia del retorno recibida', 'Tu disputa se reabrió para revisión'],
      ['El vendedor presentó evidencia del retorno. Consulta el estado de tu caso.', 'El vendedor reportó un problema con el producto devuelto y presentó evidencia. La misma disputa se reabrió para revisar esa evidencia. Consulta los detalles del caso en tu pedido.'],
    ];
    const arrays = [...target.matchAll(/ARRAY\[([\s\S]*?)\]/g)].map(match => [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map(literal => literal[1]));
    expect(arrays).toEqual([pairs.map(pair => pair[0]), pairs.map(pair => pair[1])]);
    let expectedHistorical = source.replace(/\r\n/g, '\n');
    let polished = installed;
    for (const [oldCopy, newCopy] of pairs) {
      const oldLiteral = `'${oldCopy.replace(/'/g, "''")}'`;
      const newLiteral = `'${newCopy.replace(/'/g, "''")}'`;
      expect(installed.split(oldLiteral)).toHaveLength(2);
      expect(installed).not.toContain(newLiteral);
      expect(expectedHistorical.split(newLiteral)).toHaveLength(2);
      expectedHistorical = expectedHistorical.replace(newLiteral, oldLiteral);
      polished = polished.replace(oldLiteral, newLiteral);
    }
    expect(installed.trim()).toBe(expectedHistorical.trim());
    expect(polished.trim()).toBe(source.replace(/\r\n/g, '\n').trim());
    expect(normalize(polished)).toBe(normalize(source));
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public, pg_temp');
    expect(sql).toContain('p_video_url TEXT DEFAULT NULL');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.fn_seller_submit_return_evidence(uuid,text[],text) TO authenticated;');
    expect(sql.indexOf('GRANT EXECUTE')).toBeGreaterThan(sql.indexOf('$function$;'));
  });
  it('guards original ACL, exact settings, client authority and arbiter; checks final ACL', () => {
    const sql = migration();
    for (const token of ["'public.fn_seller_submit_return_evidence(uuid,text[],text)'::regprocedure", 'p.prosecdef', "has_function_privilege('service_role', p.oid, 'EXECUTE')", "NOT has_function_privilege('anon', p.oid, 'EXECUTE')", "NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')", "p.proconfig = ARRAY['search_path=public']::text[]", 'notifications_source_event_key_user_id_uidx', "pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'"]) expect(sql).toContain(token);
    expect(sql).toContain('p.pronargdefaults = 1');
    expect(sql).toContain("has_function_privilege('authenticated', 'public.fn_seller_submit_return_evidence(uuid,text[],text)', 'EXECUTE')");
    expect(sql).toContain('BEGIN;');
    expect(sql.trimEnd()).toEndWith('COMMIT;');
  });
});
