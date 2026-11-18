import { useAuthContext } from '../lib/auth/auth-provider';
import {
  resolvePaymentSetupNeed,
  type PaymentSetupNeed,
} from '../utils/payment-setup-need';
import { useConnectOnboarding } from './use-connect-onboarding';

/** The current seller's missing payment setup; null when set up or unknown. */
export function usePaymentSetupNeed(): PaymentSetupNeed {
  const { session } = useAuthContext();
  const userId = session?.user.id;
  const { status, isLoading, statusError } = useConnectOnboarding(userId);
  return resolvePaymentSetupNeed({
    hasUser: !!userId,
    status,
    isLoading,
    isError: statusError !== null,
  });
}
