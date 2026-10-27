import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_late_carrier_activity_acknowledge.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const canonical = read('supabase/queries/orders/shipment_cancellation_late_carrier_activity.sql');
const definition = (sql: string, name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf('\n$$;', start);
  return start === -1 || end === -1 ? '' : sql.slice(start, end + 4);
};

// Text contracts only; `supabase db reset` + scripts/test-shipment-tracking-during-cancellation.ts
// prove the behavior in PostgreSQL.
describe('shipment late carrier activity acknowledge migration (SQL text)', () => {
  it('is one migration after the tracking-during-cancellation migration, in one transaction', () => {
    expect(migrations).toHaveLength(1);
    expect(migrations[0]! > '20261027040000_shipment_tracking_during_cancellation.sql').toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });

  it('keeps each function equal to the canonical file', () => {
    for (const name of ['fn_list_shipment_late_carrier_activity', 'fn_acknowledge_shipment_late_carrier_activity']) {
      const body = definition(migration, name);
      expect(body).not.toBe('');
      expect(canonical).toContain(body);
    }
    expect(canonical).toContain("ADD COLUMN late_carrier_activity_acknowledged_note TEXT");
  });

  it('adds paired acknowledgement columns with a 1-200 character trimmed note', () => {
    for (const column of ['acknowledged_at TIMESTAMPTZ', 'acknowledged_by UUID', 'acknowledged_note TEXT']) {
      expect(migration).toContain(`ADD COLUMN late_carrier_activity_${column}`);
    }
    expect(migration).toContain('BETWEEN 1 AND 200');
    expect(migration).toContain('late_carrier_activity_acknowledged_at IS NULL OR late_carrier_activity_at IS NOT NULL');
  });

  it('lists only unacknowledged rows', () => {
    expect(definition(migration, 'fn_list_shipment_late_carrier_activity')).toContain(
      'AND o.late_carrier_activity_acknowledged_at IS NULL',
    );
  });

  it('checks service role and the active-admin rule, and writes only the acknowledgement columns', () => {
    const body = definition(migration, 'fn_acknowledge_shipment_late_carrier_activity');
    expect(body).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(body).toContain("role = 'admin' AND COALESCE(status::text, 'active') = 'active'");
    expect(body).toContain('ADMIN_REQUIRED');
    expect(body).toContain('INVALID_ACKNOWLEDGEMENT_NOTE');
    expect(body).toContain('LATE_CARRIER_ACTIVITY_NOT_FOUND');
    expect(body).toContain('FOR UPDATE');
    expect(body.match(/UPDATE public\./g)).toHaveLength(1);
    const update = body.slice(body.indexOf('UPDATE public.'), body.indexOf('RETURNING'));
    expect(update).toContain('public.shipment_cancellation_operations');
    expect(update.match(/late_carrier_activity_acknowledged_\w+ =/g)).toHaveLength(3);
    expect(update).not.toMatch(/\b(refund_\w+|status|external_\w+) =/);
    // No shipment or order write, no refund call.
    expect(body).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+public\.(shipments|orders)\b/);
  });

  it('restates service-only grants for both functions', () => {
    for (const signature of [
      'fn_list_shipment_late_carrier_activity()',
      'fn_acknowledge_shipment_late_carrier_activity(UUID, UUID, TEXT)',
    ]) {
      expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
    expect(migration).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
  });
});
