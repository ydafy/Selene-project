import { describe, expect, it } from 'bun:test';

import {
  RESEND_COOLDOWN_SECONDS,
  cooldownEndsAt,
  remainingSeconds,
  shouldStartCooldown,
} from './resendCooldown.logic';

describe('resend cooldown', () => {
  it('lasts 60 seconds', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });

  it('starts at the full duration right after the resend', () => {
    const endsAt = cooldownEndsAt(1_000_000);
    expect(remainingSeconds(endsAt, 1_000_000)).toBe(60);
  });

  it('ticks down with the injected clock, rounding partial seconds up', () => {
    const endsAt = cooldownEndsAt(0);
    expect(remainingSeconds(endsAt, 1_000)).toBe(59);
    expect(remainingSeconds(endsAt, 59_001)).toBe(1);
    expect(remainingSeconds(endsAt, 59_999)).toBe(1);
  });

  it('expires at 60 seconds and never goes negative', () => {
    const endsAt = cooldownEndsAt(0);
    expect(remainingSeconds(endsAt, 60_000)).toBe(0);
    expect(remainingSeconds(endsAt, 120_000)).toBe(0);
  });

  it('has nothing remaining when no cooldown was started', () => {
    expect(remainingSeconds(null, 5)).toBe(0);
  });

  it('starts after a successful resend', () => {
    expect(shouldStartCooldown({ success: true, error: null })).toBe(true);
  });

  it('starts after a rate-limited resend', () => {
    expect(
      shouldStartCooldown({
        success: false,
        error: { code: 'over_email_send_rate_limit' },
      }),
    ).toBe(true);
    expect(
      shouldStartCooldown({
        success: false,
        error: { code: 'over_request_rate_limit' },
      }),
    ).toBe(true);
  });

  it('does not start after another failure', () => {
    expect(
      shouldStartCooldown({ success: false, error: { code: 'validation_failed' } }),
    ).toBe(false);
    expect(shouldStartCooldown({ success: false, error: null })).toBe(false);
  });
});
