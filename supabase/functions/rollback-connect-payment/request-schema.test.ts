import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { RollbackConnectPaymentRequestSchema } from './request-schema.ts';

describe('rollback-connect-payment request schema', () => {
  it('accepts an order id with one to twenty PaymentIntent ids', () => {
    const result = RollbackConnectPaymentRequestSchema.safeParse({
      orderId: 'order_1',
      paymentIntentIds: ['pi_1', 'pi_2'],
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      orderId: 'order_1',
      paymentIntentIds: ['pi_1', 'pi_2'],
    });
    expect(
      RollbackConnectPaymentRequestSchema.safeParse({
        orderId: 'order_1',
        paymentIntentIds: Array.from({ length: 20 }, (_, i) => `pi_${i}`),
      }).success,
    ).toBe(true);
  });

  it('rejects an empty PaymentIntent list with one too_small issue', () => {
    const result = RollbackConnectPaymentRequestSchema.safeParse({
      orderId: 'order_1',
      paymentIntentIds: [],
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'too_small',
      path: ['paymentIntentIds'],
    });
  });

  it('rejects more than twenty PaymentIntent ids with one too_big issue', () => {
    const result = RollbackConnectPaymentRequestSchema.safeParse({
      orderId: 'order_1',
      paymentIntentIds: Array.from({ length: 21 }, (_, i) => `pi_${i}`),
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'too_big',
      path: ['paymentIntentIds'],
    });
  });

  it('rejects an empty order id or PaymentIntent id', () => {
    const result = RollbackConnectPaymentRequestSchema.safeParse({
      orderId: '',
      paymentIntentIds: [''],
    });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['orderId'],
      ['paymentIntentIds', 0],
    ]);
  });

  it('is the schema the entrypoint parses with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('RollbackConnectPaymentRequestSchema.parse(');
  });
});
