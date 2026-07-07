import { describe, expect, it } from 'bun:test';

import {
  buildConnectOnboardingDeepLinks,
  isConnectOnboardingUrl,
  shouldAttemptConnectStatusRefresh,
} from './connectOnboardingUrls';

describe('buildConnectOnboardingDeepLinks', () => {
  it('delegates to Expo Linking-compatible URL creation for return and refresh', () => {
    const calls: Array<{ path: string; queryParams: Record<string, string> }> = [];

    const links = buildConnectOnboardingDeepLinks((path, options) => {
      calls.push({ path, queryParams: options.queryParams });
      return `selene://${path.replace(/^\//, '')}?${new URLSearchParams(
        options.queryParams,
      ).toString()}`;
    });

    expect(links).toEqual({
      returnUrl: 'selene://sell/onboarding?return=1',
      refreshUrl: 'selene://sell/onboarding?refresh=1',
    });
    expect(calls).toEqual([
      { path: '/sell/onboarding', queryParams: { return: '1' } },
      { path: '/sell/onboarding', queryParams: { refresh: '1' } },
    ]);
  });
});

describe('isConnectOnboardingUrl', () => {
  it('matches native and web onboarding return URLs', () => {
    expect(isConnectOnboardingUrl('selene://sell/onboarding?return=1')).toBe(true);
    expect(isConnectOnboardingUrl('https://app.example.test/sell/onboarding?return=1')).toBe(
      true,
    );
  });

  it('rejects unrelated app links', () => {
    expect(isConnectOnboardingUrl('selene://auth-verified?token=abc')).toBe(false);
    expect(isConnectOnboardingUrl('https://app.example.test/profile')).toBe(false);
  });
});

describe('shouldAttemptConnectStatusRefresh', () => {
  it('requires a cached account for routine refreshes', () => {
    expect(shouldAttemptConnectStatusRefresh({ hasUser: true, hasCachedAccount: true })).toBe(
      true,
    );
    expect(shouldAttemptConnectStatusRefresh({ hasUser: true, hasCachedAccount: false })).toBe(
      false,
    );
  });

  it('allows Stripe return refreshes before the local account query catches up', () => {
    expect(
      shouldAttemptConnectStatusRefresh({
        hasUser: true,
        hasCachedAccount: false,
        skipCachedAccountCheck: true,
      }),
    ).toBe(true);
    expect(
      shouldAttemptConnectStatusRefresh({
        hasUser: false,
        hasCachedAccount: true,
        skipCachedAccountCheck: true,
      }),
    ).toBe(false);
  });
});
