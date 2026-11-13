import { describe, expect, it } from 'bun:test';

import { extractStripeChargeId } from './stripe-charge.ts';

describe('extractStripeChargeId', () => {
  it('uses a non-empty latest_charge string', () => {
    expect(extractStripeChargeId({ latest_charge: 'ch_latest' })).toBe(
      'ch_latest',
    );
  });

  it('uses an expanded latest charge before the legacy charge list', () => {
    expect(
      extractStripeChargeId({
        latest_charge: { id: 'ch_expanded' },
        charges: { data: [{ id: 'ch_fallback' }] },
      }),
    ).toBe('ch_expanded');
  });

  it('falls back to the first legacy charge when latest_charge is absent', () => {
    expect(
      extractStripeChargeId({ charges: { data: [{ id: 'ch_fallback' }] } }),
    ).toBe('ch_fallback');
  });

  it('returns null when Stripe did not provide usable charge evidence', () => {
    expect(
      extractStripeChargeId({
        latest_charge: '',
        charges: { data: [{ id: '' }] },
      }),
    ).toBeNull();
  });
});
