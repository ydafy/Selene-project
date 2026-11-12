import { describe, expect, it } from 'bun:test';

import { ShipmentTrackingUrlRequestSchema } from './request-schema.ts';

describe('resolve-shipment-tracking-url request schema', () => {
  it('accepts an RFC 9562 shipment id', () => {
    const result = ShipmentTrackingUrlRequestSchema.safeParse({
      shipmentId: 'c61db80d-30df-4f93-8a3f-52e3708c3f42',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a shipment id with a non-RFC variant, which zod 3 accepted', () => {
    const result = ShipmentTrackingUrlRequestSchema.safeParse({
      shipmentId: '11111111-2222-3333-4444-555555555555',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'invalid_format',
      format: 'uuid',
      path: ['shipmentId'],
    });
  });
});
