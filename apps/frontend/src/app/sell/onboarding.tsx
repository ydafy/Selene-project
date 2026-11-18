/**
 * @file app/sell/onboarding.tsx
 * @description Stripe Connect onboarding guide for sellers.
 */
import { useCallback } from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';

import { Box, Text } from '@/shared/ui/base';
import { GlobalHeader } from '@/shared/ui/layout/global-header';
import { ScreenHeader } from '@/shared/ui/layout/screen-header';
import { PrimaryButton } from '@/shared/ui/button/primary-button';
import { ErrorState } from '@/shared/ui/feedback/error-state';
import { Skeleton } from '@/shared/ui/feedback/skeleton';
import { LabelWithHelp } from '@/shared/ui/form/label-with-help';
import { SellerPaymentExplanation } from '@/shared/ui/seller-payment-explanation';
import { useAuthContext } from '@/shared/lib/auth/auth-provider';
import { useConnectOnboarding } from '@/shared/hooks/use-connect-onboarding';
import { resolveFirstListingOnboardingExit } from '@/features/payments/logic/first-listing-payment-flow';
import {
  resolveConnectOnboardingHeaderKeys,
  resolveConnectOnboardingStripeReturn,
  resolveConnectOnboardingUiState,
  resolveConnectOnboardingVisibleError,
} from '@/features/payments/logic/connect-onboarding-ui';
import {
  OnboardingGuideCards,
  PaymentsExplanationToggle,
} from '@/features/payments/components/onboarding-guide';
import { useAnnounceOnboardingNotice } from '@/features/payments/hooks/use-announce-onboarding-notice';
import { Theme } from '@/shared/theme';

// Room under the guide for the fixed footer: the main button, plus the "later" link when shown.
const FOOTER_SPACE = 120;
const LATER_LINK_SPACE = 50;

