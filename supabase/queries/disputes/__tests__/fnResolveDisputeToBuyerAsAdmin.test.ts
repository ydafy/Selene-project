import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(`../${name}.sql`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim();

test('complete buyer body differs only in verified identity prologue and approved seller copy', () => {
  const old = read('fn_resolve_dispute_to_buyer');
  const source = read('fn_resolve_dispute_to_buyer_as_admin');
  const expected = old.replace('-- A. SEGURIDAD: Obtener ID desde JWT y validar sesión',
    '-- A. SECURITY: Actor supplied only by the verified-admin service boundary')
    .replace("(current_setting('request.jwt.claims', true)::json->>'sub')::UUID", 'p_admin_id')
    .replace('UNAUTHORIZED_NO_SESSION', 'UNAUTHORIZED_NO_ACTOR')
    .replace("'Veredicto: Generar Guía'", "'Disputa resuelta a favor del comprador'")
    .replace("'Se aprobó la devolución. Consulta el pedido para generar la guía de retorno y continuar el proceso.'",
      "'El equipo de Selene resolvió la disputa a favor del comprador. Sigue las instrucciones del pedido en la app para coordinar la devolución de tu producto.'");
  expect(source).toBe(expected);
  expect(source).toMatch(/IF v_auth_user_id IS NULL THEN\s*RAISE EXCEPTION 'UNAUTHORIZED_NO_ACTOR'/);
  expect(source).toContain("WHERE id = v_auth_user_id AND role = 'admin'");
  expect(source.indexOf("role = 'admin'")).toBeLessThan(source.indexOf('FOR UPDATE'));
  expect(source).not.toMatch(/request.jwt|set_config|auth.uid/);
});
