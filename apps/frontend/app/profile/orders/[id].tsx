/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @file app/profile/orders/[id].tsx
 * @description Pantalla orquestadora del detalle de una orden.
 * Centraliza la visualización de estados, logística, productos y acciones críticas.
 * Aplica el patrón de "Slots" delegando la lógica compleja a componentes especializados.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  ScrollView,
  RefreshControl,
  Linking,
  Clipboard,
  TouchableOpacity,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../../components/base';
import { GlobalHeader } from '../../../components/layout/GlobalHeader';
import { ScreenHeader } from '../../../components/layout/ScreenHeader';
import { OrderStepper } from '../../../components/features/orders/OrderStepper';
import { OrderActionCard } from '../../../components/features/orders/OrderActionCard';
import { ShippingInstructions } from '../../../components/features/orders/ShippingInstructions';
import { ShippingRouteCard } from '../../../components/features/orders/ShippingRouteCard';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Skeleton } from '../../../components/ui/Skeleton';
import { AppImage } from '../../../components/ui/AppImage';
import { useOrderById } from '../../../core/hooks/useOrders';
import { useOrderActions } from '../../../core/hooks/useOrderActions';
import { useReturnPayment } from '../../../core/hooks/useReturnPayment';
import { useShareLabel } from '../../../core/hooks/useShareLabel';
import { formatCurrency } from '../../../core/utils/format';
import { Theme } from '../../../core/theme';
import { ReviewModal } from '@/components/features/profile/ReviewModal';
import { ReviewCard } from '@/components/ui/ReviewCard';
import { BottomSheetModal } from '@gorhom/bottom-sheet';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['orders', 'common']);
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { shareLabel, isSharing } = useShareLabel();

  const reviewModalRef = useRef<BottomSheetModal>(null);

  // --- 1. DATA HOOKS ---
  const { data: order, isLoading, refetch } = useOrderById(id);
  const actions = useOrderActions(id as string);
  const returnPayment = useReturnPayment(order?.dispute?.id || '');

  // --- 2. LOCAL STATE ---
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeliveryConfirm, setShowDeliveryConfirm] = useState(false);

  // --- 3. COMPUTED PROPERTIES ---
  const activeTrackingNumber = order?.permissions?.showReturnTracking
    ? order?.dispute?.return_tracking_number
    : order?.permissions?.showOriginalTracking
      ? order?.tracking_number
      : null;

  // --- 4. HANDLERS ---
  const handleCopyTracking = useCallback((tracking: string) => {
    Clipboard.setString(tracking);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleTrack = useCallback((tracking: string) => {
    const baseUrl = __DEV__
      ? 'https://test.envia.com'
      : 'https://api.envia.com';
    const url = `${baseUrl}/rastreo?label=${tracking}&cntry_code=mx`;
    Linking.openURL(url).catch(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    );
  }, []);

  // --- 5. EARLY RETURNS (SKELETON) ---
  if (isLoading || !order) {
    return (
      <Box flex={1} backgroundColor="background">
        <GlobalHeader showBack />
        <Box padding="m" style={{ paddingTop: insets.top + 100 }}>
          <Skeleton width="100%" height={100} borderRadius={16} />
          <Skeleton width="100%" height={300} borderRadius={16} />
        </Box>
      </Box>
    );
  }

  const cardStyles = {
    backgroundColor: 'cardBackground' as const,
    padding: 'm' as const,
    borderRadius: 'l' as const,
    marginBottom: 'm' as const,
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader
        title={`${t('orders:detail.orderId')} #${order.id.slice(0, 8).toUpperCase()}`}
        showBack
      />

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + 80,
          paddingBottom: 40,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={theme.colors.primary}
          />
        }
      >
        <ScreenHeader
          title={t('orders:detail.title')}
          subtitle={t('orders:detail.subTitle')}
        />

        {/* SLOT A: ACCIONES CRÍTICAS (Escudo Selene / Banners) */}
        <OrderActionCard
          order={order}
          returnPayment={returnPayment}
          onRefresh={refetch}
          shareLabel={shareLabel}
          isSharing={isSharing}
        />

        {/* SLOT B: ADVERTENCIA DE UNBOXING (Solo Comprador en flujo normal) */}
        {order.permissions.showUnboxingWarning && (
          <Box
            {...cardStyles}
            borderColor="error"
            backgroundColor="warning"
            flexDirection="row"
            alignItems="center"
            gap="m"
            borderWidth={1}
          >
            <MaterialCommunityIcons
              name="alert-outline"
              size={24}
              color={theme.colors.primary}
            />
            <Box flex={1}>
              <Text variant="body-md" fontWeight="bold" color="primary">
                {t('orders:detail.videoWarningTitle')}
              </Text>
              <Text variant="caption-md" color="textPrimary" marginTop="xs">
                {t('orders:detail.videoWarningMsg')}
              </Text>
            </Box>
          </Box>
        )}

        {/* SLOT C: STEPPER DE PROGRESO (Virtualizado para Disputas) */}
        <Box {...cardStyles}>
          <Text variant="header-xl" color="primary" marginBottom="m">
            {t('orders:detail.trackTitle')}
          </Text>
          <OrderStepper status={order.visualStatus} />
        </Box>

        {/* SLOT D: RASTREO LOGÍSTICO */}
        {!!activeTrackingNumber && (
          <Box {...cardStyles} borderColor="primary" borderWidth={1}>
            <Text variant="header-xl" color="primary" marginBottom="m">
              {order.permissions.showReturnTracking
                ? 'Rastreo de Retorno'
                : t('orders:detail.trackingTitle')}
            </Text>
            <Box
              flexDirection="row"
              justifyContent="space-between"
              alignItems="center"
              backgroundColor="background"
              padding="m"
              borderRadius="m"
            >
              <Box flex={1}>
                <Text variant="caption-md" color="textSecondary">
                  {t('orders:detail.trackingProvider')}
                </Text>
                <Text variant="body-lg" style={{ letterSpacing: 1 }}>
                  {activeTrackingNumber}
                </Text>
              </Box>
              <TouchableOpacity
                onPress={() => handleCopyTracking(activeTrackingNumber)}
              >
                <MaterialCommunityIcons
                  name="content-copy"
                  size={24}
                  color={theme.colors.primary}
                />
              </TouchableOpacity>
            </Box>
            <PrimaryButton
              variant="outline"
              onPress={() => handleTrack(activeTrackingNumber)}
              style={{ marginTop: 16, borderColor: theme.colors.primary }}
              icon="truck-delivery"
            >
              {t('orders:actions.trackOrder')}
            </PrimaryButton>
          </Box>
        )}

        {/* SLOT E: INSTRUCCIONES DE ENVÍO */}
        {order.permissions.showInstructions && (
          <Box marginBottom="m">
            <ShippingInstructions carrierName="Paquetexpress" />
          </Box>
        )}

        {/* SLOT F: RUTA LOGÍSTICA (Nuevo Componente) */}
        <ShippingRouteCard order={order} />

        {/* SLOT G: LISTADO DE PRODUCTOS */}
        <Box {...cardStyles} overflow="hidden">
          <Text variant="header-xl" color="primary" marginBottom="m">
            {order.isBuyer
              ? t('orders:detail.itemsTitlePurchased')
              : t('orders:detail.itemsTitleSold')}
          </Text>
          {order.items.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => router.push(`/product/${item.product_id}` as any)}
            >
              <Box
                padding="m"
                flexDirection="row"
                alignItems="center"
                borderBottomWidth={index === order.items.length - 1 ? 0 : 1}
                borderBottomColor="separator"
              >
                <Box
                  width={60}
                  height={60}
                  borderRadius="m"
                  overflow="hidden"
                  backgroundColor="background"
                >
                  {item.product?.images?.[0] && (
                    <AppImage
                      source={{ uri: item.product.images[0] }}
                      style={{ width: '100%', height: '100%' }}
                      contentFit="cover"
                    />
                  )}
                </Box>
                <Box flex={1} marginLeft="m">
                  <Text variant="body-md" numberOfLines={1}>
                    {item.product?.name || t('common:states.unknownProduct')}
                  </Text>
                  <Text variant="body-sm" color="primary" marginTop="xs">
                    {formatCurrency(item.price_at_purchase)}
                  </Text>
                </Box>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={theme.colors.textSecondary}
                />
              </Box>
            </TouchableOpacity>
          ))}
          <Box
            padding="m"
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Text variant="body-md" color="textSecondary">
              {t('orders:detail.total')}
            </Text>
            <Text variant="subheader-lg" color="primary">
              {formatCurrency(order.total_amount)}
            </Text>
          </Box>
        </Box>

        {/* SLOT H: ACCIONES SECUNDARIAS (Botones de Pie) */}
        <Box gap="m" marginTop="m">
          {order.isSeller && order.status === 'paid' && !order.label_url && (
            <PrimaryButton
              onPress={() =>
                router.push(`/profile/orders/prepare/${order.id}` as any)
              }
              icon="package-variant-closed"
              loading={actions.generateLabel.isLoading}
            >
              {t('orders:actions.generateLabel')}
            </PrimaryButton>
          )}
          {order.permissions.canConfirmDelivery && (
            <PrimaryButton
              onPress={() => setShowDeliveryConfirm(true)}
              loading={actions.confirmDelivery.isLoading}
              icon="check-decagram"
            >
              {t('orders:actions.confirmDelivery')}
            </PrimaryButton>
          )}
          {order.permissions.canCancel && (
            <PrimaryButton
              variant="outline"
              onPress={() => setShowCancelConfirm(true)}
              loading={actions.cancelOrder.isLoading}
              style={{ borderColor: theme.colors.error }}
              labelStyle={{ color: theme.colors.error }}
            >
              {t('orders:actions.cancelOrder')}
            </PrimaryButton>
          )}
          {order.permissions.canReport && (
            <TouchableOpacity
              onPress={() =>
                router.push(`/profile/orders/report/${order.id}` as any)
              }
              style={{ alignSelf: 'center', marginTop: 15 }}
            >
              <Text
                variant="caption-lg"
                color="textSecondary"
                style={{ textDecorationLine: 'underline' }}
              >
                {t('orders:actions.reportProblem')}
              </Text>
            </TouchableOpacity>
          )}
        </Box>
        {/* BOTÓN DE CALIFICAR / REVIEW CARD */}
        {order.review && order.review.length > 0 ? (
          <ReviewCard
            rating={order.review[0].rating}
            comment={order.review[0].comment}
            createdAt={order.review[0].created_at}
          />
        ) : order.permissions.canReview ? (
          <PrimaryButton
            onPress={() => reviewModalRef.current?.present()}
            icon="star-outline"
            variant="outline"
            style={{ borderColor: theme.colors.primary }}
          >
            CALIFICAR VENDEDOR
          </PrimaryButton>
        ) : null}
      </ScrollView>

      {/* DIÁLOGOS DE CONFIRMACIÓN */}
      <ConfirmDialog
        visible={showCancelConfirm}
        title={t('orders:dialogs.cancelTitle')}
        description={t('orders:detail.cancelDisclaimer')}
        onConfirm={async () => {
          await actions.cancelOrder.execute({});
          setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
        isDangerous
        confirmLabel={t('orders:actions.confirmCancel')}
        loading={actions.cancelOrder.isLoading}
      />

      <ConfirmDialog
        visible={showDeliveryConfirm}
        title={t('orders:dialogs.deliveryTitle')}
        description={t('orders:dialogs.deliveryMsg')}
        onConfirm={async () => {
          await actions.confirmDelivery.execute();
          setShowDeliveryConfirm(false);
        }}
        onCancel={() => setShowDeliveryConfirm(false)}
        confirmLabel={t('orders:actions.confirmDelivery')}
        loading={actions.confirmDelivery.isLoading}
        icon="package-variant"
      />
      <ReviewModal
        ref={reviewModalRef}
        order={order}
        onSuccess={() => refetch()}
      />
    </Box>
  );
}
