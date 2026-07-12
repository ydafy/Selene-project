import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL_ROOT = join(import.meta.dir, '..', 'orders');

const read = (fileName: string) =>
  readFileSync(join(SQL_ROOT, fileName), 'utf8').replace(/\s+/g, ' ');

describe('fn_cancel_shipment SQL guards', () => {
  it('requires the service role and preserves the explicit actor audit branches', () => {
    const sql = read('fn_cancel_shipment.sql');

    expect(sql).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");
    expect(sql).toContain("RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT;");
    expect(sql).toContain("IF p_cancelled_by_role NOT IN ('buyer', 'seller', 'system') THEN");
    expect(sql).toContain("'Cancelación (' || p_cancelled_by_role || '): ' || p_reason");
    expect(sql).not.toContain('auth.uid() IS DISTINCT FROM v_buyer_id');
    expect(sql).not.toContain('auth.uid() IS DISTINCT FROM v_seller_id');
  });

  it('keeps the pre-existing paid/preparing shipment eligibility gate', () => {
    const sql = read('fn_cancel_shipment.sql');

    expect(sql).toContain("IF v_status NOT IN ('paid', 'preparing') THEN");
    expect(sql).toContain("RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT;");
  });

  it('adds cancellation loss persistence with an optional RPC argument', () => {
    const sql = read('fn_cancel_shipment.sql');

    expect(sql).toContain('p_cancellation_loss_cents BIGINT DEFAULT NULL');
    expect(sql).toContain('actual_stripe_fee_cents');
    expect(sql).toContain('cancellation_loss_cents');
    expect(sql).toContain('LEAST(');
    expect(sql).toContain('COALESCE(v_actual_stripe_fee_cents, 0)');
    expect(sql).toContain('COALESCE(v_cancellation_loss_cents, 0) + v_loss_update_cents');
  });
});
