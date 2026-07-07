import { describe, expect, it } from 'bun:test';

import {
  GetSellerOnboardingError,
  resolveSellerOnboardingResponse,
  type SellerOnboardingRow,
} from './get-seller-onboarding';

const sellerRow: SellerOnboardingRow = {
  charges_enabled: true,
  created_at: '2026-06-20T00:00:00.000Z',
  email: 'seller@example.test',
  id: 'seller-1',
  stripe_account_id: 'acct_seller',
  stripe_onboarding_status: 'complete',
  username: 'seller',
};

describe('resolveSellerOnboardingResponse', () => {
  it('returns only self fields for non-admin profiles', async () => {
    let loadedAdminRows = false;

    const response = await resolveSellerOnboardingResponse({
      profile: {
        role: 'user',
        stripe_account_id: 'acct_self',
        stripe_onboarding_status: 'pending',
      },
      loadAdminRows: async () => {
        loadedAdminRows = true;
        return { data: [sellerRow], error: null };
      },
    });

    expect(response).toEqual({
      success: true,
      has_stripe_account: true,
      stripe_onboarding_status: 'pending',
    });
    expect('rows' in response).toBe(false);
    expect('stripe_account_id' in response).toBe(false);
    expect(loadedAdminRows).toBe(false);
  });

  it('returns admin rows for admin profiles', async () => {
    await expect(
      resolveSellerOnboardingResponse({
        profile: {
          role: 'admin',
          stripe_account_id: null,
          stripe_onboarding_status: null,
        },
        loadAdminRows: async () => ({ data: [sellerRow], error: null }),
      }),
    ).resolves.toEqual({ success: true, rows: [sellerRow] });
  });

  it('treats missing profiles as an error', async () => {
    await expect(
      resolveSellerOnboardingResponse({
        profile: null,
        loadAdminRows: async () => ({ data: [], error: null }),
      }),
    ).rejects.toMatchObject(
      new GetSellerOnboardingError('PROFILE_NOT_FOUND', 404),
    );
  });

  it('treats profile query failures as an error', async () => {
    await expect(
      resolveSellerOnboardingResponse({
        profile: null,
        profileError: new Error('connection lost'),
        loadAdminRows: async () => ({ data: [], error: null }),
      }),
    ).rejects.toMatchObject(
      new GetSellerOnboardingError('PROFILE_LOOKUP_FAILED', 500),
    );
  });

  it('maps admin rows query failures to a stable error code', async () => {
    await expect(
      resolveSellerOnboardingResponse({
        profile: {
          role: 'admin',
          stripe_account_id: null,
          stripe_onboarding_status: null,
        },
        loadAdminRows: async () => ({ data: null, error: new Error('view failed') }),
      }),
    ).rejects.toMatchObject(
      new GetSellerOnboardingError('SELLER_ONBOARDING_UNAVAILABLE', 500),
    );
  });
});
