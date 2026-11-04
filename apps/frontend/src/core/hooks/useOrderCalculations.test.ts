import { describe, expect, it } from 'bun:test';

import { calculateOrderCalculations } from './useOrderCalculations';

describe('calculateOrderCalculations', () => {
  it('returns the grossed-up buyer total from integer-cent math', () => {
    expect(
      calculateOrderCalculations([
        { id: 'p1', price: 5 },
        { id: 'p2', price: 3 },
      ] as never),
    ).toEqual({
      subtotal: 8,
      shippingCost: 0,
      serviceFee: 3.99,
      total: 11.99,
      totalInCents: 1199,
      itemCount: 2,
    });
  });

  it('returns zeros for an empty item list', () => {
    expect(calculateOrderCalculations([])).toEqual({
      subtotal: 0,
      shippingCost: 0,
      serviceFee: 0,
      total: 0,
      totalInCents: 0,
      itemCount: 0,
    });
  });
});
