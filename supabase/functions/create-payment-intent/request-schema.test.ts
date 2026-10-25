import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { CreatePaymentIntentRequestSchema } from './request-schema.ts';

const productId = '00000000-0000-4000-8000-0000000000b1';
const addressId = '00000000-0000-4000-8000-0000000000a3';

describe('create-payment-intent request schema', () => {
  it('accepts RFC 9562 ids with an optional idempotency key', () => {
    const request = { productIds: [productId], addressId };

    expect(CreatePaymentIntentRequestSchema.safeParse(request).data).toEqual(
      request,
    );
    expect(
      CreatePaymentIntentRequestSchema.safeParse({
        ...request,
        idempotencyKey: 'key-1',
      }).data,
    ).toEqual({ ...request, idempotencyKey: 'key-1' });
  });

  it('accepts fifty product ids and rejects an empty list', () => {
    expect(
      CreatePaymentIntentRequestSchema.safeParse({
        productIds: Array.from({ length: 50 }, () => productId),
        addressId,
      }).success,
    ).toBe(true);

    const empty = CreatePaymentIntentRequestSchema.safeParse({
      productIds: [],
      addressId,
    });
    expect(empty.error?.issues).toHaveLength(1);
    expect(empty.error?.issues[0]).toMatchObject({
      code: 'too_small',
      path: ['productIds'],
    });
  });

  it('bounds productIds to 50 (BL28): 10,000 bad ids give one too_big issue', () => {
    const result = CreatePaymentIntentRequestSchema.safeParse({
      productIds: Array.from({ length: 10_000 }, () => 'not-a-uuid'),
      addressId,
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'too_big',
      path: ['productIds'],
    });
  });

  it('rejects a non-RFC address id, which zod 3 accepted', () => {
    const result = CreatePaymentIntentRequestSchema.safeParse({
      productIds: [productId],
      addressId: '11111111-2222-3333-4444-555555555555',
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'invalid_format',
      format: 'uuid',
      path: ['addressId'],
    });
  });

  it('is the schema the entrypoint parses with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('CreatePaymentIntentRequestSchema.safeParse(body)');
  });
});
