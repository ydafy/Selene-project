import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const dir = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const prior = read('../20260929000000_dispute_seller_verdict_notification.sql').match(/AS \$\$([\s\S]*?)\$\$;/)![1];
const fingerprint = '0617e9508ed1e6387a382df3940899b0';
const signature = 'public.fn_resolve_dispute_to_seller_as_admin(uuid,text,uuid)';

test('installs mandatory verified actor with exact complete legacy body parity', () => {
  const files = readdirSync(dir).filter(name => name.endsWith('_seller_dispute_verified_admin.sql'));
  expect(files).toHaveLength(1);
  expect(files[0] > '20261003043340_buyer_dispute_verified_admin.sql').toBe(true);
  const sql = read(`../${files[0]}`);
  const canonical = read('../../queries/disputes/fn_resolve_dispute_to_seller_as_admin.sql');
  const legacy = read('../../queries/disputes/fn_resolve_dispute_to_seller.sql');
  const expected = legacy
    .replace('-- A. SEGURIDAD: Obtener ID desde JWT y validar sesión', '-- A. SECURITY: Actor supplied only by the verified-admin service boundary')
    .replace("v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;", 'v_auth_user_id := p_admin_id;')
    .replace('UNAUTHORIZED_NO_SESSION', 'UNAUTHORIZED_NO_ACTOR');
  const installed = sql.match(/AS \$\$([\s\S]*?)\$\$;/)![1];
  expect(installed).toBe(expected);
  const forward = read('../20261008013951_notification_copy_polish.sql');
  expect(forward.split(`('${signature}',`)).toHaveLength(2);
  for (const guard of ["md5(btrim(replace(body, E'\\r\\n', E'\\n'), E'\\n'))", 'IS DISTINCT FROM target.expected_body_md5', 'pg_catalog.quote_literal(target.old_copy[i])', 'pg_catalog.quote_literal(target.new_copy[i])', '/ length(old_literal) <> 1', 'strpos(definition, new_literal) <> 0', "after_catalog - 'prosrc' - 'proargdefaults'", 'after_defaults IS DISTINCT FROM before_defaults', "(after_catalog->>'prosrc') IS DISTINCT FROM patched_body", 'pg_catalog.to_regprocedure(target.identity)::oid IS DISTINCT FROM function_oid']) expect(forward).toContain(guard);
  const target = forward.split(`('${signature}',`)[1]?.split(/\n      \('public\.|\) AS targets/)[0] ?? '';
  const priorFingerprint = '72cc6c70d1a6edeb6a760a2289ca8055';
  expect(createHash('md5').update(installed.replace(/^\n+|\n+$/g, '')).digest('hex')).toBe(priorFingerprint);
  expect(target).toContain(`'${priorFingerprint}', 0,`);
  const pairs = [
    ['La disputa se resolvió a tu favor. Consulta el pedido para conocer el estado del pago.', 'El equipo de Selene resolvió la disputa a tu favor. Una vez liberado el pago, el depósito puede tardar 1–4 días hábiles, dependiendo de tu banco. Consulta el estado del pago en tu pedido.'],
    ['Disputa resuelta', 'Disputa resuelta a favor del vendedor'],
    ['La disputa se resolvió a favor del vendedor. Consulta el pedido para conocer los detalles.', 'El equipo de Selene resolvió la disputa a favor del vendedor. No se aprobó un reembolso para esta disputa. Consulta los detalles en tu pedido.'],
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
  expect(polished).toBe(canonical);
  expect(sql).toMatch(/CREATE FUNCTION public\.fn_resolve_dispute_to_seller_as_admin\(\s*p_dispute_id UUID,\s*p_admin_note TEXT,\s*p_admin_id UUID\s*\)/);
  expect(sql).toContain('SECURITY DEFINER\nSET search_path = public, pg_temp');
  expect(sql).not.toMatch(/\bDEFAULT\b|CREATE OR REPLACE|request\.jwt|set_config/i);
  expect(canonical).toMatch(/IF v_auth_user_id IS NULL THEN\s*RAISE EXCEPTION 'UNAUTHORIZED_NO_ACTOR'/);
  expect(canonical).toContain("WHERE id = v_auth_user_id AND role = 'admin'");
  expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
  expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
  expect(sql).not.toMatch(/GRANT EXECUTE[^;]*(?:anon|authenticated)/i);
  expect(sql.indexOf('REVOKE ALL')).toBeGreaterThan(sql.indexOf('CREATE FUNCTION'));
  expect(sql).toMatch(/BEGIN;\s*SET LOCAL lock_timeout = '5s';\s*SET LOCAL statement_timeout = '60s';/);
  expect(sql.trimEnd()).toEndWith('COMMIT;');
  const preflight = sql.split('CREATE FUNCTION')[0];
  for (const marker of ["p.proname = 'fn_resolve_dispute_to_seller_as_admin'", "'public.fn_resolve_dispute_to_seller(uuid,text)'::regprocedure",
    'p.prosecdef', 'p.pronargdefaults = 0', "p.proconfig = ARRAY['search_path=public, pg_temp']::text[]",
    "has_function_privilege('service_role'", "NOT has_function_privilege('anon'", "NOT has_function_privilege('authenticated'",
    'pg_catalog.aclexplode', "acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'"]) expect(preflight).toContain(marker);
  expect(preflight).toContain(String.raw`md5(replace(p.prosrc, E'\r\n', E'\n')) = '${fingerprint}'`);
  expect(preflight.match(/IF NOT EXISTS \(([\s\S]*?)\) THEN/)?.[1]).not.toMatch(/@>|<@|\bOR\b/i);
});

test('raw N5e fingerprint accepts LF/CRLF only and rejects changed SQL or whitespace', () => {
  const digest = (body: string) => createHash('md5').update(body.replace(/\r\n/g, '\n')).digest('hex');
  expect(digest(prior)).toBe(fingerprint);
  expect(digest(prior.replace(/\n/g, '\r\n'))).toBe(fingerprint);
  for (const changed of [prior.trim(), `${prior} `, prior.replace('\n', '\r'), prior.replace('UNAUTHORIZED_NO_SESSION', 'UNAUTHORIZED_CHANGED')]) {
    expect(digest(changed)).not.toBe(fingerprint);
  }
});
