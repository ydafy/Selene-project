/**
 * @file app/sell/onboarding.tsx
 * @description Stripe Connect onboarding wizard for sellers.
 */
import {
  type ReactNode,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import { ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MotiView } from 'moti';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { WizardSteps } from '../../components/features/sell/WizardSteps';
import { AppImageViewer } from '../../components/ui/AppImageViewer';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useConnectOnboarding } from '../../core/hooks/useConnectOnboarding';
import {
  CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE,
  resolveConnectOnboardingUiState,
  resolveConnectOnboardingVisibleError,
} from '../../core/utils/connectOnboardingUi';
import type { StripeOnboardingStatus } from '@selene/types';
import type { ConnectOnboardingStatusGuidanceKey } from '../../core/utils/connectOnboardingUi';
import { Theme } from '../../core/theme';

import {
  ONBOARDING_GUIDE_IMAGE_INDEX,
  ONBOARDING_GUIDE_IMAGES,
  OnboardingStep0,
  OnboardingStep1,
  OnboardingStep2,
  OnboardingStep3,
} from '../../components/features/onboarding/OnboardingSteps';

type OnboardingStepRenderContext = {
  openViewer: (index: number) => void;
  status: StripeOnboardingStatus | null;
  statusGuidanceKey: ConnectOnboardingStatusGuidanceKey | null;
};

const ONBOARDING_STEP_DEFINITIONS = [
  {
    key: 'intro',
    labelKey: 'wallet:onboarding.steps.intro',
    titleKey: 'wallet:onboarding.header.title',
    subtitleKey: 'wallet:onboarding.header.subtitle',
    renderContent: () => <OnboardingStep0 />,
  },
  {
    key: 'type',
    labelKey: 'wallet:onboarding.steps.type',
    titleKey: 'wallet:onboarding.steps.typeTitle',
    subtitleKey: 'wallet:onboarding.steps.typeDesc',
    renderContent: ({ openViewer }: OnboardingStepRenderContext) => (
      <OnboardingStep1
        onImagePress={() => openViewer(ONBOARDING_GUIDE_IMAGE_INDEX.accountType)}
      />
    ),
  },
  {
    key: 'details',
    labelKey: 'wallet:onboarding.steps.details',
    titleKey: 'wallet:onboarding.steps.detailsTitle',
    subtitleKey: 'wallet:onboarding.steps.detailsDesc',
    renderContent: ({ openViewer }: OnboardingStepRenderContext) => (
      <OnboardingStep2
        onImagePress={() =>
          openViewer(ONBOARDING_GUIDE_IMAGE_INDEX.businessDetails)
        }
      />
    ),
  },
  {
    key: 'done',
    labelKey: 'wallet:onboarding.steps.done',
    titleKey: 'wallet:onboarding.steps.doneTitle',
    subtitleKey: 'wallet:onboarding.steps.doneDesc',
    renderContent: ({ status, statusGuidanceKey }) => (
      <OnboardingStep3 status={status} statusGuidanceKey={statusGuidanceKey} />
    ),
  },
] as const satisfies ReadonlyArray<{
  key: string;
  labelKey: string;
  titleKey: string;
  subtitleKey: string;
  renderContent: (context: OnboardingStepRenderContext) => ReactNode;
}>;

const LAST_ONBOARDING_STEP_INDEX = ONBOARDING_STEP_DEFINITIONS.length - 1;
const DEFAULT_ONBOARDING_STEP = ONBOARDING_STEP_DEFINITIONS[0];

