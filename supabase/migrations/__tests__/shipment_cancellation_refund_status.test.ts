import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_cancellation_refund_status.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-cancellation-refund-status.ts
// prove the behavior in PostgreSQL.
describe('shipment cancellation refund status migration (SQL text)', () => {
  it('is exactly one active migration containing its canonical copy', () => {
    expect(migrations).toHaveLength(1);
    expect(statements(migration)).toContain(statements(read('supabase/queries/orders/shipment_cancellation_refund_status.sql')));
    // fn_cancel_shipment's canonical copy moved on in B2.2 (shipment_cancellation_recovery.test.ts).
  });

  it('drops nothing and grants the record RPC to service_role only', () => {
    expect(migration).not.toMatch(/DROP\s/i);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_record_shipment_cancellation_refund\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_record_shipment_cancellation_refund\([^)]*\) TO service_role;/);
    expect(migration).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });
});
