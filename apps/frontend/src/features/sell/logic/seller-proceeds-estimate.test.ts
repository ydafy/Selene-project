import { describe, expect, it } from 'bun:test';

import {
  buildSellerEarnings,
  calculateSellerProceedsEstimate,
} from './seller-proceeds-estimate';

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
    });
  });

  it('keeps logistics at zero until a carrier quote exists', () => {
    const estimate = calculateSellerProceedsEstimate({
      priceCents: 800_000,
      quoteCents: 0,
      settings: baseSettings,
    });

    expect(estimate?.shippingCents).toBe(0);
    expect(estimate?.finalCents).toBe(742_400);
  });

  it('rounds insurance up, as the server reserve does', () => {
    // 10_001 * 0.012 = 120.012: the server reserves ceil = 121, not 120.
    expect(
      calculateSellerProceedsEstimate({
        priceCents: 10_001,
        quoteCents: 0,
        settings: baseSettings,
      }),
    ).toEqual({
      commissionCents: 600,
      shippingCents: 0,
      insuranceCents: 121,
      finalCents: 9_280,
    });
  });

  it('accepts the 0 and 1 rate boundaries and a zero buffer', () => {
    expect(
      calculateSellerProceedsEstimate({
        priceCents: 100_000,
        quoteCents: 10_000,
        settings: {
          service_fee_pct: 0,
          shipping_buffer_cents: 0,
          insurance_rate: 1,
        },
      }),
    ).toEqual({
      commissionCents: 0,
      shippingCents: 10_000,
      insuranceCents: 100_000,
      finalCents: 0,
    });
  });

  it('returns no estimate without settings', () => {
    for (const settings of [null, undefined]) {
      expect(
        calculateSellerProceedsEstimate({
          priceCents: 800_000,
          quoteCents: 18_600,
          settings,
        }),
      ).toBeNull();
    }
  });

  it.each([
    ['service_fee_pct', null],
    ['service_fee_pct', undefined],
    ['service_fee_pct', 6],
    ['service_fee_pct', -0.01],
    ['service_fee_pct', Number.NaN],
    ['insurance_rate', null],
    ['insurance_rate', 1.2],
    ['insurance_rate', 120],
    ['shipping_buffer_cents', null],
    ['shipping_buffer_cents', -1],
    ['shipping_buffer_cents', 30.5],
  ])('returns no estimate when %s is %p', (key, value) => {
    expect(
      calculateSellerProceedsEstimate({
        priceCents: 800_000,
        quoteCents: 18_600,
        settings: { ...baseSettings, [key]: value },
      }),
    ).toBeNull();
  });
});

describe('seller earnings shown in the sell form', () => {
  it('formats the estimate and the commission percent', () => {
    expect(
      buildSellerEarnings({
        priceCents: 800_000,
        quoteCents: 18_600,
        settings: baseSettings,
      }),
    ).toEqual({
      commission: '480.00',
      shipping: '216.00',
      final: '7208.00',
      commissionPct: 6,
    });
  });

  it('shows no amount when the settings are missing or invalid', () => {
    for (const settings of [
      undefined,
      { ...baseSettings, shipping_buffer_cents: null },
      { ...baseSettings, insurance_rate: 1.2 },
    ]) {
      expect(
        buildSellerEarnings({
          priceCents: 800_000,
          quoteCents: 18_600,
          settings,
        }),
      ).toMatchObject({ commission: null, shipping: null, final: null });
    }
  });

  it('shows no amount before there is a price', () => {
    expect(
      buildSellerEarnings({
        priceCents: 0,
        quoteCents: 0,
        settings: baseSettings,
      }),
    ).toEqual({
      commission: null,
      shipping: null,
      final: null,
      commissionPct: 6,
    });
  });
});
