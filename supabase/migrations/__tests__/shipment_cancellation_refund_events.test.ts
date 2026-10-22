import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_cancellation_refund_events.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');
const events = read('supabase/queries/orders/shipment_cancellation_refund_events.sql');

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-cancellation-refund-events.ts
// prove the behavior in PostgreSQL.
describe('shipment cancellation refund events migration (SQL text)', () => {
  it('is exactly one active migration containing its canonical copy', () => {
    expect(migrations).toHaveLength(1);
    expect(statements(migration)).toContain(statements(events));
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('drops no function or table and grants the RPC to service_role only', () => {
    expect(migration).not.toMatch(/DROP\s+(FUNCTION|TABLE)/i);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_apply_shipment_cancellation_refund_event\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_apply_shipment_cancellation_refund_event\([^)]*\) TO service_role;/,
    );
    expect(migration).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  it('is a locked-down SECURITY DEFINER that reuses the record RPC and the cancel RPC', () => {
    const body = statements(events);
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path = ''");
    expect(body).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;");
    expect(body).toContain('public.fn_record_shipment_cancellation_refund(');
    expect(body).toContain('public.fn_cancel_shipment(');
    expect(body).toContain("RAISE EXCEPTION 'CANCELLATION_COMPLETE_FAILED");
    expect(body.indexOf('FROM public.shipments')).toBeLessThan(body.indexOf('FROM public.shipment_cancellation_operations'));
    for (const outcome of ['ignored', 'completed', 'unchanged', 'recorded', 'failed_after_cancellation', 'failed_before_cancellation']) {
      expect(body).toContain(`'${outcome}'`);
    }
  });

  it('adds the refund_failed event kind to the notification catalogue and inserts it idempotently', () => {
    const body = statements(events);
    expect(body).toContain('DROP CONSTRAINT IF EXISTS notifications_event_kind_catalogue_chk');
    expect(body).toContain("'shipment.refund_failed'");
    for (const kind of [
      'order.payment_confirmed', 'shipment.cancelled', 'dispute.opened', 'dispute.verdict',
      'product.approved', 'product.approved_with_note', 'product.rejected',
      'return.seller_evidence_submitted', 'return.delivered',
    ]) {
      expect(body).toContain(`'${kind}'`);
    }
    expect(body).toContain('ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING');
  });
});
