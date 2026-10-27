import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const names = readdirSync(join(root, 'supabase/migrations'));
const migrations = names.filter((name) => name.endsWith('_shipment_refund_failure_realert.sql'));
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');
const events = read('supabase/queries/orders/shipment_cancellation_refund_events.sql');
const fnStart = 'CREATE OR REPLACE FUNCTION public.fn_apply_shipment_cancellation_refund_event(';
const fromFunction = (sql: string) => sql.slice(sql.indexOf(fnStart));

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-cancellation-refund-events.ts
// prove the behavior in PostgreSQL.
describe('shipment refund failure re-alert migration (SQL text)', () => {
  it('is exactly one active migration, sorted after the after-resolution migration', () => {
    expect(migrations).toHaveLength(1);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
    const previous = names.find((name) => name.endsWith('_shipment_refund_events_after_resolution.sql'));
    expect(migrations[0] > (previous ?? '~')).toBe(true);
  });

  it('contains the canonical function and its grants, and replaces only that function', () => {
    expect(statements(migration)).toContain(statements(fromFunction(events)));
    expect(migration).not.toMatch(/DROP\s+(FUNCTION|TABLE)/i);
    expect(migration).not.toContain('notifications_event_kind_catalogue_chk');
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_apply_shipment_cancellation_refund_event\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_apply_shipment_cancellation_refund_event\([^)]*\) TO service_role;/,
    );
    expect(migration).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  it('reports a recorded failure again when a failure event is redelivered, not only when it changes', () => {
    const body = statements(fromFunction(events));
    expect(body).toContain(
      "ELSIF v_operation.refund_status IN ('failed', 'canceled')\n" +
        "        AND ((v_recorded->>'changed')::BOOLEAN OR p_status IN ('failed', 'canceled')) THEN",
    );
    // The buyer notice stays idempotent, so a redelivery never adds a second one.
    expect(body).toContain('ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;');
  });
});
