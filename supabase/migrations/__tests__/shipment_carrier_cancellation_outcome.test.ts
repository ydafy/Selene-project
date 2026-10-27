import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_carrier_cancellation_outcome.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');
const outcome = read('supabase/queries/orders/shipment_cancellation_carrier_outcome.sql');
const body = statements(outcome);

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-carrier-cancellation.ts
// prove the behavior in PostgreSQL.
describe('shipment carrier cancellation outcome migration (SQL text)', () => {
  it('is exactly one active migration identical to the canonical copy', () => {
    expect(migrations).toHaveLength(1);
    expect(statements(migration)).toBe(body);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('drops nothing and grants the record RPC to service_role only', () => {
    expect(migration).not.toMatch(/DROP\s/i);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_record_shipment_carrier_cancellation\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_record_shipment_carrier_cancellation\([^)]*\) TO service_role;/,
    );
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_start_shipment_cancellation_refund\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  it('adds the outcome columns with consistency CHECKs', () => {
    expect(body).toContain('ADD COLUMN carrier_cancellation_outcome TEXT');
    expect(body).toContain("carrier_cancellation_outcome IN ('accepted', 'refused', 'ambiguous')");
    expect(body).toContain('ADD COLUMN carrier_cancellation_recorded_at TIMESTAMPTZ');
    expect(body).toContain('ADD COLUMN carrier_balance_returned BOOLEAN');
    expect(body).toContain('ADD COLUMN carrier_balance_returned_at TIMESTAMPTZ');
    expect(body).toContain('ADD COLUMN label_cost_loss_cents BIGINT');
    expect(body).toContain('label_cost_loss_cents >= 0');
    expect(body).toContain('(carrier_cancellation_outcome IS NULL) = (carrier_cancellation_recorded_at IS NULL)');
    expect(body).toContain("carrier_cancellation_outcome IS DISTINCT FROM 'accepted'");
    expect(body).toContain('carrier_balance_returned IS TRUE');
  });

  it('records the outcome as a locked-down SECURITY DEFINER with the label loss computed in SQL', () => {
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path = ''");
    expect(body).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;");
    for (const error of [
      'INVALID_CARRIER_CANCELLATION_OUTCOME',
      'STALE_CANCELLATION_CLAIM',
      'INVALID_CARRIER_CANCELLATION_SOURCE',
      'SHIPMENT_NOT_FOUND',
      'CANCELLATION_CLAIM_EXPIRED',
      'CANCELLATION_EXTERNAL_ALREADY_STARTED',
      'SHIPMENT_NOT_CANCELABLE',
      'CARRIER_CANCELLATION_ALREADY_RECORDED',
    ]) {
      expect(body).toContain(`RAISE EXCEPTION '${error}'`);
    }
    expect(body).toContain('v_shipment.label_provider_cost_cents');
    expect(body).not.toMatch(/p_label_cost|p_loss/i);
    expect(body.indexOf('FROM public.shipments WHERE id = p_shipment_id FOR UPDATE')).toBeGreaterThan(-1);
    expect(body.indexOf('FROM public.shipments WHERE id = p_shipment_id FOR UPDATE')).toBeLessThan(
      body.indexOf('FROM public.shipment_cancellation_operations'),
    );
  });

  it('guards the refund start so a preparing timeout needs an accepted carrier cancellation', () => {
    const start = body.slice(body.indexOf('CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation_refund'));
    expect(start).toContain("v_operation.source = 'preparing_timeout'");
    expect(start).toContain("v_operation.carrier_cancellation_outcome IS DISTINCT FROM 'accepted'");
    expect(start).toContain("RAISE EXCEPTION 'CARRIER_CANCELLATION_NOT_CONFIRMED'");
    expect(start).toContain('SECURITY DEFINER');
    expect(start).toContain("SET search_path = ''");
    // The guard runs before the refund request is frozen on the operation.
    expect(start.indexOf('CARRIER_CANCELLATION_NOT_CONFIRMED')).toBeLessThan(
      start.indexOf('UPDATE public.shipment_cancellation_operations'),
    );
    // Existing validations stay.
    expect(start).toContain("RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST'");
    expect(start).toContain("RAISE EXCEPTION 'INVALID_CANCELLATION_LOSS'");
  });
});
