import { describe, expect, it } from 'bun:test';

import { googlePayTestEnv } from './stripeMode';

describe('googlePayTestEnv', () => {
  it('runs Google Pay in production with a live publishable key', () => {
    expect(googlePayTestEnv('pk_live_abc123')).toBe(false);
  });

  it('runs Google Pay in test mode with a test publishable key', () => {
    expect(googlePayTestEnv('pk_test_abc123')).toBe(true);
  });

  it('stays in test mode when the key is missing or not a live key', () => {
    expect(googlePayTestEnv(undefined)).toBe(true);
    expect(googlePayTestEnv('')).toBe(true);
    expect(googlePayTestEnv('sk_live_abc123')).toBe(true);
  });
});
