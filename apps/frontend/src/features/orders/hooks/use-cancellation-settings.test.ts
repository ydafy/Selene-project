import { describe, expect, it } from 'bun:test';

import { resolveCancellationSettings } from '../logic/cancellation-settings';

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

  // Both hours are NOT NULL in the database (#308); only the row can be
  // missing while the query loads or fails.
  it('invents no deadline while system settings are missing or loading', () => {
    const missing = {
      orderExpirationHours: null,
      preparingExpirationHours: null,
    };

    expect(resolveCancellationSettings(null)).toEqual(missing);
    expect(resolveCancellationSettings(undefined)).toEqual(missing);
  });
});
