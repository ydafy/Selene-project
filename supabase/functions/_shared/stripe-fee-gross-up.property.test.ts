import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';

import { allocateCents, grossUpDomesticMx } from './stripe-fee-gross-up.ts';

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

const realisticCents = fc.oneof(
  fc.integer({ min: 0, max: 100_000_000 }),
  fc.constantFrom(0, 1, 2, 99, 100, 347, 348, 349, 100_000_000),
);

// Largest subtotal whose grossed-up total still fits a safe integer.
const largeCents = fc.integer({ min: 0, max: 8_000_000_000_000_000 });

const invalidCents = fc.oneof(
  fc.integer({ max: -1 }),
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .filter((value) => !Number.isInteger(value)),
  fc.constantFrom(Number.NaN, Infinity, -Infinity, -0.5, 0.5),
);

const sumOf = (values: Iterable<number>) =>
  Array.from(values).reduce((sum, value) => sum + value, 0);

describe('grossUpDomesticMx properties', () => {
  it('charges the buyer the subtotal plus a non-negative integer seguro', () => {
    fc.assert(
      fc.property(fc.oneof(realisticCents, largeCents), (subtotalCents) => {
        const { buyerTotalCents, seguroCents } =
          grossUpDomesticMx(subtotalCents);

        expect(Number.isSafeInteger(buyerTotalCents)).toBe(true);
        expect(Number.isSafeInteger(seguroCents)).toBe(true);
        expect(seguroCents).toBeGreaterThanOrEqual(0);
        expect(buyerTotalCents).toBe(subtotalCents + seguroCents);
      }),
      { numRuns: 2_000 },
    );
  });

  it('always covers the Stripe fee, with the smallest total that does', () => {
    fc.assert(
      fc.property(fc.oneof(realisticCents, largeCents), (subtotalCents) => {
        const { buyerTotalCents } = grossUpDomesticMx(subtotalCents);

        expect(coversStripeFee(buyerTotalCents, subtotalCents)).toBe(true);
        expect(coversStripeFee(buyerTotalCents - 1, subtotalCents)).toBe(false);
      }),
      { numRuns: 2_000 },
    );
  });

  it('never charges less for a larger subtotal', () => {
    fc.assert(
      fc.property(realisticCents, realisticCents, (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];

        expect(grossUpDomesticMx(low).buyerTotalCents).toBeLessThanOrEqual(
          grossUpDomesticMx(high).buyerTotalCents,
        );
      }),
      { numRuns: 1_000 },
    );
  });

  it('rejects any subtotal that is not a non-negative integer', () => {
    fc.assert(
      fc.property(invalidCents, (subtotalCents) => {
        expect(() => grossUpDomesticMx(subtotalCents)).toThrow(
          new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:subtotalCents'),
        );
      }),
      { numRuns: 500 },
    );
  });

  it('rejects a subtotal whose buyer total would not be a safe integer', () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: 8_700_000_000_000_000,
          max: Number.MAX_SAFE_INTEGER,
        }),
        (subtotalCents) => {
          expect(() => grossUpDomesticMx(subtotalCents)).toThrow(
            new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:buyerTotalOverflow'),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

const weightsArbitrary = fc.uniqueArray(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    cents: fc.oneof(
      fc.integer({ min: 0, max: 100_000_000 }),
      fc.constantFrom(0, 1),
    ),
  }),
  { minLength: 1, maxLength: 10, selector: (weight) => weight.id },
);

const positiveWeightsArbitrary = weightsArbitrary.filter(
  (weights) => sumOf(weights.map((weight) => weight.cents)) > 0,
);

describe('allocateCents properties', () => {
  it('splits the total exactly into non-negative integer shares, one per id', () => {
    fc.assert(
      fc.property(
        realisticCents,
        positiveWeightsArbitrary,
        (totalCents, weights) => {
          const allocations = allocateCents(totalCents, weights);

          expect([...allocations.keys()].sort()).toEqual(
            weights.map((weight) => weight.id).sort(),
          );
          for (const share of allocations.values()) {
            expect(Number.isSafeInteger(share)).toBe(true);
            expect(share).toBeGreaterThanOrEqual(0);
          }
          expect(sumOf(allocations.values())).toBe(totalCents);
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it('gives each id its proportional share, off by less than one cent', () => {
    fc.assert(
      fc.property(
        realisticCents,
        positiveWeightsArbitrary,
        (totalCents, weights) => {
          const allocations = allocateCents(totalCents, weights);
          const totalWeight = BigInt(sumOf(weights.map((w) => w.cents)));

          for (const weight of weights) {
            // |share - total * w / W| < 1, kept in integers: |share * W - total * w| < W.
            const share = BigInt(allocations.get(weight.id) ?? -1);
            const error =
              share * totalWeight - BigInt(totalCents) * BigInt(weight.cents);
            expect(error < totalWeight && error > -totalWeight).toBe(true);
          }
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it('does not depend on the order of the weights', () => {
    fc.assert(
      fc.property(
        realisticCents,
        positiveWeightsArbitrary.chain((weights) =>
          fc.tuple(
            fc.constant(weights),
            fc.shuffledSubarray(weights, {
              minLength: weights.length,
            }),
          ),
        ),
        (totalCents, [weights, shuffled]) => {
          const ordered = allocateCents(totalCents, weights);
          const reordered = allocateCents(totalCents, shuffled);

          for (const weight of weights) {
            expect(reordered.get(weight.id)).toBe(ordered.get(weight.id));
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it('allocates zero to every id when all weights are zero and the total is zero', () => {
    fc.assert(
      fc.property(
        weightsArbitrary.map((weights) =>
          weights.map((weight) => ({ ...weight, cents: 0 })),
        ),
        (weights) => {
          const allocations = allocateCents(0, weights);

          expect(allocations.size).toBe(weights.length);
          expect([...allocations.values()].every((share) => share === 0)).toBe(
            true,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects a positive total over weights that are all zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        weightsArbitrary.map((weights) =>
          weights.map((weight) => ({ ...weight, cents: 0 })),
        ),
        (totalCents, weights) => {
          expect(() => allocateCents(totalCents, weights)).toThrow(
            new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:zero_weight_total'),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects an invalid total, an empty weight list, and an invalid weight', () => {
    fc.assert(
      fc.property(invalidCents, positiveWeightsArbitrary, (total, weights) => {
        expect(() => allocateCents(total, weights)).toThrow(
          new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:totalCents'),
        );
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(realisticCents, (totalCents) => {
        expect(() => allocateCents(totalCents, [])).toThrow(
          new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:empty_weights'),
        );
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(
        realisticCents,
        positiveWeightsArbitrary,
        invalidCents,
        (totalCents, weights, badCents) => {
          const [first, ...rest] = weights;
          expect(() =>
            allocateCents(totalCents, [{ ...first, cents: badCents }, ...rest]),
          ).toThrow(
            new Error(`INVALID_STRIPE_FEE_GROSS_UP_INPUT:weight:${first.id}`),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
