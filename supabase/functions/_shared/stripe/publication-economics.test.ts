import { describe, expect, it } from 'bun:test';

import { validatePublicationEconomicsSnapshot } from './publication-economics.ts';

describe('publication economics', () => {
  it('accepts only all-present valid snapshots', () => {
    expect(
      validatePublicationEconomicsSnapshot({
        publication_shipping_reserve_cents: 18_200,
        publication_commission_rate: 0.08,
        publication_insurance_rate: 0.012,
      }),
    ).toEqual({
      shippingReserveCents: 18_200,
      commissionRate: 0.08,
      insuranceRate: 0.012,
    });
    expect(() =>
      validatePublicationEconomicsSnapshot({
        publication_shipping_reserve_cents: 18_200,
        publication_commission_rate: null,
        publication_insurance_rate: 0.012,
      }),
    ).toThrow('INVALID_PUBLICATION_ECONOMICS_SNAPSHOT');
  });

  it('rejects an all-null snapshot instead of resolving current settings', () => {
    expect(() =>
      validatePublicationEconomicsSnapshot({
        publication_shipping_reserve_cents: null,
        publication_commission_rate: null,
        publication_insurance_rate: null,
      }),
    ).toThrow(new Error('INVALID_PUBLICATION_ECONOMICS_SNAPSHOT'));
  });

  it('rejects percent or basis-point rates: rates are fractions in 0..1', () => {
    for (const [commission, insurance] of [
      [6, 0.012],
      [0.06, 1.2],
      [0.06, 120],
      [-0.01, 0.012],
    ]) {
      expect(() =>
        validatePublicationEconomicsSnapshot({
          publication_shipping_reserve_cents: 18_200,
          publication_commission_rate: commission,
          publication_insurance_rate: insurance,
        }),
      ).toThrow(new Error('INVALID_PUBLICATION_ECONOMICS_SNAPSHOT'));
    }
  });
});
