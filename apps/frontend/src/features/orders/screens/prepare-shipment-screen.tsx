import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import { ScrollView, Linking } from 'react-native';
import type { ImageSource } from 'expo-image';
import {
  Stack,
  useLocalSearchParams,
  useRouter,
  RelativePathString,
  usePreventRemove,
} from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../../shared/ui/base';
import { GlobalHeader } from '../../../shared/ui/global-header';
import { ScreenHeader } from '../../../shared/ui/screen-header';
import { AddressSection } from '../../../components/features/checkout/AddressSection';
import { AddressPickerModal } from '../../../components/features/address/AddressPickerModal';
import { PrimaryButton } from '../../../shared/ui/primary-button';
import { ErrorState } from '../../../shared/ui/error-state';
import { Skeleton } from '../../../shared/ui/skeleton';
import { LabelWithHelp } from '../../../shared/ui/label-with-help';
import { PrepareShipmentSelector } from '../components/prepare-shipment-selector';
import { PrepareBoxCard } from '../components/prepare-box-card';
import { ConnectOnboardingNotice } from '../components/connect-onboarding-notice';
import { ExistingLabelCard } from '../components/existing-label-card';
import { LabelSuccessDialog } from '../components/label-success-dialog';
import { PackagingGuideCard } from '../components/packaging-guide-card';
import { ShipmentLabelRecoveryCard } from '../components/shipment-label-recovery-card';
import { useOrderById } from '../hooks/use-orders';
import { useOrderActions } from '../hooks/use-order-actions';
import { useShipmentLabelRefresh } from '../hooks/use-shipment-label-refresh';
import { resolvePreparingBox } from '../logic/preparing-box';
import {
  PackagePreset,
  PackagePresetsMap,
  useSystemConfig,
} from '../../../shared/hooks/use-system-config';
import { authenticateAsync } from '../../../core/utils/biometrics';
import {
  generateLabelWithRecovery,
  openGeneratedLabel,
  type LabelDiagnostic,
} from '../logic/shipping-label-outcome';
import {
  isLabelRecoveryState,
  resolveShipmentLabelState,
} from '../logic/shipment-label-state';
import { Address } from '@selene/types';
import { Theme } from '../../../shared/theme';
import { EvidenceUploadSection } from '@/features/orders/components/evidence-upload-section';
import { useAuthContext } from '@/shared/lib/auth/auth-provider';
import { useConnectOnboarding } from '../../../core/hooks/useConnectOnboarding';

const EVIDENCE_MIN_PHOTOS = 3;

/** 1:1 illustrations shown in each evidence slot's intro dialog. */
const EVIDENCE_SLOT_IMAGES: (ImageSource | number)[] = [
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/assets/images/packaging/evidencia-1-producto.webp'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/assets/images/packaging/evidencia-2-caja.webp'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/assets/images/packaging/evidencia-3-caja-completa.webp'),
];

/** Accordion icons for the five packing steps, in packSteps order. */
const PACK_STEP_ICONS = [
  'cube-outline',
  'shield-check-outline',
  'newspaper',
  'zip-box',
  'label-outline',
] as const;

export function PrepareShipmentScreen() {
  const { id, shipment_id } = useLocalSearchParams<{
    id: string;
    shipment_id?: string;
  }>();
  const { session } = useAuthContext();
  const selection = Array.isArray(shipment_id) ? shipment_id[0] : shipment_id;
  return (
    <PrepareShipmentContent
      key={JSON.stringify([id, selection, session?.user.id])}
    />
  );
}

