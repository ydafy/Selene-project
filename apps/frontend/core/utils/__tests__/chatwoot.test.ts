import { expect, test, describe } from 'bun:test';
import {
  resolveChatwootConfig,
  buildChatwootChatUrl,
} from '../chatwoot';

/**
 * Covers EXTD-TASK-010 + CONF-018: env-driven config + fallback URL.
 */
describe('resolveChatwootConfig', () => {
  test('returns available=false when env missing', () => {
    expect(resolveChatwootConfig({})).toEqual({ available: false });
  });

  test('returns available=false when only URL set', () => {
    expect(
      resolveChatwootConfig({
        EXPO_PUBLIC_CHATWOOT_BASE_URL: 'https://x.com',
      }),
    ).toEqual({ available: false });
  });

  test('returns available=false when only token set', () => {
    expect(
      resolveChatwootConfig({ EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN: 'tok' }),
    ).toEqual({ available: false });
  });

  test('returns config when both env vars present', () => {
    expect(
      resolveChatwootConfig({
        EXPO_PUBLIC_CHATWOOT_BASE_URL: 'https://chatwoot.tudominio.com',
        EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN: 'placeholder-token',
      }),
    ).toEqual({
      available: true,
      baseUrl: 'https://chatwoot.tudominio.com',
      websiteToken: 'placeholder-token',
    });
  });

  test('treats placeholder values as configured (not unavailable)', () => {
    // Placeholder credentials are still "config exists" — runtime decides.
    expect(
      resolveChatwootConfig({
        EXPO_PUBLIC_CHATWOOT_BASE_URL: 'https://chatwoot.tudominio.com',
        EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN: 'placeholder-token',
      }).available,
    ).toBe(true);
  });

  test('treats empty strings as missing (defensive)', () => {
    expect(
      resolveChatwootConfig({
        EXPO_PUBLIC_CHATWOOT_BASE_URL: '   ',
        EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN: '',
      }),
    ).toEqual({ available: false });
  });
});

describe('buildChatwootChatUrl', () => {
  test('returns null when not available', () => {
    expect(buildChatwootChatUrl({ available: false })).toBeNull();
  });

  test('builds widget-loader URL with token from base URL', () => {
    expect(
      buildChatwootChatUrl({
        available: true,
        baseUrl: 'https://chatwoot.tudominio.com',
        websiteToken: 'placeholder-token',
      }),
    ).toBe(
      'https://chatwoot.tudominio.com/widget?website_token=placeholder-token',
    );
  });

  test('strips trailing slash on base URL', () => {
    expect(
      buildChatwootChatUrl({
        available: true,
        baseUrl: 'https://chatwoot.tudominio.com/',
        websiteToken: 'tok',
      }),
    ).toBe('https://chatwoot.tudominio.com/widget?website_token=tok');
  });
});
