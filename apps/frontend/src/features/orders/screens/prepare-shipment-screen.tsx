import React from 'react';
import { ScrollView } from 'react-native';
import type { ImageSource } from 'expo-image';
import {
  Stack,
  useLocalSearchParams,
  useRouter,
  RelativePathString,
} from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../../shared/ui/base';
import { GlobalHeader } from '../../../shared/ui/global-header';
import { ScreenHeader } from '../../../shared/ui/screen-header';
import { AddressSection } from '../../../shared/ui/address-section';
import { AddressPickerModal } from '../../../shared/ui/address-picker-modal';
import { PrimaryButton } from '../../../shared/ui/primary-button';
import { ErrorState } from '../../../shared/ui/error-state';
import { Skeleton } from '../../../shared/ui/skeleton';
import { LabelWithHelp } from '../../../shared/ui/label-with-help';
import { PrepareShipmentSelector } from '../components/prepare-shipment-selector';
import { PrepareBoxCard } from '../components/prepare-box-card';
import { PrepareStatusCard } from '../components/prepare-status-card';
import { ConnectOnboardingNotice } from '../components/connect-onboarding-notice';
import { ExistingLabelCard } from '../components/existing-label-card';
import { LabelSuccessDialog } from '../components/label-success-dialog';
import { PackagingGuideCard } from '../components/packaging-guide-card';
import { ShipmentLabelRecoveryCard } from '../components/shipment-label-recovery-card';
import {
  EVIDENCE_MIN_PHOTOS,
  usePrepareShipment,
} from '../hooks/use-prepare-shipment';
import { isLabelRecoveryState } from '../logic/shipment-label-state';
import { EvidenceUploadSection } from '@/features/orders/components/evidence-upload-section';
import { useAuthContext } from '@/shared/lib/auth/auth-provider';

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
  const { t } = useTranslation(['orders', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    id,
    userId,
    order,
    isLoading,
    isFetching,
    refetch,
    errorMsg,
    evidenceUrls,
    sellerShipments,
    selectedShipment,
    targetShipmentId,
    isProcessing,
    isEvidenceBusy,
    canInteract,
    hasExistingLabel,
    labelState,
    canGenerateLabel,
    preparingBox,
    boxPreset,
    boxBlocked,
    onboardingDone,
    onboardingLoading,
    addressModalRef,
    selectedOrigin,
    showSuccess,
    labelOpenError,
    remainingPhotos,
    handleRefreshLabelStatus,
    handleOpenLabel,
    handleAddressSelect,
    handleConfirm,
    handleEvidenceBusyChange,
    handleEvidenceFailure,
    handleEvidenceComplete,
    handleSuccessConfirm,
  } = usePrepareShipment();

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
            onBusyChange={handleEvidenceBusyChange}
            onFailure={handleEvidenceFailure}
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
            onEvidenceComplete={handleEvidenceComplete}
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
            <PrepareStatusCard
              remainingPhotos={remainingPhotos}
              hasOrigin={Boolean(selectedOrigin)}
              isShipmentPaid={selectedShipment?.status === 'paid'}
              boxBlocked={boxBlocked}
            />

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
        onConfirm={handleSuccessConfirm}
      />
    </Box>
  );
}
