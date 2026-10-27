import { describe, expect, it } from 'bun:test';

import { resolveCancellationSettings } from './cancellation-settings';

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

  it('invents no deadline while system settings are missing or loading', () => {
    const missing = { orderExpirationHours: null, preparingExpirationHours: null };

    expect(resolveCancellationSettings(null)).toEqual(missing);
    expect(resolveCancellationSettings(undefined)).toEqual(missing);
    expect(
      resolveCancellationSettings({
        order_expiration_hours: null,
        preparing_expiration_hours: null,
      }),
    ).toEqual(missing);
  });

  it('keeps a configured value when only the other one is missing', () => {
    expect(
      resolveCancellationSettings({
        order_expiration_hours: 36,
        preparing_expiration_hours: null,
      }),
    ).toEqual({ orderExpirationHours: 36, preparingExpirationHours: null });
  });
});
