import { describe, expect, it } from 'bun:test';

import { resolveConnectOnboardingRedirect } from './connect-onboarding-return';

describe('resolveConnectOnboardingRedirect', () => {
  it('redirects return state to the default app deep link', () => {
    expect(
      resolveConnectOnboardingRedirect({
        requestUrl:
          'https://example.functions.supabase.co/connect-onboarding-return?state=return',
        env: {},
      }),
    ).toEqual({
      ok: true,
      state: 'return',
      url: 'selene://sell/onboarding?return=1',
    });
  });

  it('redirects refresh state to the default app deep link', () => {
    expect(
      resolveConnectOnboardingRedirect({
        requestUrl:
          'https://example.functions.supabase.co/connect-onboarding-return?state=refresh',
        env: {},
      }),
    ).toEqual({
      ok: true,
      state: 'refresh',
      url: 'selene://sell/onboarding?refresh=1',
    });
  });

  it('accepts type as a compatibility alias for state', () => {
    expect(
      resolveConnectOnboardingRedirect({
        requestUrl:
          'https://example.functions.supabase.co/connect-onboarding-return?type=refresh',
        env: {},
      }),
    ).toEqual({
      ok: true,
      state: 'refresh',
      url: 'selene://sell/onboarding?refresh=1',
    });
  });

  it('supports one-line production app URL swaps through env', () => {
    expect(
      resolveConnectOnboardingRedirect({
        requestUrl:
          'https://example.functions.supabase.co/connect-onboarding-return?state=return',
        env: {
          SELENE_CONNECT_ONBOARDING_APP_URL:
            'https://app.selene.test/sell/onboarding',
        },
      }),
    ).toEqual({
      ok: true,
      state: 'return',
      url: 'https://app.selene.test/sell/onboarding?return=1',
    });
  });

  it('rejects invalid states instead of accepting user-controlled redirects', () => {
    expect(
      resolveConnectOnboardingRedirect({
        requestUrl:
          'https://example.functions.supabase.co/connect-onboarding-return?state=https://evil.test',
        env: {},
      }),
    ).toEqual({
      ok: false,
      status: 400,
      error: 'INVALID_ONBOARDING_RETURN_STATE',
    });
  });
});
