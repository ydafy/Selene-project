import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { NoticeBanner } from '../../../shared/ui/notice-banner';
import { useAuthContext } from '../../../shared/lib/auth/auth-provider';
import { useConnectOnboarding } from '../../../features/payments/hooks/use-connect-onboarding';
import { useMyListings } from '../../../core/hooks/useMyListings';
import { resolveConnectBanner } from '../../../features/payments/logic/connect-banner';

/**
 * Tells sellers with listings why buyers cannot pay them until Stripe Connect
 * onboarding is complete. The card opens the onboarding screen.
 */
export const ConnectIncompleteBanner = () => {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const { session } = useAuthContext();
  const { data: listings } = useMyListings();
  const { status, isLoading, statusError } = useConnectOnboarding(
    session?.user.id,
  );

  const variant = resolveConnectBanner({
    listingsCount: listings?.length ?? 0,
    status,
    isLoading,
    isError: !!statusError,
  });

  if (!variant) return null;

  return (
    <NoticeBanner
      tone={variant === 'rejected' ? 'critical' : 'warning'}
      icon={
        variant === 'rejected'
          ? 'alert-circle-outline'
          : 'credit-card-clock-outline'
      }
      title={t(`connectBanner.${variant}.title`)}
      message={t(`connectBanner.${variant}.message`)}
      accessibilityHint={t(`connectBanner.${variant}.cta`)}
      onPress={() => router.push('/sell/onboarding')}
    />
  );
};
