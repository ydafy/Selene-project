// source-text: resolve-dispute-refund is rewritten in #261 and gets no handler before then (#278, S6), so its index.ts text stays the contract until that rewrite.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

describe('resolve-dispute-refund ordering', () => {
  test('checks the shipment before Stripe and records through the guarded RPC after it', () => {
    const check = src.indexOf('refundBlockedReason(');
    const refund = src.indexOf('stripe.refunds.create(');
    const record = src.indexOf("'fn_record_dispute_refund'");
    expect(check).toBeGreaterThan(-1);
    expect(refund).toBeGreaterThan(check);
    expect(record).toBeGreaterThan(refund);
    expect(src).not.toMatch(/from\('shipments'\)\s*\.update\(/);
  });

  test('refuses a shipment without a payment intent with 422 before Stripe and before any write', () => {
    const refusal = src.indexOf('refundIntentBlockedReason(');
    const refund = src.indexOf('stripe.refunds.create(');
    const firstRpc = src.indexOf('.rpc(');
    expect(refusal).toBeGreaterThan(-1);
    expect(refund).toBeGreaterThan(refusal);
    expect(firstRpc).toBeGreaterThan(refusal);
    expect(src.slice(refusal, refund)).toContain('status: 422');
  });

  test('reads the shipment items in cents and refunds their sum without converting', () => {
    expect(src).toContain(
      ".select('price_at_purchase_cents, shipping_amount_cents')",
    );
    expect(src).toContain('disputeRefundAmountCents(');
    expect(src).not.toMatch(/\* 100\b/);
  });

  test('has no non-Connect refund branch', () => {
    expect(src).not.toContain('fn_complete_shipment_refund');
    expect(src).not.toContain('isConnectPayment');
    expect(src).not.toContain('orders!inner');
  });
});
