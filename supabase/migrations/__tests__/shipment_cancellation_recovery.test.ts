import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_cancellation_recovery.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-cancellation-refund-status.ts
// prove the behavior in PostgreSQL.
describe('shipment cancellation recovery migration (SQL text)', () => {
  it('is exactly one active migration containing both canonical copies', () => {
    expect(migrations).toHaveLength(1);
    expect(statements(migration)).toContain(statements(read('supabase/queries/orders/shipment_cancellation_recovery.sql')));
    const cancel = read('supabase/queries/orders/fn_cancel_shipment.sql');
    expect(statements(migration)).toContain(statements(cancel).replace(/^DROP FUNCTION[^\n]*\n/m, ''));
  });

  it('drops nothing and grants the recovery read to service_role only', () => {
    expect(migration).not.toMatch(/DROP\s/i);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_get_shipment_cancellation_recovery\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_shipment_cancellation_recovery\([^)]*\) TO service_role;/);
    expect(migration).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  it('runs the recovery read as a locked-down SECURITY DEFINER and rejects non-service callers', () => {
    const body = statements(read('supabase/queries/orders/shipment_cancellation_recovery.sql'));
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path = ''");
    expect(body).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;");
  });

  it('fn_cancel_shipment requires a recorded succeeded refund', () => {
    const cancel = read('supabase/queries/orders/fn_cancel_shipment.sql');
    expect(cancel).toContain("IF v_refund_status IS DISTINCT FROM 'succeeded' THEN");
    expect(cancel).not.toContain('IS NOT NULL AND v_refund_status');
  });
});
