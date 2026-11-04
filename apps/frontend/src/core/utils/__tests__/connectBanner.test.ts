import { describe, expect, it } from 'bun:test';

import { resolveConnectBanner } from '../connectBanner';

const base = {
  listingsCount: 1,
  status: null,
  isLoading: false,
  isError: false,
} as const;

describe('resolveConnectBanner', () => {
  it('hides the banner when the seller has no listings', () => {
    expect(resolveConnectBanner({ ...base, listingsCount: 0 })).toBeNull();
  });

  it('hides the banner when onboarding is complete', () => {
    expect(resolveConnectBanner({ ...base, status: 'complete' })).toBeNull();
  });

  it('hides the banner while the status is loading', () => {
    expect(resolveConnectBanner({ ...base, isLoading: true })).toBeNull();
  });

  it('hides the banner when the status query failed', () => {
    expect(resolveConnectBanner({ ...base, isError: true })).toBeNull();
  });

  it('shows the setup variant when there is no payment account', () => {
    expect(resolveConnectBanner(base)).toBe('setup');
  });

  it('shows the setup variant while onboarding is pending', () => {
    expect(resolveConnectBanner({ ...base, status: 'pending' })).toBe('setup');
  });

  it('shows the rejected variant when the account was rejected', () => {
    expect(resolveConnectBanner({ ...base, status: 'rejected' })).toBe(
      'rejected',
    );
  });
});