function PrepareShipmentContent() {
  const { id, shipment_id } = useLocalSearchParams<{
    id: string;
    shipment_id?: string;
  }>();
  const selectedShipmentId = Array.isArray(shipment_id)
    ? shipment_id[0]
    : shipment_id;
  const { t } = useTranslation(['orders', 'common']);
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    data: order,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useOrderById(id);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const actions = useOrderActions(id || '');

  const { session } = useAuthContext();
  const userId = session?.user.id;

  const sellerShipments = useMemo(() => {
    return (
      order?.shipments?.filter((shipment) => shipment.seller_id === userId) ??
      []
    );
  }, [order?.shipments, userId]);

  const selectedShipment = useMemo(() => {
    if (!selectedShipmentId) return null;
    return (
      sellerShipments.find((shipment) => shipment.id === selectedShipmentId) ??
      null
    );
  }, [selectedShipmentId, sellerShipments]);

  const targetShipmentId = selectedShipment?.id;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submissionInFlight = useRef(false);
  const evidenceBusy = useRef(false);
  const [isEvidenceBusy, setIsEvidenceBusy] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const isProcessing = isAuthenticating || actions.generateLabel.isLoading;
  const canInteract = useCallback(
    () => mounted.current && !submissionInFlight.current && !isProcessing,
    [isProcessing],
  );
  const hasExistingLabel = Boolean(selectedShipment?.label_url);
  const labelState = resolveShipmentLabelState(
    selectedShipment,
    Boolean(error),
  );
  const canGenerateLabel = labelState === 'ready' && !isFetching;

  // Bloquea hardware back (Android) y swipe de borde (iOS) mientras procesa:
  usePreventRemove(isProcessing, () => {});

  const { data: systemConfig } = useSystemConfig();
  const packagePresets = systemConfig?.package_presets as unknown as
    PackagePresetsMap | undefined;
  const presetId = selectedShipment?.items[0]?.product?.package_preset ?? null;
  const preparingBox = resolvePreparingBox(presetId, packagePresets);
  const boxPreset: PackagePreset | undefined =
    'preset' in preparingBox ? preparingBox.preset : undefined;
  // Mirrors the server: without a usable box no label can be generated.
  const boxBlocked = preparingBox.status === 'unavailable';

  const { isComplete: onboardingDone, isLoading: onboardingLoading } =
    useConnectOnboarding(userId);

  const addressModalRef = useRef<BottomSheetModal>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<Address | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);
  const [labelOpenError, setLabelOpenError] = useState(false);

  const reportLabelDiagnostic = useCallback(
    (event: LabelDiagnostic) => {
      console.warn('[PREPARE_SHIPMENT]', {
        event,
        shipmentId: targetShipmentId,
      });
    },
    [targetShipmentId],
  );

  const handleRefreshLabelStatus = useCallback(async () => {
    setErrorMsg(null);
    try {
      const refreshed = await refetch({ cancelRefetch: false });
      if (refreshed.error) reportLabelDiagnostic('status_refresh_failed');
    } catch {
      reportLabelDiagnostic('status_refresh_failed');
    }
  }, [refetch, reportLabelDiagnostic]);

  useShipmentLabelRefresh(targetShipmentId, handleRefreshLabelStatus);

  const handleOpenLabel = async (url: string) => {
    if (!canInteract()) return false;
    setLabelOpenError(false);
    const opened = await openGeneratedLabel(
      url,
      (value) => Linking.openURL(value),
      reportLabelDiagnostic,
    );
    if (!mounted.current) return false;
    if (!opened) {
      setLabelOpenError(true);
      setErrorMsg(t('orders:prepare.errors.labelOpenFailed'));
    }
    return opened;
  };

  const handleAddressSelect = useCallback((addr: Address) => {
    if (!mounted.current || submissionInFlight.current) return;
    setSelectedOrigin(addr);
  }, []);

  const remainingPhotos = Math.max(
    0,
    EVIDENCE_MIN_PHOTOS - evidenceUrls.length,
  );

  const handleConfirm = async () => {
    if (
      !mounted.current ||
      submissionInFlight.current ||
      evidenceBusy.current ||
      isProcessing ||
      !selectedOrigin ||
      !targetShipmentId ||
      boxBlocked ||
      !canGenerateLabel ||
      evidenceUrls.length < EVIDENCE_MIN_PHOTOS
    )
      return;

    submissionInFlight.current = true;
    setIsAuthenticating(true);
    setErrorMsg(null);

    try {
      addressModalRef.current?.dismiss();
      const auth = await authenticateAsync(t('orders:prepare.securityReason'));
      if (!auth.success || !mounted.current) return;

      const result = await generateLabelWithRecovery({
        generate: () =>
          actions.generateLabel.execute({
            shipmentId: targetShipmentId,
            originAddressId: selectedOrigin.id,
            shippingEvidence: { images: evidenceUrls },
          }),
        recover: async () => {
          const refreshed = await refetch();
          if (refreshed.error) throw refreshed.error;
          return (
            refreshed.data?.shipments?.find(
              (shipment) =>
                shipment.id === targetShipmentId &&
                shipment.seller_id === userId,
            )?.label_url ?? null
          );
        },
        feedback: () =>
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
        report: reportLabelDiagnostic,
      });

      if (!mounted.current) return;
      if (result.kind === 'generated') {
        setLabelUrl(result.labelUrl);
        setLabelOpenError(false);
        setShowSuccess(true);
      } else {
        setErrorMsg(t(`orders:${result.errorKey}`));
      }
    } catch {
      reportLabelDiagnostic('generation_unconfirmed');
      if (mounted.current)
        setErrorMsg(t('orders:prepare.errors.resultUnconfirmed'));
    } finally {
      submissionInFlight.current = false;
      if (mounted.current) setIsAuthenticating(false);
    }
  };

  if (isLoading && !order) {
    return (
      <Box flex={1} backgroundColor="background">
        <GlobalHeader showBack />
        <Box padding="m" style={{ paddingTop: insets.top + 80 }}>
          <Skeleton width="100%" height={150} borderRadius={12} />
          <Skeleton width="100%" height={200} borderRadius={12} />
        </Box>
      </Box>
    );
  }

  if (!order) {
    return (
      <Box flex={1} backgroundColor="background">
        <GlobalHeader showBack />
        <ErrorState title={t('common:errors.title')} onRetry={refetch} />
      </Box>
    );
  }

  const orderReference = order.id.slice(0, 8).toUpperCase();

  // Status card above the primary button, always visible so the disabled
  // button never lacks an explanation. Priority: missing photos, missing
  // origin, shipment not ready, all met (cost warning).
  const statusEntry =
    remainingPhotos > 0
      ? {
          icon: 'information-outline' as const,
          color: theme.colors.primary,
          message: t('orders:prepare.statusMissingPhotos', {
            count: remainingPhotos,
          }),
        }
      : !selectedOrigin
        ? {
            icon: 'information-outline' as const,
            color: theme.colors.primary,
            message: t('orders:prepare.statusMissingOrigin'),
          }
        : selectedShipment?.status !== 'paid'
          ? {
              icon: 'information-outline' as const,
              color: theme.colors.primary,
              message: t('orders:prepare.statusNotReady'),
            }
          : boxBlocked
            ? {
                icon: 'information-outline' as const,
                color: theme.colors.primary,
                message: t('orders:prepare.statusBoxUnavailable'),
              }
            : {
                icon: 'alert-outline' as const,
                color: theme.colors.warning,
                message: t('orders:prepare.generateWarning'),
              };

  const statusCard = (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      marginBottom="m"
      borderWidth={1}
      borderColor="separator"
    >
      <Box flexDirection="row" alignItems="center" gap="s">
        <MaterialCommunityIcons
          name={statusEntry.icon}
          size={20}
          color={statusEntry.color}
        />
        <Text variant="body-sm" color="textPrimary" flex={1}>
          {statusEntry.message}
        </Text>
      </Box>
    </Box>
  );

  const whyDescription = [
    t('orders:prepare.whyBullet1'),
    t('orders:prepare.whyBullet2'),
  ]
    .map((bullet) => `• ${bullet}`)
    .join('\n');

  return (
    <Box
      flex={1}
      backgroundColor="background"
      pointerEvents={isProcessing ? 'none' : 'auto'}
    >
      <Stack.Screen
        options={{ headerShown: false, gestureEnabled: !isProcessing }}
      />
      <GlobalHeader
        showBack
        title={t('orders:prepare.headerTitle')}
        onBack={isProcessing ? () => {} : undefined}
      />

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + 80,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <ScreenHeader
          title={t('orders:prepare.title')}
          subtitle={t('orders:prepare.contextLine', {
            reference: orderReference,
          })}
        />

        {sellerShipments.length > 1 && (
          <PrepareShipmentSelector
            shipments={sellerShipments}
            selectedShipmentId={selectedShipment?.id}
            isProcessing={isProcessing}
            canInteract={canInteract}
            onSelect={(shipmentId) =>
              router.setParams({ shipment_id: shipmentId })
            }
          />
        )}

        <PrepareBoxCard
          productName={selectedShipment?.items[0]?.product?.name}
          boxPreset={boxPreset}
          isFallback={preparingBox.status === 'fallback'}
        />

        <Text variant="subheader-lg" marginBottom="m" color="primary">
          {t('orders:prepare.originTitle')}
        </Text>
        <Box
          backgroundColor="cardBackground"
          padding="m"
          borderRadius="l"
          marginBottom="l"
          borderWidth={1}
          borderColor="separator"
        >
          <AddressSection
            label={t('orders:prepare.originLabel')}
            placeholder={t('orders:prepare.originPlaceholder')}
            address={selectedOrigin}
            disabled={isProcessing}
            onPress={() => {
              if (canInteract()) addressModalRef.current?.present();
            }}
            showError
          />
        </Box>

        <PackagingGuideCard
          disabled={isProcessing}
          canInteract={canInteract}
          title={t('orders:prepare.packTitle')}
          steps={(
            t('orders:prepare.packSteps', {
              returnObjects: true,
            }) as { title: string; hint: string }[]
          ).map((step, index) => ({
            icon: PACK_STEP_ICONS[index],
            title: step.title,
            hint: step.hint,
          }))}
          where={{
            icon: 'map-marker-question',
            title: t('orders:prepare.whereTitle'),
            items: t('orders:prepare.whereItems', {
              returnObjects: true,
            }) as string[],
            cta: t('orders:prepare.whereCta'),
          }}
          consequence={t('orders:prepare.packConsequence')}
        />

        <Text variant="subheader-lg" marginBottom="m" color="primary">
          {t('orders:prepare.evidenceTitle')}
        </Text>
        <Box
          backgroundColor="cardBackground"
          padding="m"
          borderRadius="l"
          marginBottom="l"
          borderWidth={1}
          borderColor="separator"
        >
          <LabelWithHelp
            disabled={isProcessing}
            canInteract={canInteract}
            label={t('orders:prepare.whyLabel')}
            helpTitle={t('orders:prepare.whyTitle')}
            helpDescription={whyDescription}
            confirmLabel={t('orders:prepare.whyClose')}
          />
          <EvidenceUploadSection
            disabled={isProcessing}
            canCapture={canInteract}
            onBusyChange={(busy) => {
              if (!mounted.current) return;
              evidenceBusy.current = busy;
              setIsEvidenceBusy(busy);
            }}
            onFailure={() => {
              if (mounted.current && !submissionInFlight.current)
                setErrorMsg(t('orders:prepare.errors.evidenceFailed'));
            }}
            orderId={id || ''}
            userId={userId || ''}
            maxPhotos={EVIDENCE_MIN_PHOTOS}
            captureLabel={t('orders:prepare.photoCta')}
            photoStateLabels={{
              added: t('orders:prepare.slotPhotoAdded'),
              empty: t('orders:prepare.slotPhotoEmpty'),
            }}
            slotsConfig={[
              {
                label: t('orders:prepare.slotProduct'),
                icon: 'package-variant',
                description: t('orders:prepare.slotProductDesc'),
                image: EVIDENCE_SLOT_IMAGES[0],
              },
              {
                label: t('orders:prepare.slotBox'),
                icon: 'package-variant-closed',
                description: t('orders:prepare.slotBoxDesc'),
                image: EVIDENCE_SLOT_IMAGES[1],
              },
              {
                label: t('orders:prepare.slotSealing'),
                icon: 'tape-measure',
                description: t('orders:prepare.slotSealingDesc'),
                image: EVIDENCE_SLOT_IMAGES[2],
              },
            ]}
            onEvidenceComplete={(urls) => {
              if (mounted.current && !submissionInFlight.current)
                setEvidenceUrls(urls);
            }}
          />
        </Box>

        {errorMsg && (
          <Box
            backgroundColor="errorSubtle"
            padding="m"
            borderRadius="m"
            marginBottom="m"
            borderWidth={1}
            borderColor="error"
          >
            <Text color="error" variant="body-sm">
              {errorMsg}
            </Text>
          </Box>
        )}

        {!onboardingLoading && !onboardingDone && (
          <ConnectOnboardingNotice
            isProcessing={isProcessing}
            onPress={() => {
              if (canInteract())
                router.push('/sell/onboarding' as RelativePathString);
            }}
          />
        )}

        {/* SI LA GUÍA YA EXISTE (POR CORTE DE RED O REAPERTURA), MUESTRA ESTO: */}
        {hasExistingLabel ? (
          <ExistingLabelCard
            isProcessing={isProcessing}
            onViewLabel={() => {
              if (selectedShipment?.label_url) {
                void handleOpenLabel(selectedShipment.label_url);
              }
            }}
          />
        ) : selectedShipment && isLabelRecoveryState(labelState) ? (
          <ShipmentLabelRecoveryCard
            state={labelState}
            isRefreshing={isFetching}
            disabled={isProcessing}
            onRefresh={() => {
              if (canInteract()) void handleRefreshLabelStatus();
            }}
            onSupport={() => {
              if (canInteract()) router.push('/profile/support');
            }}
          />
        ) : (
          /* SI NO EXISTE, MUESTRA EL FORMULARIO NORMAL CON EL BOTÓN BLINDADO */
          <>
            {statusCard}

            {onboardingLoading ? (
              <Skeleton height={48} borderRadius="m" />
            ) : onboardingDone ? (
              <PrimaryButton
                onPress={handleConfirm}
                loading={isProcessing}
                disabled={
                  isProcessing ||
                  isEvidenceBusy ||
                  !selectedOrigin ||
                  !targetShipmentId ||
                  boxBlocked ||
                  !canGenerateLabel ||
                  evidenceUrls.length < EVIDENCE_MIN_PHOTOS
                }
                icon="printer-check"
              >
                {t('orders:prepare.confirmBtn')}
              </PrimaryButton>
            ) : null}
          </>
        )}
      </ScrollView>

      <AddressPickerModal
        innerRef={addressModalRef}
        onSelect={handleAddressSelect}
      />

      <LabelSuccessDialog
        visible={showSuccess && !isProcessing}
        labelOpenError={labelOpenError}
        onConfirm={async () => {
          if (!labelUrl || !(await handleOpenLabel(labelUrl))) return;
          if (!mounted.current || submissionInFlight.current) return;
          setShowSuccess(false);
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace(`/profile/orders/${id}`);
          }
        }}
      />
    </Box>
  );
}
