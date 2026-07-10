import { describe, expect, it } from 'bun:test';

import {
  CANCELLATION_SETTINGS_FALLBACKS,
  resolveCancellationSettings,
} from './cancellation-settings';

describe('resolveCancellationSettings', () => {
  it('reads live hours from system settings when present', () => {
    expect(
      resolveCancellationSettings({
        order_expiration_hours: 36,
        preparing_expiration_hours: 84,
      }),
    ).toEqual({
      orderExpirationHours: 36,
      preparingExpirationHours: 84,
    });
  });

  it('falls back to 48/72 when system settings omit values', () => {
    expect(resolveCancellationSettings(null)).toEqual(
      CANCELLATION_SETTINGS_FALLBACKS,
    );

    expect(
      resolveCancellationSettings({
        order_expiration_hours: null,
        preparing_expiration_hours: null,
      }),
    ).toEqual(CANCELLATION_SETTINGS_FALLBACKS);
  });
});
