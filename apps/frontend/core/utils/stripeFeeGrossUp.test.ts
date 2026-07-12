import { describe, expect, it } from 'bun:test';

import { grossUpDomesticMx } from './stripeFeeGrossUp';

describe('grossUpDomesticMx', () => {
  it.each([
    [500_000, { buyerTotalCents: 522_154, seguroCents: 22_154 }],
    [0, { buyerTotalCents: 364, seguroCents: 364 }],
    [1, { buyerTotalCents: 365, seguroCents: 364 }],
    [100, { buyerTotalCents: 468, seguroCents: 368 }],
  ])('grosses up %i cents exactly', (subtotalCents, expected) => {
    expect(grossUpDomesticMx(subtotalCents)).toEqual(expected);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid subtotal %p',
    (subtotalCents) => {
      expect(() => grossUpDomesticMx(subtotalCents)).toThrow(
        'INVALID_STRIPE_FEE_GROSS_UP_INPUT:subtotalCents',
      );
    },
  );

  it('rejects results outside the safe integer range', () => {
    expect(() => grossUpDomesticMx(Number.MAX_SAFE_INTEGER)).toThrow(
      'INVALID_STRIPE_FEE_GROSS_UP_INPUT:buyerTotalOverflow',
    );
  });
});
