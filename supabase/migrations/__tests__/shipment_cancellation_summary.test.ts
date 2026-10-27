import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_cancellation_summary.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');
const canonical = read('supabase/queries/orders/shipment_cancellation_summary.sql');
const body = statements(canonical);

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-cancellation-summary.ts
// and the Bruno requests prove the behavior in PostgreSQL.
describe('shipment cancellation summary migration (SQL text)', () => {
  it('is exactly one active migration identical to the canonical copy, after the carrier review one', () => {
    expect(migrations).toHaveLength(1);
    expect(statements(migration)).toBe(body);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
    const review = readdirSync(join(root, 'supabase/migrations')).find((name) =>
      name.endsWith('_shipment_cancellation_carrier_review.sql'),
    );
    expect(review).toBeDefined();
    expect(migrations[0]! > review!).toBe(true);
  });

  it('is a read-only definer function scoped by auth.uid() with a fixed search_path', () => {
    expect(body).toContain('CREATE OR REPLACE FUNCTION public.fn_get_shipment_cancellation_summary(p_shipment_id UUID)');
    expect(body).toContain('RETURNS TABLE (source TEXT, refund_state TEXT, refund_updated_at TIMESTAMPTZ)');
    expect(body).toContain('STABLE');
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path = ''");
    expect(body).toContain('auth.uid()');
    expect(body).toContain('ord.buyer_id = auth.uid()');
    expect(body).toContain('s.seller_id = auth.uid()');
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('exposes no amount, refund id, payment intent, reason, actor or note', () => {
    const select = body.slice(body.indexOf('SELECT o.source'), body.indexOf('FROM public.shipment_cancellation_operations'));
    for (const hidden of ['refund_id', 'refund_request', 'reason', 'actor_id', 'note', 'amount', 'payment_intent', 'resolved_by']) {
      expect(select).not.toContain(hidden);
    }
  });

  it('is callable by signed-in users only', () => {
    const fn = 'public.fn_get_shipment_cancellation_summary(UUID)';
    expect(body).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon;`);
    expect(body).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated;`);
    expect(body).not.toMatch(/GRANT EXECUTE[^;]*(anon|PUBLIC)/);
  });
});
