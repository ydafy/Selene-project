import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { NoticeBanner } from '../../ui/NoticeBanner';
import { useAuthContext } from '../../auth/AuthProvider';
import { useConnectOnboarding } from '../../../core/hooks/useConnectOnboarding';
import { useMyListings } from '../../../core/hooks/useMyListings';
import { resolveConnectBanner } from '../../../core/utils/connectBanner';

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
