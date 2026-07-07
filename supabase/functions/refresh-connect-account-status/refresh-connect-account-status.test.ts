import { describe, expect, it } from 'bun:test';

import {
  RefreshConnectAccountError,
  refreshConnectAccountStatus,
  type RefreshConnectAccountDependencies,
  type RefreshProfile,
} from './refresh-connect-account-status';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function createDependencies(overrides: {
  caller?: RefreshProfile;
  target?: RefreshProfile;
  retrieveAccount?: RefreshConnectAccountDependencies['retrieveAccount'];
  updateProfileStatus?: RefreshConnectAccountDependencies['updateProfileStatus'];
} = {}): RefreshConnectAccountDependencies & {
  calls: { retrieve: string[]; updates: Array<{ sellerId: string; status: string }> };
} {
  const caller =
    overrides.caller ??
    ({
      id: 'seller-1',
      role: 'user',
      stripe_account_id: 'acct_seller_1',
      stripe_onboarding_status: 'pending',
      stripe_onboarding_refreshed_at: null,
    } satisfies RefreshProfile);
  const target = overrides.target ?? caller;
  const calls = { retrieve: [] as string[], updates: [] as Array<{ sellerId: string; status: string }> };

  return {
    calls,
    now: () => NOW,
    getCallerProfile: async () => caller,
    getTargetProfile: async () => target,
    retrieveAccount:
      overrides.retrieveAccount ??
      (async (accountId) => {
        calls.retrieve.push(accountId);
        return {
          charges_enabled: true,
          payouts_enabled: true,
          requirements: { disabled_reason: null },
        };
      }),
    updateProfileStatus:
      overrides.updateProfileStatus ??
      (async (sellerId, update) => {
        calls.updates.push({ sellerId, status: update.status });
      }),
  };
}

describe('refreshConnectAccountStatus', () => {
  it('returns cached status without calling Stripe when throttle is active', async () => {
    const deps = createDependencies({
      caller: {
        id: 'seller-1',
        role: 'user',
        stripe_account_id: 'acct_seller_1',
        stripe_onboarding_status: 'pending',
        stripe_onboarding_refreshed_at: '2026-06-15T11:59:30.000Z',
      },
    });

    await expect(
      refreshConnectAccountStatus({ callerId: 'seller-1', force: false }, deps),
    ).resolves.toEqual({
      status: 'pending',
      hasStripeAccount: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      refreshedAt: '2026-06-15T11:59:30.000Z',
      cached: true,
    });
    expect(deps.calls.retrieve).toEqual([]);
    expect(deps.calls.updates).toEqual([]);
  });

  it('lets admins force bypass throttle for any seller', async () => {
    const deps = createDependencies({
      caller: {
        id: 'admin-1',
        role: 'admin',
        stripe_account_id: null,
        stripe_onboarding_status: null,
        stripe_onboarding_refreshed_at: null,
      },
      target: {
        id: 'seller-2',
        role: 'user',
        stripe_account_id: 'acct_seller_2',
        stripe_onboarding_status: 'pending',
        stripe_onboarding_refreshed_at: '2026-06-15T11:59:30.000Z',
      },
    });

    await expect(
      refreshConnectAccountStatus(
        { callerId: 'admin-1', sellerId: 'seller-2', force: true },
        deps,
      ),
    ).resolves.toMatchObject({
      status: 'complete',
      hasStripeAccount: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      refreshedAt: NOW.toISOString(),
      cached: false,
    });
    expect(deps.calls.retrieve).toEqual(['acct_seller_2']);
    expect(deps.calls.updates).toEqual([{ sellerId: 'seller-2', status: 'complete' }]);
  });

  it('denies cross-seller refresh and never calls Stripe', async () => {
    const deps = createDependencies({
      caller: {
        id: 'seller-1',
        role: 'user',
        stripe_account_id: 'acct_seller_1',
        stripe_onboarding_status: 'pending',
        stripe_onboarding_refreshed_at: null,
      },
      target: {
        id: 'seller-2',
        role: 'user',
        stripe_account_id: 'acct_seller_2',
        stripe_onboarding_status: 'pending',
        stripe_onboarding_refreshed_at: null,
      },
    });

    await expect(
      refreshConnectAccountStatus({ callerId: 'seller-1', sellerId: 'seller-2' }, deps),
    ).rejects.toEqual(new RefreshConnectAccountError('FORBIDDEN', 403));
    expect(deps.calls.retrieve).toEqual([]);
  });

  it('persists rejected status when Stripe returns a hard disabled reason', async () => {
    const deps = createDependencies({
      retrieveAccount: async (accountId) => {
        deps.calls.retrieve.push(accountId);
        return {
          charges_enabled: false,
          payouts_enabled: false,
          requirements: { disabled_reason: 'rejected.fraud' },
        };
      },
    });

    await expect(
      refreshConnectAccountStatus({ callerId: 'seller-1' }, deps),
    ).resolves.toMatchObject({
      status: 'rejected',
      hasStripeAccount: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      cached: false,
    });
    expect(deps.calls.updates).toEqual([{ sellerId: 'seller-1', status: 'rejected' }]);
  });

  it('returns cached status with an error flag when Stripe retrieval fails', async () => {
    const deps = createDependencies({
      retrieveAccount: async () => {
        throw new Error('Stripe unavailable');
      },
    });

    await expect(
      refreshConnectAccountStatus({ callerId: 'seller-1' }, deps),
    ).resolves.toEqual({
      status: 'pending',
      hasStripeAccount: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      refreshedAt: NOW.toISOString(),
      cached: true,
      error: 'STRIPE_REFRESH_FAILED',
    });
    expect(deps.calls.updates).toEqual([]);
  });

  it('trusts cached complete DB status when Stripe retrieval fails', async () => {
    const deps = createDependencies({
      caller: {
        id: 'seller-1',
        role: 'user',
        stripe_account_id: 'acct_seller_1',
        stripe_onboarding_status: 'complete',
        stripe_onboarding_refreshed_at: null,
      },
      retrieveAccount: async () => {
        throw new Error('Stripe unavailable');
      },
    });

    await expect(
      refreshConnectAccountStatus({ callerId: 'seller-1' }, deps),
    ).resolves.toEqual({
      status: 'complete',
      hasStripeAccount: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      refreshedAt: NOW.toISOString(),
      cached: true,
    });
    expect(deps.calls.updates).toEqual([]);
  });

  it('surfaces DB update failures instead of masking them as Stripe failures', async () => {
    const deps = createDependencies({
      updateProfileStatus: async () => {
        throw new RefreshConnectAccountError('PROFILE_UPDATE_FAILED', 500);
      },
    });

    await expect(
      refreshConnectAccountStatus({ callerId: 'seller-1' }, deps),
    ).rejects.toEqual(new RefreshConnectAccountError('PROFILE_UPDATE_FAILED', 500));
    expect(deps.calls.retrieve).toEqual(['acct_seller_1']);
  });
});
