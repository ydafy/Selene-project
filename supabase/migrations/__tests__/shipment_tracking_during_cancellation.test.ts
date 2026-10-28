import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_tracking_during_cancellation.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const definition = (sql: string, name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf('\n$$;', start);
  return start === -1 || end === -1 ? '' : sql.slice(start, end + 4);
};
const bodyOf = (sql: string) => {
  const open = sql.indexOf('AS $$\n');
  return open === -1 ? sql : sql.slice(open + 6, sql.lastIndexOf('\n$$;'));
};

// Text contracts only; `supabase db reset` + scripts/test-shipment-tracking-during-cancellation.ts
// prove the behavior in PostgreSQL.
describe('shipment tracking during cancellation migration (SQL text)', () => {
  it('is one migration after the fn_cancel_order drop, in one transaction', () => {
    expect(migrations).toHaveLength(1);
    expect(migrations[0]! > '20261027030000_drop_fn_cancel_order.sql').toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });

  it('keeps each changed function equal to its canonical file', () => {
    const confirm = bodyOf(definition(migration, 'fn_confirm_shipment_delivery'));
    const mark = bodyOf(definition(migration, 'fn_mark_shipment_delivered'));
    expect(collapse(read('supabase/queries/orders/fn_confirm_shipment_delivery.sql'))).toBe(collapse(confirm));
    expect(collapse(read('supabase/queries/shipments/fn_mark_shipment_delivered.sql'))).toBe(collapse(mark));
    const tracking = definition(migration, 'fn_record_tracking_event');
    expect(tracking).not.toBe('');
    expect(read('supabase/queries/tracking/fn_record_tracking_event.sql')).toContain(tracking);
    // The list function is redefined by the acknowledge migration; the canonical file follows that one.
  });

  it('guards on the started cancellation operation after the shipment lock', () => {
    for (const name of ['fn_record_tracking_event', 'fn_mark_shipment_delivered', 'fn_confirm_shipment_delivery']) {
      const body = definition(migration, name);
      expect(body).toContain('external_started_at IS NOT NULL');
      expect(body.indexOf('FOR UPDATE')).toBeGreaterThan(-1);
      expect(body.indexOf('external_started_at IS NOT NULL')).toBeGreaterThan(body.indexOf('FOR UPDATE'));
    }
    expect(definition(migration, 'fn_mark_shipment_delivered')).toContain('SHIPMENT_CANCELLATION_OPERATION_ACTIVE');
    expect(definition(migration, 'fn_confirm_shipment_delivery')).toContain('SHIPMENT_CANCELLATION_OPERATION_ACTIVE');
  });

  it('records the first late scan on the operation without touching the shipment', () => {
    expect(migration).toContain('ADD COLUMN late_carrier_activity_at TIMESTAMPTZ');
    expect(migration).toContain('late_carrier_activity_at IS NULL OR external_started_at IS NOT NULL');
    const tracking = definition(migration, 'fn_record_tracking_event');
    expect(tracking).toContain('late_carrier_activity_at IS NULL');
  });

  it('restates service-only grants for every function it defines', () => {
    const signatures = [
      'fn_confirm_shipment_delivery(uuid, text, uuid, text)',
      'fn_mark_shipment_delivered(uuid)',
      'fn_record_tracking_event(uuid, uuid, public.shipment_tracking_event_type, timestamp with time zone, text, text, text, text, uuid, uuid, public.order_status_enum)',
      'fn_list_shipment_late_carrier_activity()',
    ];
    for (const signature of signatures) {
      expect(migration).toMatch(
        new RegExp(`REVOKE (ALL|EXECUTE) ON FUNCTION public\\.${signature.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon, authenticated;`),
      );
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
    expect(migration).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
  });
});
