import { describe, expect, it } from 'bun:test';

import {
  calculateSellerProceedsEstimate,
  normalizeInsuranceRate,
} from './sellerProceedsEstimate';

const baseSettings = {
  service_fee_pct: 0.06,
  shipping_buffer_cents: 3_000,
  insurance_rate: 0.012,
};

describe('seller proceeds estimate', () => {
  it('subtracts commission, carrier quote, shipping buffer, and insurance', () => {
    const estimate = calculateSellerProceedsEstimate({
      priceCents: 800_000,
      quoteCents: 18_600,
      settings: baseSettings,
    });

    expect(estimate).toEqual({
      commissionCents: 48_000,
      shippingCents: 21_600,
      insuranceCents: 9_600,
      finalCents: 720_800,
      normalizedInsuranceRate: 0.012,
    });
  });

  it('keeps logistics at zero until a carrier quote exists', () => {
    const estimate = calculateSellerProceedsEstimate({
      priceCents: 800_000,
      quoteCents: 0,
      settings: baseSettings,
    });

    expect(estimate.shippingCents).toBe(0);
    expect(estimate.finalCents).toBe(742_400);
  });

  it('normalizes supported insurance rate shapes defensively', () => {
    expect(normalizeInsuranceRate(0.012)).toBe(0.012);
    expect(normalizeInsuranceRate(1.2)).toBe(0.012);
    expect(normalizeInsuranceRate(120)).toBe(0.012);
    expect(normalizeInsuranceRate(null)).toBe(0);
  });
});
