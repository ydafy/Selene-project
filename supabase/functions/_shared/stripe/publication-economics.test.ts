import { describe, expect, it } from 'bun:test';

import {
  calculateEstimatedSellerShippingDeductionCents,
  resolvePublicationEconomics,
  validatePublicationEconomicsSnapshot,
} from './publication-economics.ts';

describe('publication economics', () => {
  it('calculates the reserve as quote plus buffer plus ceiling insurance', () => {
    expect(
      calculateEstimatedSellerShippingDeductionCents({
        priceCents: 100_001,
        quotedShippingCents: 15_000,
        shippingBufferCents: 2_000,
        insuranceRate: 0.012,
      }),
    ).toBe(18_201);
  });

  it('rejects non-integer money and invalid normalized rates', () => {
    expect(() =>
      calculateEstimatedSellerShippingDeductionCents({
        priceCents: 100.5,
        quotedShippingCents: 15_000,
        shippingBufferCents: 2_000,
        insuranceRate: 0.012,
      }),
    ).toThrow('INVALID_PUBLICATION_ECONOMICS');
    expect(() =>
      calculateEstimatedSellerShippingDeductionCents({
        priceCents: 100_000,
        quotedShippingCents: 15_000,
        shippingBufferCents: 2_000,
        insuranceRate: 1.2,
      }),
    ).toThrow('INVALID_PUBLICATION_ECONOMICS');
  });

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

  it('uses a legacy resolver only when every snapshot field is absent', () => {
    const legacy = {
      shippingReserveCents: 20_000,
      commissionRate: 0.06,
      insuranceRate: 0.012,
    };

    expect(
      resolvePublicationEconomics(
        {
          publication_shipping_reserve_cents: 18_200,
          publication_commission_rate: 0.08,
          publication_insurance_rate: 0.012,
        },
        () => legacy,
      ),
    ).toEqual({
      shippingReserveCents: 18_200,
      commissionRate: 0.08,
      insuranceRate: 0.012,
    });
    expect(
      resolvePublicationEconomics(
        {
          publication_shipping_reserve_cents: null,
          publication_commission_rate: null,
          publication_insurance_rate: null,
        },
        () => legacy,
      ),
    ).toEqual(legacy);
  });
});
