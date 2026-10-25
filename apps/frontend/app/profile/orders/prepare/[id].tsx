import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  ScrollView,
  Linking,
  TouchableOpacity,
  ImageSourcePropType,
} from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import {
  Stack,
  useLocalSearchParams,
  useRouter,
  RelativePathString,
} from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../../../components/base';
import { GlobalHeader } from '../../../../components/layout/GlobalHeader';
import { ScreenHeader } from '../../../../components/layout/ScreenHeader';
import { AddressSection } from '../../../../components/features/checkout/AddressSection';
import { AddressPickerModal } from '../../../../components/features/address/AddressPickerModal';
import { PrimaryButton } from '../../../../components/ui/PrimaryButton';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { LabelWithHelp } from '../../../../components/ui/LabelWithHelp';
import { PackagingGuideCard } from '../../../../components/features/orders/PackagingGuideCard';
import { ShipmentLabelRecoveryCard } from '../../../../components/features/orders/ShipmentLabelRecoveryCard';
import { useOrderById } from '../../../../core/hooks/useOrders';
import { useOrderActions } from '../../../../core/hooks/useOrderActions';
import { useShipmentLabelRefresh } from '../../../../core/hooks/useShipmentLabelRefresh';
import { resolvePreparingBox } from '../../../../core/utils/preparing-box';
import {
  PackagePreset,
  PackagePresetsMap,
  useSystemConfig,
} from '../../../../core/hooks/useSystemConfig';
import { authenticateAsync } from '../../../../core/utils/biometrics';
import {
  generateLabelWithRecovery,
  openGeneratedLabel,
  type LabelDiagnostic,
} from '../../../../core/utils/shipping-label-outcome';
import {
  isLabelRecoveryState,
  resolveShipmentLabelState,
} from '../../../../core/utils/shipment-label-state';
import { Address } from '@selene/types';
import { Theme } from '../../../../core/theme';
import { EvidenceUploadSection } from '@/components/features/orders/EvidenceUploadSection';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { useConnectOnboarding } from '../../../../core/hooks/useConnectOnboarding';

const EVIDENCE_MIN_PHOTOS = 3;

/** 1:1 illustrations shown in each evidence slot's intro dialog. */
const EVIDENCE_SLOT_IMAGES: ImageSourcePropType[] = [
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../assets/images/packaging/evidencia-1-producto.webp'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../assets/images/packaging/evidencia-2-caja.webp'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../assets/images/packaging/evidencia-3-caja-completa.webp'),
];

/** Accordion icons for the five packing steps, in packSteps order. */
const PACK_STEP_ICONS = [
  'cube-outline',
  'shield-check-outline',
  'newspaper',
  'zip-box',
  'label-outline',
] as const;

