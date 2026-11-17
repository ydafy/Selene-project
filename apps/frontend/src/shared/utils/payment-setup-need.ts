import type { StripeOnboardingStatus } from '@selene/types';

/** What a seller still has to do before buyers can pay them. */
export type PaymentSetupNeed = 'setup' | 'rejected' | null;

/**
 * A loading, failed or not-yet-requested status needs nothing, so every screen behaves as before
 * and the seller is never blocked on an unknown state.
 */
export const resolvePaymentSetupNeed = ({
  hasUser,
  status,
  isLoading,
  isError,
}: {
  hasUser: boolean;
  status: StripeOnboardingStatus | null;
  isLoading: boolean;
  isError: boolean;
}): PaymentSetupNeed => {
  if (!hasUser || isLoading || isError || status === 'complete') return null;
  return status === 'rejected' ? 'rejected' : 'setup';
};
