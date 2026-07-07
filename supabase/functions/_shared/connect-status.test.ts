import { describe, expect, it } from 'bun:test';

import { normalizeAccountStatus } from './connect-status';

describe('normalizeAccountStatus', () => {
  it('marks v1 accounts complete only when charges and payouts are enabled', () => {
    expect(
      normalizeAccountStatus({
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { disabled_reason: null },
      }),
    ).toEqual({
      status: 'complete',
      chargesEnabled: true,
      payoutsEnabled: true,
    });

    expect(
      normalizeAccountStatus({
        charges_enabled: true,
        payouts_enabled: false,
        requirements: { disabled_reason: null },
      }),
    ).toEqual({
      status: 'pending',
      chargesEnabled: true,
      payoutsEnabled: false,
    });
  });

  it('normalizes camelCase account payloads defensively', () => {
    expect(
      normalizeAccountStatus({
        chargesEnabled: true,
        payoutsEnabled: true,
        requirements: { disabledReason: null },
      }),
    ).toEqual({
      status: 'complete',
      chargesEnabled: true,
      payoutsEnabled: true,
    });

    expect(
      normalizeAccountStatus({
        chargesEnabled: false,
        payoutsEnabled: true,
      }),
    ).toEqual({
      status: 'pending',
      chargesEnabled: false,
      payoutsEnabled: true,
    });
  });

  it('rejects hard disabled accounts but keeps requirements.past_due pending', () => {
    expect(
      normalizeAccountStatus({
        charges_enabled: false,
        payouts_enabled: false,
        requirements: { disabled_reason: 'rejected.fraud' },
      }),
    ).toEqual({
      status: 'rejected',
      chargesEnabled: false,
      payoutsEnabled: false,
    });

    expect(
      normalizeAccountStatus({
        charges_enabled: false,
        payouts_enabled: false,
        requirements: { disabled_reason: 'requirements.past_due' },
      }),
    ).toEqual({
      status: 'pending',
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  });

  it('treats missing fields as pending and disabled', () => {
    expect(normalizeAccountStatus({})).toEqual({
      status: 'pending',
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  });
});