export default function SellerOnboardingScreen() {
  const { t } = useTranslation(['sellerOnboarding']);
  const router = useRouter();
  const params = useLocalSearchParams<{
    return?: string;
    refresh?: string;
    from?: string;
  }>();
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const userId = session?.user.id;

  const {
    status,
    isComplete,
    isLoading,
    isStarting,
    isRefreshingFromStripe,
    error,
    refreshError,
    statusError,
    startOnboarding,
  } = useConnectOnboarding(userId);
  const stripeReturn = resolveConnectOnboardingStripeReturn(params);
  // Step 2 after publishing is optional: "later" always leaves (S3, S5).
  const exit = resolveFirstListingOnboardingExit(params);
  const onboardingUi = resolveConnectOnboardingUiState({
    userId,
    status,
    isComplete,
    isLoading,
    isStarting,
    isRefreshingFromStripe,
    stripeReturn,
  });

  const header = resolveConnectOnboardingHeaderKeys(
    onboardingUi.statusNoticeKey,
  );
  const headerTitle = t(header.titleKey);
  const headerSubtitle = t(header.subtitleKey);
  useAnnounceOnboardingNotice(
    onboardingUi.statusNoticeKey ? `${headerTitle}. ${headerSubtitle}` : null,
  );

  const handleStart = useCallback(async () => {
    try {
      await startOnboarding();
    } catch {
      return;
    }
  }, [startOnboarding]);

  const visibleErrorKey = resolveConnectOnboardingVisibleError({
    status,
    error,
    refreshError,
    statusError,
  });
  const visibleErrorMessage = visibleErrorKey
    ? t(`sellerOnboarding:errors.${visibleErrorKey}`)
    : null;

  if (onboardingUi.viewState === 'auth-required') {
    return (
      <Box flex={1} backgroundColor="background">
        <GlobalHeader title={t('sellerOnboarding:header.navTitle')} showBack />
        <ErrorState title={t('sellerOnboarding:errors.authRequired')} />
      </Box>
    );
  }

  if (onboardingUi.viewState === 'loading') {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader
          title={t('sellerOnboarding:header.navTitle')}
          showBack
          backgroundColor="cardBackground"
        />

        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingTop: insets.top + 80,
            paddingBottom: insets.bottom + 40,
            gap: 16,
          }}
        >
          <ScreenHeader
            title={t('sellerOnboarding:loading.title')}
            subtitle={t('sellerOnboarding:loading.subtitle')}
          />
          <Skeleton height={48} borderRadius="m" />
          <Skeleton height={280} borderRadius="l" />
        </ScrollView>
      </Box>
    );
  }

  if (onboardingUi.viewState === 'success') {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader
          title={t('sellerOnboarding:header.navTitle')}
          showBack
          backgroundColor="cardBackground"
        />

        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingTop: insets.top + 80,
            paddingBottom: insets.bottom + 40,
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <MaterialCommunityIcons
            name="check-decagram"
            size={88}
            color={theme.colors.primary}
            style={{ marginBottom: 24 }}
          />

          <Text
            variant="header-xl"
            textAlign="center"
            marginBottom="s"
            color="textPrimary"
          >
            {t('sellerOnboarding:success.title')}
          </Text>

          <Text
            variant="body-md"
            textAlign="center"
            color="textSecondary"
            marginBottom="xl"
            style={{ paddingHorizontal: 16 }}
          >
            {t('sellerOnboarding:success.subtitle')}
          </Text>

          <Box width="100%" marginBottom="l">
            <PaymentsExplanationToggle>
              <SellerPaymentExplanation />
            </PaymentsExplanationToggle>
          </Box>

          <Box width="100%">
            <PrimaryButton
              onPress={() => router.replace(exit.successRoute)}
              icon="check"
            >
              {t('sellerOnboarding:success.cta')}
            </PrimaryButton>
          </Box>
        </ScrollView>
      </Box>
    );
  }

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader
        title={t('sellerOnboarding:header.navTitle')}
        showBack
        backgroundColor="cardBackground"
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + 80,
          paddingBottom:
            insets.bottom +
            FOOTER_SPACE +
            (exit.showLater ? LATER_LINK_SPACE : 0),
          gap: 16,
        }}
      >
        <ScreenHeader title={headerTitle} subtitle={headerSubtitle} />

        <LabelWithHelp
          label={t('sellerOnboarding:whatIsStripe.label')}
          helpTitle={t('sellerOnboarding:whatIsStripe.title')}
          helpDescription={t('sellerOnboarding:whatIsStripe.desc')}
          confirmLabel={t('sellerOnboarding:whatIsStripe.confirm')}
          color="primary"
        />

        {onboardingUi.showStripeReturnRefreshMessage && (
          <Text variant="body-sm" color="textSecondary">
            {t('sellerOnboarding:actions.checking')}
          </Text>
        )}

        <OnboardingGuideCards />

        {visibleErrorMessage && (
          <Box
            backgroundColor="errorSubtle"
            padding="m"
            borderRadius="m"
            borderWidth={1}
            borderColor="error"
          >
            <Text color="error" variant="body-sm">
              {visibleErrorMessage}
            </Text>
          </Box>
        )}
      </ScrollView>

      {onboardingUi.showStartCta && (
        <Box
          position="absolute"
          bottom={insets.bottom}
          left={0}
          right={0}
          padding="m"
        >
          <PrimaryButton
            onPress={handleStart}
            loading={onboardingUi.ctaLoading}
            disabled={onboardingUi.ctaDisabled}
            icon="bank-outline"
          >
            {t(`sellerOnboarding:actions.${onboardingUi.ctaKey}`)}
          </PrimaryButton>

          {exit.showLater && (
            <TouchableOpacity
              onPress={() => router.replace(exit.successRoute)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Box padding="m" alignItems="center">
                <Text
                  variant="body-md"
                  color="textSecondary"
                  textDecorationLine="underline"
                >
                  {t('sellerOnboarding:actions.later')}
                </Text>
              </Box>
            </TouchableOpacity>
          )}
        </Box>
      )}
    </Box>
  );
}
