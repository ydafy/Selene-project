import type { StripeOnboardingStatus } from '@selene/types';

export type ConnectBannerVariant = 'setup' | 'rejected';

/**
 * Decides whether the profile shows the "buyers cannot pay you" banner.
 * Hidden without listings, once Connect is complete, and while the status is
 * loading or failed, so the banner never flashes or shows on unknown state.
 */
export const resolveConnectBanner = ({
  listingsCount,
  status,
  isLoading,
  isError,
}: {
  listingsCount: number;
  status: StripeOnboardingStatus | null;
  isLoading: boolean;
  isError: boolean;
}): ConnectBannerVariant | null => {
  if (listingsCount < 1 || isLoading || isError) return null;
  if (status === 'complete') return null;
  return status === 'rejected' ? 'rejected' : 'setup';
};
