import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';

import {
  assertValidCheckoutAllocation,
  calculateCheckoutAllocation,
  CONNECT_COMMISSION_RATE,
  type SellerAllocationInput,
} from './fee-calculator.ts';

// Stripe's published MX domestic card fee on a charge of T cents is 3.6% of T
// plus 300 cents, plus 16% IVA on that fee: fee = (T * 36 / 1_000 + 300) * 116 / 100.
// Scaled by 100_000 to stay exact: fee * 100_000 = T * 36 * 116 + 300 * 116 * 1_000.
const stripeFeeTimes100k = (totalCents: bigint) =>
  totalCents * 36n * 116n + 300n * 116n * 1_000n;

// T covers the fee when what is left after it still pays the subtotal: T - fee >= subtotal.
const coversStripeFee = (buyerTotalCents: number, subtotalCents: number) => {
  const total = BigInt(buyerTotalCents);
  return (
    total * 100_000n - stripeFeeTimes100k(total) >=
    BigInt(subtotalCents) * 100_000n
  );
};

// Publication economics accept commission rates in [0, 1].
const commissionRateArbitrary = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.constantFrom(0, CONNECT_COMMISSION_RATE, 0.1, 1),
);

// Below the $10 MXN product minimum on purpose, so the math is exercised there too.
// A subtotal of 0 is rejected (#294), so every generated row is positive.
const positiveSubtotalArbitrary = fc.oneof(
  fc.integer({ min: 1, max: 100_000_000 }),
  fc.constantFrom(1, 100, 10_000),
);

const idsArbitrary = (minLength: number) =>
  fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
    minLength,
    maxLength: 8,
  });

// Shipping is drawn as a fraction of what is left after the largest possible
// rounded commission, so every generated shipment has a non-negative net.
const economicCheckoutArbitrary = fc
  .tuple(
    fc.option(commissionRateArbitrary, { nil: undefined }),
    idsArbitrary(1),
  )
  .chain(([commissionRate, shipmentIds]) =>
    fc.record({
      commissionRate: fc.constant(commissionRate),
      sellers: fc.tuple(
        ...shipmentIds.map((shipmentId) =>
          fc
            .record({
              sellerId: fc.constantFrom('seller-a', 'seller-b', 'seller-c'),
              subtotalCents: positiveSubtotalArbitrary,
              shippingShare: fc.double({ min: 0, max: 1, noNaN: true }),
            })
            .map(
              ({ sellerId, subtotalCents, shippingShare }) =>
                ({
                  sellerId,
                  shipmentId,
                  subtotalCents,
                  shippingCents: Math.floor(
                    (subtotalCents -
                      Math.ceil(
                        subtotalCents *
                          (commissionRate ?? CONNECT_COMMISSION_RATE),
                      )) *
                      shippingShare,
                  ),
                }) satisfies SellerAllocationInput,
            ),
        ),
      ),
    }),
  );

const sumOf = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0);

