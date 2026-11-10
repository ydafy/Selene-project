// source-text: index.ts starts a Deno server on import, so validating allocation rows before the PaymentIntent and pricing one unit per product are only visible in its text
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('create-connect-payment allocation validation wiring', () => {
  it('asserts the requested-product to shipment-row bijection before PaymentIntent creation', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase/functions/create-connect-payment/index.ts'),
      'utf8',
    );

    const validation = source.indexOf('assertValidAllocationRows({');
    const paymentIntent = source.indexOf('createSinglePaymentIntent({');

    expect(validation).toBeGreaterThan(-1);
    expect(paymentIntent).toBeGreaterThan(validation);
    expect(source).toContain('quantity: 1 as const');
  });
});
