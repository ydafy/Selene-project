import { describe, expect, it } from 'bun:test';

import {
  allocateCancellationLossCents,
  computeShipmentRefundAmountCents,
} from './refund-basis';

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

describe('allocateCancellationLossCents', () => {
  it('returns null when the actual Stripe fee is unreconciled', () => {
    expect(
      allocateCancellationLossCents(null, [
        { shipmentId: 'ship-a', buyerRefundCents: 10_000 },
      ]),
    ).toBeNull();
  });

  it('allocates the actual fee proportionally and keeps the sum exact', () => {
    const allocation = allocateCancellationLossCents(20_000, [
      { shipmentId: 'ship-a', buyerRefundCents: 10_000 },
      { shipmentId: 'ship-b', buyerRefundCents: 10_000 },
    ]);

    expect(allocation?.get('ship-a')).toBe(10_000);
    expect(allocation?.get('ship-b')).toBe(10_000);
    expect(Array.from(allocation?.values() ?? []).reduce((sum, value) => sum + value, 0)).toBe(20_000);
  });

  it('weights the actual fee by buyer refunds and excludes seller shipping reserve', () => {
    const allocation = allocateCancellationLossCents(10_000, [
      {
        shipmentId: 'ship-a',
        buyerRefundCents: 10_000,
        shippingReserveCents: 90_000,
      },
      {
        shipmentId: 'ship-b',
        buyerRefundCents: 30_000,
        shippingReserveCents: 1_000,
      },
    ]);

    expect(allocation?.get('ship-a')).toBe(2_500);
    expect(allocation?.get('ship-b')).toBe(7_500);
  });

  it('breaks equal remainders by shipment id for deterministic partial allocations', () => {
    const allocation = allocateCancellationLossCents(2, [
      { shipmentId: 'ship-b', buyerRefundCents: 1 },
      { shipmentId: 'ship-a', buyerRefundCents: 1 },
      { shipmentId: 'ship-c', buyerRefundCents: 1 },
    ]);

    expect(allocation?.get('ship-a')).toBe(1);
    expect(allocation?.get('ship-b')).toBe(1);
    expect(allocation?.get('ship-c')).toBe(0);
  });
});
