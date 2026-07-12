import { describe, expect, it } from 'bun:test';

import { allocateCents, grossUpDomesticMx } from './stripe-fee-gross-up.ts';

describe('grossUpDomesticMx', () => {
  it('grosses up a typical MX subtotal with the exact design formula', () => {
    const result = grossUpDomesticMx(500_000);

    expect(result).toEqual({
      buyerTotalCents: 522_154,
      seguroCents: 22_154,
    });
  });

  it('keeps small subtotals positive and within the bounded rounding slack', () => {
    const subtotalCents = 1_000;
    const result = grossUpDomesticMx(subtotalCents);
    const exactBuyerTotal = (subtotalCents + 348) / 0.95824;

    expect(result.buyerTotalCents).toBeGreaterThan(subtotalCents);
    expect(result.buyerTotalCents - exactBuyerTotal).toBeGreaterThanOrEqual(0);
    expect(result.buyerTotalCents - exactBuyerTotal).toBeLessThanOrEqual(2);
  });
});

describe('allocateCents', () => {
  it('distributes cents proportionally and preserves the total', () => {
    const allocations = allocateCents(10, [
      { id: 'seller-a', cents: 1 },
      { id: 'seller-b', cents: 2 },
      { id: 'seller-c', cents: 3 },
    ]);

    expect(Array.from(allocations.values()).reduce((sum, value) => sum + value, 0)).toBe(10);
    expect(allocations.get('seller-a')).toBe(2);
    expect(allocations.get('seller-b')).toBe(3);
    expect(allocations.get('seller-c')).toBe(5);
  });

  it('breaks equal remainders by id so the allocation is deterministic', () => {
    const allocations = allocateCents(1, [
      { id: 'b-seller', cents: 1 },
      { id: 'a-seller', cents: 1 },
    ]);

    expect(allocations.get('a-seller')).toBe(1);
    expect(allocations.get('b-seller')).toBe(0);
  });
});
