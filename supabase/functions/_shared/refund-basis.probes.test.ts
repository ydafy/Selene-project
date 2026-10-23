import { describe, expect, it } from 'bun:test';

import { computeShipmentRefundAmountCents } from './refund-basis';

// Verifier probes (L41/FU1, S5/S6): cumulative multi-shipment cancellations never get stranded.
let seed = 0x5eed1234;
const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const items = (prices: number[]) =>
  prices.map((p, i) => ({ price_at_purchase: p, shipping_amount: null, shipment_id: `s${i}` }));
function shuffled(n: number): number[] {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('computeShipmentRefundAmountCents: cumulative multi-shipment cancellation', () => {
  it('refunds every shipment of random orders without exceeding the charge', () => {
    for (let o = 0; o < 3000; o++) {
      const n = int(1, 6);
      const prices = Array.from({ length: n }, () => (rnd() < 0.35 ? [500, 1000, 5000][int(0, 2)] : int(1, 30000)));
      const subtotal = prices.reduce((a, b) => a + b, 0) * 100;
      const fee = Math.round(subtotal * rnd() * 0.05);
      const charge = subtotal + fee;
      const orderItems = items(prices);
      let refunded = 0;
      for (const i of shuffled(n)) {
        const refund = computeShipmentRefundAmountCents({
          shipmentItems: [orderItems[i]],
          orderItems,
          orderChargeCents: charge,
          remainingRefundableCents: charge - refunded,
        });
        refunded += refund;
        expect(refund).toBeGreaterThanOrEqual(prices[i] * 100);
        expect(refunded).toBeLessThanOrEqual(charge);
        const exact = prices[i] * 100 + (fee * prices[i] * 100) / subtotal;
        expect(Math.abs(refund - exact)).toBeLessThan(n);
      }
      // Rounding can leave less than half a cent per shipment on the charge.
      expect(2 * (charge - refunded)).toBeLessThan(n);
    }
  });

  it('refunds FU1 in every cancellation order and ends exactly at the charge', () => {
    const orderItems = items([5000, 6000, 5000]);
    for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      let refunded = 0;
      for (const i of order)
        refunded += computeShipmentRefundAmountCents({
          shipmentItems: [orderItems[i]],
          orderItems,
          orderChargeCents: 1_670_092,
          remainingRefundableCents: 1_670_092 - refunded,
        });
      expect(refunded).toBe(1_670_092);
    }
  });

  it('rejects a shortfall rounding cannot explain instead of clamping it', () => {
    const orderItems = items([5000, 6000, 5000]);
    for (const taken of [2, 4, 100, 50_000])
      expect(() =>
        computeShipmentRefundAmountCents({
          shipmentItems: [orderItems[2]],
          orderItems,
          orderChargeCents: 1_670_092,
          remainingRefundableCents: 1_670_092 - 521_904 - 626_285 - taken,
        }),
      ).toThrow('REFUND_AMOUNT_EXCEEDS_CAP');
  });
});
