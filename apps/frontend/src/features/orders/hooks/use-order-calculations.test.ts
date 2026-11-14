import { describe, expect, it } from 'bun:test';

import { calculateOrderCalculations } from './use-order-calculations';

describe('calculateOrderCalculations', () => {
  it('returns the grossed-up buyer total from integer-cent math', () => {
    expect(
      calculateOrderCalculations([
        { id: 'p1', price_cents: 500 },
        { id: 'p2', price_cents: 300 },
      ] as never),
    ).toEqual({
      subtotalCents: 800,
      shippingCostCents: 0,
      serviceFeeCents: 399,
      totalCents: 1199,
      itemCount: 2,
    });
  });

  it('sums odd cents without float drift', () => {
    expect(
      calculateOrderCalculations([
        { id: 'p1', price_cents: 1_999 },
        { id: 'p2', price_cents: 1 },
        { id: 'p3', price_cents: 123_456 },
      ] as never).subtotalCents,
    ).toBe(125_456);
  });

  it('returns zeros for an empty item list', () => {
    expect(calculateOrderCalculations([])).toEqual({
      subtotalCents: 0,
      shippingCostCents: 0,
      serviceFeeCents: 0,
      totalCents: 0,
      itemCount: 0,
    });
  });
});
