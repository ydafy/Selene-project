import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter(
  (name) => name.endsWith('_shipment_cancellation_recovery.sql'),
);
const migration =
  migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter(
      (line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '',
    )
    .join('\n');

// Text contracts only; the local `supabase db reset` + scripts/verify/test-shipment-cancellation-refund-status.ts
// prove the behavior in PostgreSQL.
describe('shipment cancellation recovery migration (SQL text)', () => {
  it('is exactly one active migration holding the strict fn_cancel_shipment guard as deployed in B2.2', () => {
    expect(migrations).toHaveLength(1);
    // B2.2.1 changed the recovery read (shipment_cancellation_escalation.test.ts) and B2.3.1
    // fn_cancel_shipment (shipment_cancellation_refund_resolution.test.ts).
    expect(statements(migration)).toContain(
      "IF v_refund_status IS DISTINCT FROM 'succeeded' THEN",
    );
  });

  it('drops nothing and grants the recovery read to service_role only', () => {
    expect(migration).not.toMatch(/DROP\s/i);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_get_shipment_cancellation_recovery\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_get_shipment_cancellation_recovery\([^)]*\) TO service_role;/,
    );
    expect(migration).not.toMatch(
      /GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i,
    );
  });

  it('runs the recovery read as a locked-down SECURITY DEFINER and rejects non-service callers', () => {
    const body = statements(migration);
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path = ''");
    expect(body).toContain(
      "IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;",
    );
  });
});
