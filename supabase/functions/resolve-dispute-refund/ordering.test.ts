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
});