export default function SellerOnboardingScreen() {
  const { t } = useTranslation(['wallet']);
  const router = useRouter();
  const params = useLocalSearchParams<{ return?: string; refresh?: string }>();
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const userId = session?.user.id;

  const [currentStep, setCurrentStep] = useState(0);
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const scrollViewRef = useRef<ScrollView>(null);

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
  const isStripeReturn = params.return === '1' || params.refresh === '1';
  const onboardingUi = resolveConnectOnboardingUiState({
    userId,
    currentStep,
    lastStepIndex: LAST_ONBOARDING_STEP_INDEX,
    status,
    isComplete,
    isLoading,
    isStarting,
    isRefreshingFromStripe,
    isStripeReturn,
  });

  useEffect(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, [currentStep]);

  useEffect(() => {
    if (isStripeReturn && !isComplete) {
      setCurrentStep(LAST_ONBOARDING_STEP_INDEX);
    }
  }, [isComplete, isStripeReturn]);

  const handleStart = useCallback(async () => {
    try {
      await startOnboarding();
    } catch {
      return;
    }
  }, [startOnboarding]);

  const handleOpenViewer = useCallback((index: number) => {
    setViewerIndex(index);
    setIsViewerVisible(true);
  }, []);

  const steps = useMemo(
    () => ONBOARDING_STEP_DEFINITIONS.map((step) => t(step.labelKey)),
    [t],
  );

  const currentStepDefinition =
    ONBOARDING_STEP_DEFINITIONS[onboardingUi.effectiveStep] ??
    DEFAULT_ONBOARDING_STEP;

  const { title, subtitle } = useMemo(() => {
    return {
      title: t(currentStepDefinition.titleKey),
      subtitle: t(currentStepDefinition.subtitleKey),
    };
  }, [currentStepDefinition, t]);

  const currentStepContent = useMemo(() => {
    return currentStepDefinition.renderContent({
      openViewer: handleOpenViewer,
      status,
      statusGuidanceKey: onboardingUi.statusGuidanceKey,
    });
  }, [currentStepDefinition, handleOpenViewer, onboardingUi.statusGuidanceKey, status]);

  const activeViewerImages = useMemo(
    () => [ONBOARDING_GUIDE_IMAGES[viewerIndex]],
    [viewerIndex],
  );

  const visibleErrorKey = resolveConnectOnboardingVisibleError({
    status,
    error,
    refreshError,
    statusError,
  });
  const visibleErrorMessage = visibleErrorKey
    ? t(`wallet:onboarding.errors.${visibleErrorKey}`)
    : null;

  if (onboardingUi.viewState === 'auth-required') {
    return (
      <Box flex={1} backgroundColor="background">
        <GlobalHeader showBack />
        <ErrorState title={t('wallet:onboarding.errors.authRequired')} />
      </Box>
    );
  }

  if (onboardingUi.viewState === 'loading') {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader showBack backgroundColor="cardBackground" />

        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingTop: insets.top + 80,
            paddingBottom: insets.bottom + 40,
            gap: 16,
          }}
        >
          <ScreenHeader
            title={t('wallet:onboarding.loading.title')}
            subtitle={t('wallet:onboarding.loading.subtitle')}
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
        <GlobalHeader showBack backgroundColor="cardBackground" />

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
            {t('wallet:onboarding.success.title')}
          </Text>

          <Text
            variant="body-md"
            textAlign="center"
            color="textSecondary"
            marginBottom="xl"
            style={{ paddingHorizontal: 16 }}
          >
            {t('wallet:onboarding.success.subtitle')}
          </Text>

          <Box width="100%">
            <PrimaryButton
              onPress={() => router.replace(CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE)}
              icon="check"
            >
              {t('wallet:onboarding.success.cta')}
            </PrimaryButton>
          </Box>
        </ScrollView>
      </Box>
    );
  }

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader showBack backgroundColor="cardBackground" />

      <ScrollView
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + 80,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <MotiView
          key={onboardingUi.effectiveStep}
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 250 }}
        >
          <ScreenHeader title={title} subtitle={subtitle} />
        </MotiView>

        <WizardSteps currentStep={onboardingUi.effectiveStep} steps={steps} />

        {onboardingUi.showRejectedBanner && (
          <Box
            backgroundColor="warning"
            padding="m"
            borderRadius="m"
            marginBottom="m"
            borderWidth={1}
            borderColor="error"
          >
            <Text color="error" variant="body-md" fontWeight="bold">
              {t('wallet:onboarding.status.rejectedTitle')}
            </Text>
            <Text color="error" variant="body-sm" marginTop="xs">
              {t('wallet:onboarding.status.rejectedDesc')}
            </Text>
          </Box>
        )}

        {onboardingUi.showStripeReturnRefreshMessage && (
          <Box
            backgroundColor="cardBackground"
            padding="m"
            borderRadius="m"
            marginBottom="m"
            borderWidth={1}
            borderColor="separator"
          >
            <Text variant="body-sm" color="textSecondary">
              {t('wallet:onboarding.actions.checking')}
            </Text>
          </Box>
        )}

        <MotiView
          key={`content_${onboardingUi.effectiveStep}`}
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 250 }}
          style={{ minHeight: 280, marginVertical: 12 }}
        >
          {currentStepContent}
        </MotiView>

        {visibleErrorMessage && (
          <Box
            backgroundColor="warning"
            padding="m"
            borderRadius="m"
            marginBottom="m"
            borderWidth={1}
            borderColor="error"
          >
            <Text color="error" variant="body-sm">
              {visibleErrorMessage}
            </Text>
          </Box>
        )}
      </ScrollView>
      <Box
        position="absolute"
        bottom={insets.bottom}
        left={0}
        right={0}
        padding="m"
      >
        <Box flexDirection="row" gap="s" marginTop="m">
          {onboardingUi.showBack && (
            <Box flex={1}>
              <PrimaryButton
                onPress={() => setCurrentStep((prev) => prev - 1)}
                disabled={onboardingUi.backDisabled}
                variant="outline"
                icon="arrow-left"
              >
                {t('wallet:onboarding.actions.back')}
              </PrimaryButton>
            </Box>
          )}

          <Box flex={2}>
            {onboardingUi.showNext ? (
              <PrimaryButton
                onPress={() => setCurrentStep((prev) => prev + 1)}
                disabled={onboardingUi.nextDisabled}
                loading={onboardingUi.nextLoading}
                icon="arrow-right"
              >
                {t('wallet:onboarding.actions.next')}
              </PrimaryButton>
            ) : onboardingUi.showStartCta ? (
              <PrimaryButton
                onPress={handleStart}
                loading={onboardingUi.ctaLoading}
                disabled={onboardingUi.ctaDisabled}
                icon="bank-outline"
              >
                {t(`wallet:onboarding.actions.${onboardingUi.ctaKey}`)}
              </PrimaryButton>
            ) : (
              <Skeleton height={48} borderRadius="m" />
            )}
          </Box>
        </Box>
      </Box>

      <AppImageViewer
        images={activeViewerImages}
        initialIndex={0}
        visible={isViewerVisible}
        onClose={() => setIsViewerVisible(false)}
        closeAccessibilityLabel={t('wallet:onboarding.image.closeLabel')}
        counterAccessibilityLabel={({ current, total }) =>
          t('wallet:onboarding.image.counterLabel', { current, total })
        }
      />
    </Box>
  );
}
