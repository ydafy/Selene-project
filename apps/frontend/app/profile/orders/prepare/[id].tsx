import React, { useState, useRef, useCallback, useMemo } from 'react';
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
import { useOrderById } from '../../../../core/hooks/useOrders';
import { useOrderActions } from '../../../../core/hooks/useOrderActions';
import {
  PackagePreset,
  PackagePresetsMap,
  useSystemConfig,
} from '../../../../core/hooks/useSystemConfig';
import { authenticateAsync } from '../../../../core/utils/biometrics';
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

  const { data: order, isLoading, error, refetch } = useOrderById(id);
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

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const isProcessing = isAuthenticating || actions.generateLabel.isLoading;
  const hasExistingLabel = Boolean(selectedShipment?.label_url);

  // Bloquea hardware back (Android) y swipe de borde (iOS) mientras procesa:
  usePreventRemove(isProcessing, () => {});

  const { data: systemConfig } = useSystemConfig();
  const packagePresets = systemConfig?.package_presets as unknown as
    PackagePresetsMap | undefined;
  const presetId = selectedShipment?.items[0]?.product?.package_preset ?? null;
  const boxPreset: PackagePreset | undefined = presetId
    ? packagePresets?.[presetId]
    : undefined;

  const { isComplete: onboardingDone, isLoading: onboardingLoading } =
    useConnectOnboarding(userId);

  const addressModalRef = useRef<BottomSheetModal>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<Address | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);

  const handleAddressSelect = useCallback((addr: Address) => {
    setSelectedOrigin(addr);
  }, []);

  const remainingPhotos = Math.max(
    0,
    EVIDENCE_MIN_PHOTOS - evidenceUrls.length,
  );

  const handleConfirm = async () => {
    if (
      isProcessing ||
      !selectedOrigin ||
      !targetShipmentId ||
      selectedShipment?.status !== 'paid' ||
      evidenceUrls.length < EVIDENCE_MIN_PHOTOS
    )
      return;

    setIsAuthenticating(true);
    setErrorMsg(null);

    try {
      const auth = await authenticateAsync(t('orders:prepare.securityReason'));
      if (!auth.success) {
        setIsAuthenticating(false);
        return;
      }

      const result = await actions.generateLabel.execute({
        shipmentId: targetShipmentId,
        originAddressId: selectedOrigin.id,
        shippingEvidence: { images: evidenceUrls },
      });

      if (result && result.labelUrl) {
        setLabelUrl(result.labelUrl);
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        setShowSuccess(true);
      }
    } catch (e: any) {
      // Si falló por red/timeout, refrescamos por si el backend sí llegó a generarla
      await refetch();
      setErrorMsg(e.message || t('common:errors.generic'));
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (isLoading) {
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

  if (error || !order) {
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
                onPress={() => router.setParams({ shipment_id: shipment.id })}
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
            onPress={() => addressModalRef.current?.present()}
            showError
          />
        </Box>

        <PackagingGuideCard
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
            label={t('orders:prepare.whyLabel')}
            helpTitle={t('orders:prepare.whyTitle')}
            helpDescription={whyDescription}
            confirmLabel={t('orders:prepare.whyClose')}
          />
          <EvidenceUploadSection
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
            onEvidenceComplete={(urls) => setEvidenceUrls(urls)}
          />
        </Box>

        {errorMsg && (
          <Box
            backgroundColor="warning"
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
                  onPress={() =>
                    router.push('/sell/onboarding' as RelativePathString)
                  }
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
              onPress={() => {
                if (selectedShipment?.label_url) {
                  Linking.openURL(selectedShipment.label_url).catch((err) =>
                    console.error("Couldn't open URL", err),
                  );
                }
              }}
              icon="printer-check"
            >
              {t('orders:actions.viewPdf', {
                defaultValue: 'Ver PDF de la guía',
              })}
            </PrimaryButton>
          </Box>
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
                  !selectedOrigin ||
                  !targetShipmentId ||
                  selectedShipment?.status !== 'paid' ||
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
        visible={showSuccess}
        title={t('orders:prepare.successTitle')}
        onConfirm={() => {
          setShowSuccess(false);
          if (labelUrl) {
            Linking.openURL(labelUrl).catch((err) =>
              console.error("Couldn't load page", err),
            );
          }
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
        </Box>
      </ConfirmDialog>
    </Box>
  );
}
