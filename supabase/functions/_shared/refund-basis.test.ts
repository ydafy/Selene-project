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

describe('computeShipmentRefundAmountCents: last shipment rounding remainder', () => {
  // FU1 (order 2514c6e9…): 5,000 + 6,000 + 5,000 pesos, buyer fee 70,092 cents. The first two
  // refunds rounded their fee shares up (21,904 and 26,285), leaving 521,903 for the last one.
  const orderItems = [
    { price_at_purchase: 5_000, shipping_amount: null, shipment_id: 'a' },
    { price_at_purchase: 6_000, shipping_amount: null, shipment_id: 'b' },
    { price_at_purchase: 5_000, shipping_amount: null, shipment_id: 'c' },
  ];
  const lastShipment = [{ price_at_purchase: 5_000, shipping_amount: null, shipment_id: 'c' }];

  it('refunds exactly what is left of the charge when only rounding exceeds it', () => {
    expect(
      computeShipmentRefundAmountCents({
        shipmentItems: lastShipment,
        orderItems,
        orderChargeCents: 1_670_092,
        remainingRefundableCents: 521_903,
      }),
    ).toBe(521_903);
  });

  it('accepts up to one cent of rounding per order shipment', () => {
    expect(
      computeShipmentRefundAmountCents({
        shipmentItems: lastShipment,
        orderItems,
        orderChargeCents: 1_670_092,
        remainingRefundableCents: 521_901,
      }),
    ).toBe(521_901);
  });

  it('still rejects a shortfall larger than one cent per order shipment', () => {
    expect(() =>
      computeShipmentRefundAmountCents({
        shipmentItems: lastShipment,
        orderItems,
        orderChargeCents: 1_670_092,
        remainingRefundableCents: 521_900,
      }),
    ).toThrow('REFUND_AMOUNT_EXCEEDS_CAP');
  });

  it('never refunds less than the shipment subtotal', () => {
    expect(() =>
      computeShipmentRefundAmountCents({
        shipmentItems: [{ price_at_purchase: 10, shipping_amount: null, shipment_id: 'x' }],
        orderItems: [
          { price_at_purchase: 10, shipping_amount: null, shipment_id: 'x' },
          { price_at_purchase: 10, shipping_amount: null, shipment_id: 'y' },
        ],
        orderChargeCents: 2_003,
        remainingRefundableCents: 999,
      }),
    ).toThrow('REFUND_AMOUNT_EXCEEDS_CAP');
  });

  it('keeps the proportional amount when the remaining charge covers it', () => {
    expect(
      computeShipmentRefundAmountCents({
        shipmentItems: lastShipment,
        orderItems,
        orderChargeCents: 1_670_092,
        remainingRefundableCents: 1_670_092,
      }),
    ).toBe(521_904);
  });
});
