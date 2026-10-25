import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const names = readdirSync(join(root, 'supabase/migrations'));
const migrations = names.filter((name) => name.endsWith('_shipment_refund_events_after_resolution.sql'));
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');
const events = read('supabase/queries/orders/shipment_cancellation_refund_events.sql');
const fnStart = 'CREATE OR REPLACE FUNCTION public.fn_apply_shipment_cancellation_refund_event(';
const fromFunction = (sql: string) => sql.slice(sql.indexOf(fnStart));

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-refund-problems.probes.ts
// and scripts/test-shipment-cancellation-refund-events.ts prove the behavior in PostgreSQL.
describe('shipment refund events after resolution migration (SQL text)', () => {
  it('is exactly one active migration, sorted after the refund problems migration', () => {
    expect(migrations).toHaveLength(1);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
    const problems = names.find((name) => name.endsWith('_shipment_refund_problems.sql'));
    expect(migrations[0] > (problems ?? '~')).toBe(true);
  });

  it('contains the canonical function and its grants, and replaces only that function', () => {
    expect(events.indexOf(fnStart)).toBeGreaterThan(-1);
    // BL7 replaced the function in a later migration: this one holds the resolved-operation path.
    const body = fromFunction(events);
    const resolvedPath = body.slice(
      body.indexOf('IF v_operation.refund_resolved_at IS NOT NULL THEN'),
      body.indexOf('v_recorded := public.fn_record_shipment_cancellation_refund('),
    );
    expect(resolvedPath.length).toBeGreaterThan(0);
    expect(statements(migration)).toContain(statements(resolvedPath));
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

  it('never writes on a resolved operation: it validates, then returns unchanged or after_resolution before recording', () => {
    const body = statements(fromFunction(events));
    const resolved = body.indexOf('refund_resolved_at IS NOT NULL');
    expect(resolved).toBeGreaterThan(-1);
    expect(body.indexOf('FROM public.shipments')).toBeLessThan(body.indexOf('FROM public.shipment_cancellation_operations'));
    expect(body.indexOf('FROM public.shipment_cancellation_operations')).toBeLessThan(resolved);
    expect(resolved).toBeLessThan(body.indexOf('public.fn_record_shipment_cancellation_refund('));
    expect(body).toContain("RAISE EXCEPTION 'REFUND_PAYMENT_INTENT_MISMATCH'");
    expect(body).toContain("RAISE EXCEPTION 'REFUND_AMOUNT_MISMATCH'");
    expect(body).toContain("'after_resolution'");
    expect(body).toContain("'resolution_reference'");
    expect(body).toContain('p_refund_id = v_operation.refund_id AND p_status = v_operation.refund_status');
    // The resolved branch is read-only: it must not write anything before the record call.
    const before = body.slice(0, body.indexOf('public.fn_record_shipment_cancellation_refund('));
    expect(before.replace(/FOR UPDATE/g, '')).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('keeps the earlier outcomes listed', () => {
    const body = statements(fromFunction(events));
    for (const outcome of ['ignored', 'completed', 'unchanged', 'recorded', 'failed_after_cancellation', 'failed_before_cancellation', 'after_resolution']) {
      expect(body).toContain(`'${outcome}'`);
    }
  });
});
