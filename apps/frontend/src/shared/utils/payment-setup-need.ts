import type { StripeOnboardingStatus } from '@selene/types';

/** What a seller still has to do before buyers can pay them. */
export type PaymentSetupNeed = 'setup' | 'rejected' | null;

/**
 * A loading or failed status needs nothing, so every screen behaves as before
 * and the seller is never blocked on an unknown state.
 */
export const resolvePaymentSetupNeed = ({
  status,
  isLoading,
  isError,
}: {
  status: StripeOnboardingStatus | null;
  isLoading: boolean;
  isError: boolean;
}): PaymentSetupNeed => {
  if (isLoading || isError || status === 'complete') return null;
  return status === 'rejected' ? 'rejected' : 'setup';
};
