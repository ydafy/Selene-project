import { describe, expect, it } from 'bun:test';

import { computeShipmentRefundAmountCents } from './refund-basis';

describe('computeShipmentRefundAmountCents', () => {
  it('keeps the buyer-paid refund basis for a real paid-shipment example', () => {
    expect(
      computeShipmentRefundAmountCents({
        shipmentItems: [{ price_at_purchase: 3_500, shipping_amount: 242 }],
        orderItems: [{ price_at_purchase: 3_500, shipping_amount: 242 }],
        orderChargeCents: 362_900,
      }),
    ).toBe(362_900);
  });

  it('splits a multi-shipment buyer-paid fee proportionally by subtotal', () => {
    expect(
      computeShipmentRefundAmountCents({
        shipmentItems: [{ price_at_purchase: 3_000, shipping_amount: 110 }],
        orderItems: [
          { price_at_purchase: 3_000, shipping_amount: 110 },
          { price_at_purchase: 2_000, shipping_amount: 75 },
        ],
        orderChargeCents: 510_000,
      }),
    ).toBe(306_000);
  });

  it('ignores seller-paid shipping amounts in the refund basis', () => {
    expect(
      computeShipmentRefundAmountCents({
        shipmentItems: [{ price_at_purchase: 1_200, shipping_amount: 999 }],
        orderItems: [
          { price_at_purchase: 1_200, shipping_amount: 999 },
          { price_at_purchase: 800, shipping_amount: 12_345 },
        ],
        orderChargeCents: 220_000,
      }),
    ).toBe(132_000);
  });
});
