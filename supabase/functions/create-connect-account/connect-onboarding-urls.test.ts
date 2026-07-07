import { describe, expect, it } from 'bun:test';

import { resolveConnectOnboardingUrls } from './connect-onboarding-urls';

describe('resolveConnectOnboardingUrls', () => {
  it('ignores arbitrary client-provided HTTPS URLs and uses configured fallbacks', () => {
    expect(
      resolveConnectOnboardingUrls(
        {
          returnUrl: 'https://attacker.example.test/return',
          refreshUrl: 'https://attacker.example.test/refresh',
        },
        {
          SUPABASE_URL: 'https://project-ref.supabase.co',
          SELENE_CONNECT_ONBOARDING_RETURN_URL:
            'https://app.selene.test/sell/onboarding?return=1',
          SELENE_CONNECT_ONBOARDING_REFRESH_URL:
            'https://app.selene.test/sell/onboarding?refresh=1',
        },
      ),
    ).toEqual({
      returnUrl: 'https://app.selene.test/sell/onboarding?return=1',
      refreshUrl: 'https://app.selene.test/sell/onboarding?refresh=1',
    });
  });

  it('converts client-provided mobile deep links to HTTPS bridge URLs', () => {
    expect(
      resolveConnectOnboardingUrls(
        {
          returnUrl: 'selene://sell/onboarding?return=1',
          refreshUrl: 'selene://sell/onboarding?refresh=1',
        },
        { SUPABASE_URL: 'https://project-ref.supabase.co' },
      ),
    ).toEqual({
      returnUrl:
        'https://project-ref.supabase.co/functions/v1/connect-onboarding-return?state=return',
      refreshUrl:
        'https://project-ref.supabase.co/functions/v1/connect-onboarding-return?state=refresh',
    });
  });

  it('uses an explicit HTTPS bridge URL for local Stripe testing tunnels', () => {
    expect(
      resolveConnectOnboardingUrls(
        {},
        {
          SUPABASE_URL: 'http://127.0.0.1:54321',
          SELENE_CONNECT_ONBOARDING_BRIDGE_URL:
            'https://bridge.example.test/connect-onboarding-return',
        },
      ),
    ).toEqual({
      returnUrl:
        'https://bridge.example.test/connect-onboarding-return?state=return',
      refreshUrl:
        'https://bridge.example.test/connect-onboarding-return?state=refresh',
    });
  });

  it('allows explicit production HTTPS return and refresh URL overrides', () => {
    expect(
      resolveConnectOnboardingUrls(
        {},
        {
          SUPABASE_URL: 'https://project-ref.supabase.co',
          SELENE_CONNECT_ONBOARDING_RETURN_URL:
            'https://app.selene.test/sell/onboarding?return=1',
          SELENE_CONNECT_ONBOARDING_REFRESH_URL:
            'https://app.selene.test/sell/onboarding?refresh=1',
        },
      ),
    ).toEqual({
      returnUrl: 'https://app.selene.test/sell/onboarding?return=1',
      refreshUrl: 'https://app.selene.test/sell/onboarding?refresh=1',
    });
  });

  it('fails safely instead of passing raw deep links or HTTP URLs to Stripe', () => {
    expect(() =>
      resolveConnectOnboardingUrls(
        {
          returnUrl: 'selene://sell/onboarding?return=1',
          refreshUrl: 'http://localhost:8081/sell/onboarding?refresh=1',
        },
        { SUPABASE_URL: 'http://127.0.0.1:54321' },
      ),
    ).toThrow('CONNECT_ONBOARDING_BRIDGE_URL_REQUIRED');
  });

  it('keeps all Stripe-facing fallbacks HTTPS', () => {
    const urls = resolveConnectOnboardingUrls(
      {},
      { SUPABASE_URL: 'https://project-ref.supabase.co' },
    );

    expect(new URL(urls.returnUrl).protocol).toBe('https:');
    expect(new URL(urls.refreshUrl).protocol).toBe('https:');
  });
});
