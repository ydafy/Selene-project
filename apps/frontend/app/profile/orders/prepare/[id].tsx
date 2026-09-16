import React, { useState, useRef, useCallback, useMemo } from 'react';
import { ScrollView, Linking, TouchableOpacity } from 'react-native';
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
import { useOrderById } from '../../../../core/hooks/useOrders';
import { useOrderActions } from '../../../../core/hooks/useOrderActions';
import { formatCurrency } from '../../../../core/utils/format';
import { authenticateAsync } from '../../../../core/utils/biometrics';
import { Address } from '@selene/types';
import { Theme } from '../../../../core/theme';
import { EvidenceUploadSection } from '@/components/features/orders/EvidenceUploadSection';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { useConnectOnboarding } from '../../../../core/hooks/useConnectOnboarding';

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

  console.log('[DEBUG SELLER SCREEN]', {
    orderId: id,
    userId,
    hasOrder: Boolean(order),
    shipmentsCount: order?.shipments?.length,
    shipments: order?.shipments,
  });

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
  const selectedShipmentTotal =
    selectedShipment?.items.reduce(
      (total, item) => total + Number(item.price_at_purchase),
      0,
    ) ?? 0;

  const { isComplete: onboardingDone, isLoading: onboardingLoading } =
    useConnectOnboarding(userId);

  const addressModalRef = useRef<BottomSheetModal>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<Address | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);

  const handleAddressSelect = useCallback((addr: Address) => {
    setSelectedOrigin(addr);
  }, []);

  const handleConfirm = async () => {
    if (
      !selectedOrigin ||
      !targetShipmentId ||
      selectedShipment?.status !== 'paid' ||
      evidenceUrls.length < 3
    )
      return;

    const auth = await authenticateAsync(t('orders:prepare.securityReason'));
    if (!auth.success) return;

    try {
      const result = await actions.generateLabel.execute({
        shipmentId: targetShipmentId,
        originAddressId: selectedOrigin.id,
        shippingEvidence: { images: evidenceUrls },
      });
      console.log('[DEBUG] Sending evidenceUrls:', evidenceUrls);

      if (result && result.labelUrl) {
        setLabelUrl(result.labelUrl);
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        setShowSuccess(true);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setErrorMsg(e.message || t('common:errors.generic'));
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

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader showBack title={t('orders:prepare.headerTitle')} />

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + 80,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <ScreenHeader
          title={t('orders:prepare.title')}
          subtitle={t('orders:prepare.subtitle')}
        />

        <Box
          backgroundColor="cardBackground"
          padding="m"
          borderRadius="l"
          marginTop="l"
          borderWidth={1}
          borderColor="separator"
        >
          <Text variant="body-sm" color="textSecondary">
            {t('orders:prepare.packagingGuidance')}
          </Text>
        </Box>

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
                    {shipment.items[0]?.product?.name ?? 'Producto'}
                  </Text>
                  <Text variant="caption-md" color="textSecondary">
                    {shipment.status}
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

        <Box marginTop="l">
          <AddressSection
            label={t('orders:prepare.originLabel')}
            placeholder={t('orders:prepare.originPlaceholder')}
            address={selectedOrigin}
            onPress={() => addressModalRef.current?.present()}
            showError={false}
          />
        </Box>

        <Box>
          <Text variant="subheader-lg" marginBottom="m" color="primary">
            Evidecia de envío
          </Text>
        </Box>
        <Box
          backgroundColor="cardBackground"
          padding="m"
          borderRadius="l"
          marginBottom="l"
        >
          <Text
            style={{ lineHeight: 20 }}
            variant="body-sm"
            color="textSecondary"
          >
            Deves subir al menos 3 fotos de evidencia del paquete y su contenido
            para poder generar la etiqueta de envío.
          </Text>
        </Box>

        <EvidenceUploadSection
          orderId={id || ''}
          userId={userId || ''}
          onEvidenceComplete={(urls) => setEvidenceUrls(urls)}
        />
        <Box
          backgroundColor="cardBackground"
          padding="m"
          borderRadius="l"
          marginBottom="l"
          borderWidth={1}
          borderColor="separator"
        >
          <Text variant="subheader-md" marginBottom="m">
            {t('orders:prepare.summaryTitle')}
          </Text>

          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text variant="body-md" color="textSecondary">
              {t('orders:prepare.totalSale')}
            </Text>
            <Text variant="body-md">
              {formatCurrency(selectedShipmentTotal)}
            </Text>
          </Box>

          <Box
            height={1}
            backgroundColor="separator"
            marginVertical="s"
            opacity={0.3}
          />

          <Box flexDirection="row" alignItems="center" gap="s">
            <MaterialCommunityIcons
              name="information-outline"
              size={16}
              color={theme.colors.primary}
            />
            <Text variant="caption-md" color="textPrimary" flex={1}>
              {t('orders:prepare.disclaimer')}
            </Text>
          </Box>
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
                  Completá tu registro de pagos
                </Text>
                <Text variant="body-sm" color="textSecondary" marginBottom="m">
                  Para recibir pagos de tus ventas, necesitás completar tu
                  registro en Stripe Connect. Es gratis y toma 5 minutos.
                </Text>
                <PrimaryButton
                  onPress={() =>
                    router.push('/sell/onboarding' as RelativePathString)
                  }
                  icon="bank-outline"
                >
                  Registrarme en Stripe
                </PrimaryButton>
              </Box>
            </Box>
          </Box>
        )}

        {onboardingLoading ? (
          <Skeleton height={48} borderRadius="m" />
        ) : onboardingDone ? (
          <PrimaryButton
            onPress={handleConfirm}
            loading={actions.generateLabel.isLoading}
            disabled={
              !selectedOrigin ||
              !targetShipmentId ||
              selectedShipment?.status !== 'paid' ||
              actions.generateLabel.isLoading ||
              evidenceUrls.length < 3
            }
            icon="printer-check"
          >
            {t('orders:prepare.confirmBtn')}
          </PrimaryButton>
        ) : null}
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
