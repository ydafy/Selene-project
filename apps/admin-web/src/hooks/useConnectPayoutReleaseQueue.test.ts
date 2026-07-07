import { describe, expect, it } from 'bun:test';

import { formatConnectPayoutReleaseError } from '../lib/connectPayoutReleaseErrors';
import type { ReleaseConnectPayoutResponse } from '@selene/types';

describe('formatConnectPayoutReleaseError', () => {
  it('returns retryable funds-pending guidance for Stripe balance insufficiency', () => {
    const response = {
      success: false,
      error: 'Raw Stripe balance text should not be shown',
      code: 'stripe_balance_insufficient',
      retryable: true,
      required_amount_cents: 10_000,
      available_amount_cents: 7_500,
      currency: 'mxn',
    } satisfies ReleaseConnectPayoutResponse;

    expect(formatConnectPayoutReleaseError(response)).toBe(
      'Funds pending/not yet available in Stripe. Retry when available. Required: MXN 100.00. Available: MXN 75.00.',
    );
  });

  it('falls back to the backend error for non-balance release failures', () => {
    expect(
      formatConnectPayoutReleaseError({
        success: false,
        error: 'SHIPMENT_NOT_COMPLETED',
      }),
    ).toBe('SHIPMENT_NOT_COMPLETED');
  });
});