export default function PrepareShipmentScreen() {
  const { id, shipment_id } = useLocalSearchParams<{ id: string; shipment_id?: string }>();
  const { session } = useAuthContext();
  const selection = Array.isArray(shipment_id) ? shipment_id[0] : shipment_id;
  return <PrepareShipmentContent key={JSON.stringify([id, selection, session?.user.id])} />;
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

  const { data: order, isLoading, isFetching, error, refetch } = useOrderById(id);
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
    return () => { mounted.current = false; };
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
  const labelState = resolveShipmentLabelState(selectedShipment, Boolean(error));
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

  const reportLabelDiagnostic = useCallback((event: LabelDiagnostic) => {
    console.warn('[PREPARE_SHIPMENT]', { event, shipmentId: targetShipmentId });
  }, [targetShipmentId]);

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
                shipment.id === targetShipmentId && shipment.seller_id === userId,
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
      if (mounted.current) setErrorMsg(t('orders:prepare.errors.resultUnconfirmed'));
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
          <Box
            backgroundColor="cardBackground"
            padding="m"
            borderRadius="l"
            marginTop="l"
            marginBottom="l"
            borderWidth={1}
            borderColor="separator"
          >
            {sellerShipments.map((shipment) => (
              <TouchableOpacity
                key={shipment.id}
                disabled={isProcessing}
                accessibilityState={{ disabled: isProcessing }}
                onPress={() => {
                  if (canInteract())
                    router.setParams({ shipment_id: shipment.id });
                }}
              >
                <Box
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  paddingVertical="s"
                  borderBottomWidth={1}
                  borderBottomColor="separator"
                >
                  <Box flex={1}>
                    <Text variant="body-md">
                      {shipment.items[0]?.product?.name ??
                        t('orders:card.unknownProduct')}
                    </Text>
                    <Text variant="caption-md" color="textSecondary">
                      {t(`orders:status.${shipment.status}`)}
                    </Text>
                  </Box>
                  <MaterialCommunityIcons
                    name={
                      selectedShipment?.id === shipment.id
                        ? 'check-circle'
                        : 'chevron-right'
                    }
                    size={20}
                    color={theme.colors.primary}
                  />
                </Box>
              </TouchableOpacity>
            ))}
          </Box>
        )}

        <Text variant="subheader-lg" marginBottom="m" color="primary">
          {t('orders:prepare.boxSectionTitle')}
        </Text>
        <Box
          backgroundColor="cardBackground"
          padding="m"
          borderRadius="l"
          marginBottom="l"
          borderWidth={1}
          borderColor="separator"
        >
          <Box>
            <Text variant="caption-md" color="textSecondary">
              {t('orders:prepare.yourProduct')}
            </Text>
            <Text variant="body-md" fontWeight="bold" marginTop="xs">
              {selectedShipment?.items[0]?.product?.name ??
                t('orders:card.unknownProduct')}
            </Text>
          </Box>

          {boxPreset ? (
            <Box flexDirection="row" alignItems="center" gap="s" marginTop="s">
              <MaterialCommunityIcons
                name="package-variant-closed"
                size={20}
                color={theme.colors.primary}
              />
              <Box flex={1}>
                <Text variant="body-sm" color="textPrimary">
                  {boxPreset.label}
                </Text>
                <Text variant="caption-md" color="textSecondary">
                  {`${boxPreset.length} × ${boxPreset.width} × ${boxPreset.height} cm · ${boxPreset.weight} kg`}
                </Text>
                {preparingBox.status === 'fallback' ? (
                  <Text variant="caption-md" color="textSecondary" marginTop="xs">
                    {t('orders:prepare.boxFallbackNote')}
                  </Text>
                ) : null}
              </Box>
            </Box>
          ) : (
            <Text variant="body-sm" color="textSecondary" marginTop="s">
              {t('orders:prepare.boxUnavailable')}
            </Text>
          )}

          <Box
            flexDirection="row"
            alignItems="flex-start"
            gap="s"
            marginTop="s"
            padding="s"
            backgroundColor="background"
            borderRadius="m"
          >
            <MaterialCommunityIcons
              name="alert-outline"
              size={16}
              color={theme.colors.warning}
            />
            <Text variant="caption-md" color="textSecondary" flex={1}>
              {t('orders:prepare.boxWarning')}
            </Text>
          </Box>
        </Box>

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
              if (mounted.current && !submissionInFlight.current) setEvidenceUrls(urls);
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
          <Box
            backgroundColor="cardBackground"
            padding="m"
            borderRadius="l"
            marginBottom="m"
            borderWidth={1}
            borderColor="warning"
          >
            <Box flexDirection="row" alignItems="flex-start" gap="s">
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={20}
                color={theme.colors.warning}
              />
              <Box flex={1}>
                <Text variant="body-md" fontWeight="bold" marginBottom="xs">
                  {t('orders:prepare.connectTitle')}
                </Text>
                <Text variant="body-sm" color="textSecondary" marginBottom="m">
                  {t('orders:prepare.connectBody')}
                </Text>
                <PrimaryButton
                  disabled={isProcessing}
                  onPress={() => {
                    if (canInteract())
                      router.push('/sell/onboarding' as RelativePathString);
                  }}
                  icon="bank-outline"
                >
                  {t('orders:prepare.connectCta')}
                </PrimaryButton>
              </Box>
            </Box>
          </Box>
        )}

        {/* SI LA GUÍA YA EXISTE (POR CORTE DE RED O REAPERTURA), MUESTRA ESTO: */}
        {hasExistingLabel ? (
          <Box
            backgroundColor="cardBackground"
            padding="m"
            borderRadius="l"
            marginBottom="m"
            borderWidth={1}
            borderColor="success"
          >
            <Box
              flexDirection="row"
              alignItems="center"
              gap="s"
              marginBottom="s"
            >
              <MaterialCommunityIcons
                name="check-decagram"
                size={22}
                color={theme.colors.success}
              />
              <Text variant="body-md" fontWeight="bold">
                {t('orders:prepare.alreadyGeneratedTitle', {
                  defaultValue: 'Guía ya generada',
                })}
              </Text>
            </Box>
            <Text variant="body-sm" color="textSecondary" marginBottom="m">
              {t('orders:prepare.alreadyGeneratedDesc', {
                defaultValue:
                  'Este envío ya cuenta con su guía de paquetería generada.',
              })}
            </Text>
            <PrimaryButton
              disabled={isProcessing}
              onPress={() => {
                if (selectedShipment?.label_url) {
                  void handleOpenLabel(selectedShipment.label_url);
                }
              }}
              icon="printer-check"
            >
              {t('orders:actions.viewPdf', {
                defaultValue: 'Ver PDF de la guía',
              })}
            </PrimaryButton>
          </Box>
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

      <ConfirmDialog
        visible={showSuccess && !isProcessing}
        title={t('orders:prepare.successTitle')}
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
        onCancel={() => {}}
        confirmLabel={t('orders:actions.viewPdf')}
        hideCancel
      >
        <Box alignItems="center" paddingVertical="m">
          <MotiView
            from={{ translateX: -100, opacity: 0 }}
            animate={{ translateX: 0, opacity: 1 }}
            transition={{ type: 'spring', duration: 2000 }}
          >
            <MaterialCommunityIcons
              name="truck-fast"
              size={80}
              color={theme.colors.primary}
            />
          </MotiView>
          <Text variant="body-md" textAlign="center" marginTop="m">
            {t('orders:prepare.successMsg')}
          </Text>
          {labelOpenError && (
            <Text variant="body-sm" color="error" textAlign="center" marginTop="m">
              {t('orders:prepare.errors.labelOpenFailed')}
            </Text>
          )}
        </Box>
      </ConfirmDialog>
    </Box>
  );
}
