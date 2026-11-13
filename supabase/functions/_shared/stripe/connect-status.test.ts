import { describe, expect, it } from 'bun:test';

import { normalizeAccountStatus } from './connect-status';

describe('normalizeAccountStatus', () => {
  it('marks a recipient account complete when payouts are enabled and transfers is active, without charges', () => {
    expect(
      normalizeAccountStatus({
        charges_enabled: false,
        payouts_enabled: true,
        capabilities: { transfers: 'active' },
        requirements: { disabled_reason: null },
      }),
    ).toEqual({
      status: 'complete',
      chargesEnabled: false,
      payoutsEnabled: true,
    });

    expect(
      normalizeAccountStatus({
        charges_enabled: true,
        payouts_enabled: true,
        capabilities: { card_payments: 'active', transfers: 'active' },
        requirements: { disabled_reason: null },
      }),
    ).toEqual({
      status: 'complete',
      chargesEnabled: true,
      payoutsEnabled: true,
    });
  });

  it('keeps an account pending until payouts are enabled and transfers is active', () => {
    expect(
      normalizeAccountStatus({
        charges_enabled: true,
        payouts_enabled: false,
        capabilities: { transfers: 'active' },
        requirements: { disabled_reason: null },
      }),
    ).toEqual({
      status: 'pending',
      chargesEnabled: true,
      payoutsEnabled: false,
    });

    for (const transfers of ['pending', 'inactive', undefined, null]) {
      expect(
        normalizeAccountStatus({
          charges_enabled: true,
          payouts_enabled: true,
          capabilities: { transfers },
          requirements: { disabled_reason: null },
        }),
      ).toEqual({
        status: 'pending',
        chargesEnabled: true,
        payoutsEnabled: true,
      });
    }

    // Charges and payouts alone, without the transfers capability, are not complete.
    expect(
      normalizeAccountStatus({
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { disabled_reason: null },
      }),
    ).toEqual({
      status: 'pending',
      chargesEnabled: true,
      payoutsEnabled: true,
    });
  });

  it('normalizes camelCase account payloads defensively', () => {
    expect(
      normalizeAccountStatus({
        chargesEnabled: false,
        payoutsEnabled: true,
        capabilities: { transfers: 'active' },
        requirements: { disabledReason: null },
      }),
    ).toEqual({
      status: 'complete',
      chargesEnabled: false,
      payoutsEnabled: true,
    });

    expect(
      normalizeAccountStatus({
        chargesEnabled: true,
        payoutsEnabled: false,
        capabilities: { transfers: 'active' },
      }),
    ).toEqual({
      status: 'pending',
      chargesEnabled: true,
      payoutsEnabled: false,
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

  it('rejects a hard disabled recipient account', () => {
    expect(
      normalizeAccountStatus({
        charges_enabled: false,
        payouts_enabled: false,
        capabilities: { transfers: 'inactive' },
        requirements: { disabled_reason: 'rejected.other' },
      }),
    ).toEqual({
      status: 'rejected',
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
