import { describe, expect, it } from 'bun:test';

import {
  createDrainIdempotencyKey,
  selectDrainCandidates,
  summarizeDrainResults,
} from './drain-legacy-wallets';

describe('legacy wallet drain helpers', () => {
  it('selects only positive-balance sellers with completed Connect onboarding', () => {
    const candidates = selectDrainCandidates([
      {
        walletId: 'wallet-1',
        userId: 'seller-a',
        availableBalance: 1200,
        stripeAccountId: 'acct_a',
        onboardingStatus: 'complete',
      },
      {
        walletId: 'wallet-2',
        userId: 'seller-b',
        availableBalance: 0,
        stripeAccountId: 'acct_b',
        onboardingStatus: 'complete',
      },
      {
        walletId: 'wallet-3',
        userId: 'seller-c',
        availableBalance: 500,
        stripeAccountId: null,
        onboardingStatus: 'pending',
      },
    ]);

    expect(candidates).toEqual([
      {
        walletId: 'wallet-1',
        userId: 'seller-a',
        availableBalance: 1200,
        amountCents: 120_000,
        stripeAccountId: 'acct_a',
      },
    ]);
  });

  it('uses stable transfer idempotency keys per wallet and amount', () => {
    expect(createDrainIdempotencyKey('wallet-1', 120_000)).toBe(
      'drain_legacy_wallet_wallet-1_120000',
    );
  });

  it('summarizes successes without hiding failed preserved balances', () => {
    const summary = summarizeDrainResults([
      { status: 'transferred', amountCents: 120_000 },
      { status: 'failed', amountCents: 50_000 },
      { status: 'skipped', amountCents: 0 },
    ]);

    expect(summary).toEqual({
      transferredCount: 1,
      transferredCents: 120_000,
      failedCount: 1,
      skippedCount: 1,
    });
  });
});
