import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const dir = new URL('../', import.meta.url);
const signature = 'public.fn_resolve_dispute_to_buyer_as_admin(uuid,text,uuid)';

test('transaction installs exact body and only service-role execution without replacing legacy RPC', () => {
  const files = readdirSync(dir).filter(name => name.endsWith('_buyer_dispute_verified_admin.sql'));
  expect(files).toHaveLength(1);
  const sql = readFileSync(new URL(files[0], dir), 'utf8').replace(/\r\n/g, '\n');
  const body = readFileSync(new URL('../../queries/disputes/fn_resolve_dispute_to_buyer_as_admin.sql', import.meta.url), 'utf8');
  const installed = sql.match(/AS \$\$([\s\S]*?)\$\$;/)![1].replace(/\r\n/g, '\n');
  const legacy = readFileSync(new URL('../../queries/disputes/fn_resolve_dispute_to_buyer.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const expected = legacy
    .replace('-- A. SEGURIDAD: Obtener ID desde JWT y validar sesión', '-- A. SECURITY: Actor supplied only by the verified-admin service boundary')
    .replace("v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;", 'v_auth_user_id := p_admin_id;')
    .replace('UNAUTHORIZED_NO_SESSION', 'UNAUTHORIZED_NO_ACTOR');
  expect(installed).toBe(expected);
  const forward = readFileSync(new URL('../20261008013951_notification_copy_polish.sql', import.meta.url), 'utf8');
  expect(forward.split(`('${signature}',`)).toHaveLength(2);
  for (const guard of ["md5(btrim(replace(body, E'\\r\\n', E'\\n'), E'\\n'))", 'IS DISTINCT FROM target.expected_body_md5', 'pg_catalog.quote_literal(target.old_copy[i])', 'pg_catalog.quote_literal(target.new_copy[i])', '/ length(old_literal) <> 1', 'strpos(definition, new_literal) <> 0', "after_catalog - 'prosrc' - 'proargdefaults'", 'after_defaults IS DISTINCT FROM before_defaults', "(after_catalog->>'prosrc') IS DISTINCT FROM patched_body", 'pg_catalog.to_regprocedure(target.identity)::oid IS DISTINCT FROM function_oid']) expect(forward).toContain(guard);
  const target = forward.split(`('${signature}',`)[1]?.split(/\n      \('public\.|\) AS targets/)[0] ?? '';
  const priorFingerprint = '5719d7156d500821c35db34a99c6cd70';
  expect(createHash('md5').update(installed.replace(/^\n+|\n+$/g, '')).digest('hex')).toBe(priorFingerprint);
  expect(target).toContain(`'${priorFingerprint}', 0,`);
  const pairs = [
    ['Veredicto: Generar Guía', 'Disputa resuelta a favor del comprador'],
    ['Se aprobó la devolución. Consulta el pedido para generar la guía de retorno y continuar el proceso.', 'El equipo de Selene resolvió la disputa a favor del comprador. Sigue las instrucciones del pedido en la app para coordinar la devolución de tu producto.'],
  ];
  const arrays = [...target.matchAll(/ARRAY\[([\s\S]*?)\]/g)].map(match => [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map(literal => literal[1]));
  expect(arrays).toEqual([pairs.map(pair => pair[0]), pairs.map(pair => pair[1])]);
  let polished = installed;
  for (const [oldCopy, newCopy] of pairs) {
    const oldLiteral = `'${oldCopy.replace(/'/g, "''")}'`;
    const newLiteral = `'${newCopy.replace(/'/g, "''")}'`;
    expect(installed.split(oldLiteral)).toHaveLength(2);
    expect(installed).not.toContain(newLiteral);
    polished = polished.replace(oldLiteral, newLiteral);
  }
  expect(polished.trim()).toBe(body.replace(/\r\n/g, '\n').trim());
  expect(sql).toMatch(/CREATE FUNCTION public\.fn_resolve_dispute_to_buyer_as_admin\(\s*p_dispute_id UUID,\s*p_admin_note TEXT,\s*p_admin_id UUID\s*\)/);
  expect(sql).toContain('SECURITY DEFINER\nSET search_path = public, pg_temp');
  expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
  expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
  expect(sql).not.toMatch(/\bDEFAULT\b|CREATE OR REPLACE|GRANT EXECUTE[^;]*authenticated/i);
  expect(sql).toMatch(/^--[^]*?BEGIN;/);
  expect(sql.trimEnd()).toEndWith('COMMIT;');
  const preflight = sql.split('CREATE FUNCTION')[0];
  for (const marker of ["'public.fn_resolve_dispute_to_buyer(uuid,text)'::regprocedure", 'p.prosecdef',
    "p.proconfig = ARRAY['search_path=public, pg_temp']::text[]", 'p.pronargdefaults = 0',
    'pg_catalog.aclexplode', "acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'",
    "NOT has_function_privilege('anon'", "NOT has_function_privilege('authenticated'",
    "has_function_privilege('service_role'", 'gen_random_uuid()',
    'notifications_source_event_key_user_id_uidx', 'i.indisvalid', 'has_column_privilege']) {
    expect(preflight).toContain(marker);
  }
  const n5d = readFileSync(new URL('../20260928000000_dispute_buyer_verdict_notification.sql', import.meta.url), 'utf8');
  const priorBody = n5d.match(/AS \$\$([\s\S]*?)\$\$;/)![1];
  const fingerprint = createHash('md5').update(priorBody.replace(/\r\n/g, '\n')).digest('hex');
  expect(fingerprint).toBe('342deb0887202475426c266b0f12a9a4');
  expect(preflight).toContain(String.raw`md5(replace(p.prosrc, E'\r\n', E'\n')) = '${fingerprint}'`);
  expect(sql.indexOf('REVOKE ALL')).toBeGreaterThan(sql.indexOf('CREATE FUNCTION'));
  expect(sql.indexOf('GRANT EXECUTE')).toBeLessThan(sql.indexOf('COMMIT;'));
});

test('N5d fingerprint tolerates only CRLF pairs, not body or other whitespace changes', () => {
  const n5d = readFileSync(new URL('../20260928000000_dispute_buyer_verdict_notification.sql', import.meta.url), 'utf8');
  const body = n5d.match(/AS \$\$([\s\S]*?)\$\$;/)![1];
  const lf = body.replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  const digest = (source: string) => createHash('md5').update(source.replace(/\r\n/g, '\n')).digest('hex');
  const expected = '342deb0887202475426c266b0f12a9a4';
  expect(digest(lf)).toBe(expected);
  expect(digest(crlf)).toBe(expected);
  expect(createHash('md5').update(crlf).digest('hex')).toBe('d9ecef6f3ba8e054aec02ddccc9498c8');
  expect(lf).toContain('UNAUTHORIZED_NO_SESSION');
  expect(digest(lf.replace('UNAUTHORIZED_NO_SESSION', 'UNAUTHORIZED_CHANGED'))).not.toBe(expected);
  for (const changed of [lf.trim(), `${lf} `, lf.replace('\n', '\r')]) {
    expect(digest(changed)).not.toBe(expected);
  }
});