describe('calculateCheckoutAllocation properties', () => {
  it('pays each seller exactly subtotal minus commission minus shipping, never negative', () => {
    fc.assert(
      fc.property(economicCheckoutArbitrary, ({ commissionRate, sellers }) => {
        const allocation = calculateCheckoutAllocation(sellers, {
          commissionRate,
        });
        const rate = commissionRate ?? CONNECT_COMMISSION_RATE;

        expect(allocation.rows.map((row) => row.shipmentId)).toEqual(
          sellers.map((seller) => seller.shipmentId),
        );
        allocation.rows.forEach((row, index) => {
          const seller = sellers[index];
          expect(row.sellerId).toBe(seller.sellerId);
          expect(row.grossCents).toBe(seller.subtotalCents);
          expect(row.shippingCents).toBe(seller.shippingCents);
          expect(
            Math.abs(row.commissionCents - seller.subtotalCents * rate),
          ).toBeLessThanOrEqual(0.5);
          expect(row.netCents).toBe(
            seller.subtotalCents - row.commissionCents - seller.shippingCents,
          );
          expect(row.netCents).toBeGreaterThanOrEqual(0);
        });
      }),
      { numRuns: 1_000 },
    );
  });

  it('splits the buyer total exactly into seller nets, commissions, shipping, and seguro', () => {
    fc.assert(
      fc.property(economicCheckoutArbitrary, ({ commissionRate, sellers }) => {
        const allocation = calculateCheckoutAllocation(sellers, {
          commissionRate,
        });
        const { rows } = allocation;

        for (const row of rows) {
          for (const value of [
            row.grossCents,
            row.commissionCents,
            row.shippingCents,
            row.seguroCents,
            row.netCents,
          ]) {
            expect(Number.isSafeInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
        }
        expect(allocation.totalGrossCents).toBe(
          sumOf(sellers.map((seller) => seller.subtotalCents)),
        );
        expect(sumOf(rows.map((row) => row.seguroCents))).toBe(
          allocation.totalSeguroCents,
        );
        expect(allocation.buyerTotalCents).toBe(
          allocation.totalGrossCents + allocation.totalSeguroCents,
        );
        expect(
          sumOf(
            rows.map(
              (row) =>
                row.netCents +
                row.commissionCents +
                row.shippingCents +
                row.seguroCents,
            ),
          ),
        ).toBe(allocation.buyerTotalCents);
        expect(allocation.totalCommissionCents).toBe(
          sumOf(rows.map((row) => row.commissionCents)),
        );
        expect(allocation.totalShippingCents).toBe(
          sumOf(rows.map((row) => row.shippingCents)),
        );
        expect(allocation.totalReleaseCents).toBe(
          sumOf(rows.map((row) => row.netCents)),
        );
        expect(() => assertValidCheckoutAllocation(allocation)).not.toThrow();
      }),
      { numRuns: 1_000 },
    );
  });

  it('charges a seguro that covers the Stripe fee on the whole checkout, split by subtotal', () => {
    fc.assert(
      fc.property(economicCheckoutArbitrary, ({ commissionRate, sellers }) => {
        const allocation = calculateCheckoutAllocation(sellers, {
          commissionRate,
        });
        const totalGross = BigInt(allocation.totalGrossCents);
        const totalSeguro = BigInt(allocation.totalSeguroCents);

        expect(
          coversStripeFee(
            allocation.buyerTotalCents,
            allocation.totalGrossCents,
          ),
        ).toBe(true);
        expect(
          coversStripeFee(
            allocation.buyerTotalCents - 1,
            allocation.totalGrossCents,
          ),
        ).toBe(false);
        for (const row of allocation.rows) {
          // |seguro - totalSeguro * gross / totalGross| < 1, kept in integers.
          const error =
            BigInt(row.seguroCents) * totalGross -
            totalSeguro * BigInt(row.grossCents);
          expect(error < totalGross && error > -totalGross).toBe(true);
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it('rejects a checkout where every subtotal is zero', () => {
    fc.assert(
      fc.property(
        fc.option(commissionRateArbitrary, { nil: undefined }),
        idsArbitrary(1),
        (commissionRate, shipmentIds) => {
          const sellers = shipmentIds.map(
            (shipmentId) =>
              ({
                sellerId: 'seller-a',
                shipmentId,
                subtotalCents: 0,
                shippingCents: 0,
              }) satisfies SellerAllocationInput,
          );

          expect(() =>
            calculateCheckoutAllocation(sellers, { commissionRate }),
          ).toThrow(new Error('INVALID_CHECKOUT_INPUT:non_positive_subtotal'));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects a checkout where any shipment costs the seller more than its subtotal', () => {
    fc.assert(
      fc.property(
        economicCheckoutArbitrary,
        fc.nat(),
        fc.integer({ min: 1, max: 10_000_000 }),
        ({ commissionRate, sellers }, pick, excessCents) => {
          const index = pick % sellers.length;
          const broken = sellers.map((seller, sellerIndex) =>
            sellerIndex === index
              ? {
                  ...seller,
                  shippingCents: seller.subtotalCents + excessCents,
                }
              : seller,
          );

          expect(() =>
            calculateCheckoutAllocation(broken, { commissionRate }),
          ).toThrow(new Error('INVALID_CONNECT_ECONOMICS'));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rejects a shipment whose net is one cent below zero even when shipping fits in the subtotal', () => {
    fc.assert(
      fc.property(
        economicCheckoutArbitrary
          .filter(
            ({ commissionRate }) =>
              (commissionRate ?? CONNECT_COMMISSION_RATE) * 100_000_000 >= 1,
          )
          .chain(({ commissionRate, sellers }) => {
            const rate = commissionRate ?? CONNECT_COMMISSION_RATE;
            return fc.record({
              commissionRate: fc.constant(commissionRate),
              sellers: fc.constant(sellers),
              // A commission of at least one cent keeps shipping <= subtotal below.
              subtotalCents: fc
                .integer({
                  min: Math.min(Math.ceil(1 / rate), 100_000_000),
                  max: 100_000_000,
                })
                .filter(
                  (subtotalCents) => Math.round(subtotalCents * rate) >= 1,
                ),
              pick: fc.nat(),
            });
          }),
        ({ commissionRate, sellers, subtotalCents, pick }) => {
          const rate = commissionRate ?? CONNECT_COMMISSION_RATE;
          const commissionCents = Math.round(subtotalCents * rate);
          const shippingCents = subtotalCents - commissionCents + 1;
          expect(shippingCents).toBeLessThanOrEqual(subtotalCents);
          expect(subtotalCents - commissionCents - shippingCents).toBe(-1);

          const index = pick % sellers.length;
          const broken = sellers.map((seller, sellerIndex) =>
            sellerIndex === index
              ? { ...seller, subtotalCents, shippingCents }
              : seller,
          );

          expect(() =>
            calculateCheckoutAllocation(broken, { commissionRate }),
          ).toThrow(new Error('INVALID_CONNECT_ECONOMICS'));
        },
      ),
      { numRuns: 500 },
    );
  });
});
