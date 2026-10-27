import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { ReconcileConnectPaymentsRequestSchema } from './request-schema.ts';

describe('reconcile-connect-payments request schema', () => {
  it('accepts an empty body and up to fifty PaymentIntent ids', () => {
    const empty = ReconcileConnectPaymentsRequestSchema.safeParse({});

    expect(empty.success).toBe(true);
    expect(empty.data).toEqual({});
    expect(
      ReconcileConnectPaymentsRequestSchema.safeParse({
        paymentIntentIds: Array.from({ length: 50 }, (_, i) => `pi_${i}`),
      }).success,
    ).toBe(true);
  });

  it('rejects more than fifty PaymentIntent ids with one too_big issue', () => {
    const result = ReconcileConnectPaymentsRequestSchema.safeParse({
      paymentIntentIds: Array.from({ length: 51 }, (_, i) => `pi_${i}`),
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'too_big',
      path: ['paymentIntentIds'],
    });
  });

  it('rejects an empty PaymentIntent id', () => {
    const result = ReconcileConnectPaymentsRequestSchema.safeParse({
      paymentIntentIds: [''],
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'too_small',
      path: ['paymentIntentIds', 0],
    });
  });

  it('is the schema the entrypoint parses with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('ReconcileConnectPaymentsRequestSchema.parse(');
  });
});
