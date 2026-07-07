export type StripeOnboardingStatus = 'pending' | 'complete' | 'rejected';

export type SellerOnboardingRow = {
  charges_enabled: boolean | null;
  created_at: string | null;
  email: string | null;
  id: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_status: StripeOnboardingStatus | null;
  username: string | null;
};

export type SellerOnboardingProfile = {
  role: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_status: StripeOnboardingStatus | null;
};

export type SellerOnboardingSelf = {
  has_stripe_account: boolean;
  stripe_onboarding_status: StripeOnboardingStatus | null;
};

export type SellerOnboardingResponse =
  | { success: true; rows: SellerOnboardingRow[] }
  | ({ success: true } & SellerOnboardingSelf)
  | { success: false; error: string };

export class GetSellerOnboardingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'GetSellerOnboardingError';
  }
}

export const getSellerOnboardingErrorStatus = (message: string) => {
  if (message === 'AUTH_REQUIRED') return 401;
  if (message === 'PROFILE_NOT_FOUND') return 404;
  if (
    message === 'PROFILE_LOOKUP_FAILED' ||
    message === 'SELLER_ONBOARDING_UNAVAILABLE' ||
    message === 'MISSING_SERVER_CONFIG'
  ) {
    return 500;
  }

  return 400;
};

export const resolveSellerOnboardingResponse = async ({
  profile,
  profileError,
  loadAdminRows,
}: {
  profile: SellerOnboardingProfile | null;
  profileError?: unknown;
  loadAdminRows: () => Promise<{
    data: SellerOnboardingRow[] | null;
    error: unknown;
  }>;
}): Promise<SellerOnboardingResponse> => {
  if (profileError) {
    throw new GetSellerOnboardingError('PROFILE_LOOKUP_FAILED', 500);
  }

  if (!profile) {
    throw new GetSellerOnboardingError('PROFILE_NOT_FOUND', 404);
  }

  if (profile.role !== 'admin') {
    return {
      success: true,
      has_stripe_account: !!profile.stripe_account_id,
      stripe_onboarding_status: profile.stripe_onboarding_status ?? null,
    };
  }

  const { data, error } = await loadAdminRows();
  if (error) {
    throw new GetSellerOnboardingError(
      'SELLER_ONBOARDING_UNAVAILABLE',
      getSellerOnboardingErrorStatus('SELLER_ONBOARDING_UNAVAILABLE'),
    );
  }

  return { success: true, rows: data ?? [] };
};
