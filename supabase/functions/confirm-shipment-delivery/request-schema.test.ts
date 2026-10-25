import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { ConfirmationRequestSchema } from './request-schema.ts';

const orderId = '00000000-0000-4000-8000-0000000000d1';
const shipmentId = '00000000-0000-4000-8000-0000000000c1';
const validRequest = {
  orderId,
  shipmentId,
  idempotencyKey: `confirm_shipment_${shipmentId}`,
};

describe('confirm-shipment-delivery request schema', () => {
  it('accepts a confirmation keyed to its shipment', () => {
    expect(ConfirmationRequestSchema.safeParse(validRequest).data).toEqual(
      validRequest,
    );
  });

  it('rejects an idempotency key for another shipment', () => {
    const result = ConfirmationRequestSchema.safeParse({
      ...validRequest,
      idempotencyKey: 'confirm_shipment_other',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['idempotencyKey']);
  });

  it('rejects unknown keys and non-RFC ids, which zod 3 accepted', () => {
    const unknownKey = ConfirmationRequestSchema.safeParse({
      ...validRequest,
      amount: 1,
    });
    const nonRfc = ConfirmationRequestSchema.safeParse({
      ...validRequest,
      orderId: '11111111-2222-3333-4444-555555555555',
    });

    expect(unknownKey.error?.issues[0]?.code).toBe('unrecognized_keys');
    expect(nonRfc.error?.issues[0]).toMatchObject({
      code: 'invalid_format',
      format: 'uuid',
      path: ['orderId'],
    });
  });

  it('is the schema the entrypoint validates with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('ConfirmationRequestSchema.safeParse(body)');
  });
});
