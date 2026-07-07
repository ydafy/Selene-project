import { describe, expect, it } from 'bun:test';

import { summarizeConnectEarnings } from './connectEarnings';

describe('connect earnings helpers', () => {
  it('summarizes Connect application fees and gross processed amounts', () => {
    expect(
      summarizeConnectEarnings([
        { amount: 53_000, application_fee_amount: 5_300, status: 'succeeded' },
        { amount: 32_100, application_fee_amount: 3_210, status: 'succeeded' },
        { amount: 10_000, application_fee_amount: 1_000, status: 'refunded' },
      ]),
    ).toEqual({
      succeededCount: 2,
      refundedCount: 1,
      grossCents: 85_100,
      applicationFeesCents: 8_510,
    });
  });

  it('treats nullable cent values as zero for generated view rows', () => {
    expect(
      summarizeConnectEarnings([
        { amount: null, application_fee_amount: null, status: 'succeeded' },
      ]),
    ).toEqual({
      succeededCount: 1,
      refundedCount: 0,
      grossCents: 0,
      applicationFeesCents: 0,
    });
  });
});
