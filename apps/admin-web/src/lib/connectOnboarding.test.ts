import { describe, expect, it } from 'bun:test';

import {
  normalizeSellerOnboardingRow,
  summarizeSellerOnboarding,
} from './connectOnboarding';

describe('connect onboarding admin helpers', () => {
  it('summarizes onboarding rows by status', () => {
    expect(
      summarizeSellerOnboarding([
        { stripe_onboarding_status: 'complete' },
        { stripe_onboarding_status: 'pending' },
        { stripe_onboarding_status: 'rejected' },
        { stripe_onboarding_status: null },
      ]),
    ).toEqual({ complete: 1, pending: 2, rejected: 1 });
  });

  it('normalizes generated view rows and skips rows without an id', () => {
    expect(
      [
        {
          id: 'seller-1',
          username: 'seller_one',
          email: 'seller@example.com',
          stripe_account_id: 'acct_123',
          stripe_onboarding_status: 'complete' as const,
          charges_enabled: true,
          created_at: '2026-06-14T00:00:00Z',
        },
        {
          id: null,
          username: 'missing_id',
          email: null,
          stripe_account_id: null,
          stripe_onboarding_status: null,
          charges_enabled: null,
          created_at: null,
        },
      ]
        .map(normalizeSellerOnboardingRow)
        .filter(Boolean),
    ).toEqual([
      {
        id: 'seller-1',
        username: 'seller_one',
        email: 'seller@example.com',
        stripe_account_id: 'acct_123',
        stripe_onboarding_status: 'complete',
        charges_enabled: true,
        created_at: '2026-06-14T00:00:00Z',
      },
    ]);
  });
});
