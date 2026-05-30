/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @file app/profile/orders/[id].tsx
 * @description Pantalla orquestadora del detalle de una orden.
 * Centraliza la visualización de estados, logística, productos y acciones críticas.
 * Adaptada para el modelo multi-envío (shipments) v3.1+.
 * Aplica el patrón de "Slots" delegando la lógica compleja a componentes especializados.
 *
 * NOTA DE MIGRACIÓN 3.3: La screen opera sobre `currentShipment` (EnrichedShipment)
 * en lugar de propiedades directas de la orden. OrderActionCard conectado en 3.6.
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
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
import { OrderActionCard } from '../../../components/features/orders/OrderActionCard';
import { OrderStepper } from '../../../components/features/orders/OrderStepper';
import { ShippingInstructions } from '../../../components/features/orders/ShippingInstructions';
import { ShippingRouteCard } from '../../../components/features/orders/ShippingRouteCard';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Skeleton } from '../../../components/ui/Skeleton';
import { AppImage } from '../../../components/ui/AppImage';
import { useOrderById } from '../../../core/hooks/useOrders';
import { useShipmentsByOrder } from '../../../core/hooks/useShipments';
import { useOrderActions } from '../../../core/hooks/useOrderActions';
import { useReturnPayment } from '../../../core/hooks/useReturnPayment';
import { useShareLabel } from '../../../core/hooks/useShareLabel';
import { formatCurrency } from '../../../core/utils/format';
import { Theme } from '../../../core/theme';
import { ReviewModal } from '@/components/features/profile/ReviewModal';
import { ReviewCard } from '@/components/ui/ReviewCard';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { EnrichedOrder, EnrichedShipment } from '@selene/types';

// --- TIPO AUXILIAR PARA REVIEW (viene en la query de useOrderById pero no en EnrichedOrder) ---
type ReviewData = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}[];

type OrderWithReview = EnrichedOrder & { review?: ReviewData };

export default function OrderDetailScreen() {
  // --- 1. PARAMS ---
  const { id, shipment_id } = useLocalSearchParams<{
    id: string;
    shipment_id?: string;
  }>();
  const { t } = useTranslation(['orders', 'common']);
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const reviewModalRef = useRef<BottomSheetModal>(null);

  // --- 2. DATA HOOKS ---
  const {
    data: order,
    isLoading: isOrderLoading,
    refetch: refetchOrder,
  } = useOrderById(id);
  const {
    data: shipments,
    isLoading: isShipmentsLoading,
    refetch: refetchShipments,
  } = useShipmentsByOrder(id);
  const actions = useOrderActions(id as string);

  // Combinamos refresco: orden + shipments
  const handleRefresh = async () => {
    await Promise.all([refetchOrder(), refetchShipments()]);
  };
  const isLoading = isOrderLoading || isShipmentsLoading;

  // --- 2b. HOOK COMPARTIDO ---
  const { shareLabel, isSharing } = useShareLabel();

  // --- 3. LOCAL STATE ---
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeliveryConfirm, setShowDeliveryConfirm] = useState(false);

  // --- 4. COMPUTED PROPERTIES ---

  /** Envío actual según `shipment_id` o el primero de la orden.
   *  - Si el hook `useOrderById` aún no puebla `order.shipments`,
   *    se usa `useShipmentsByOrder` como fallback (task 3.8 unificará). */
  const currentShipment = useMemo<EnrichedShipment | null>(() => {
    const source = order?.shipments ?? shipments;
    if (!source || source.length === 0) return null;
    if (shipment_id)
      return source.find((s) => s.id === shipment_id) ?? source[0];
    return source[0];
  }, [order, shipments, shipment_id]);

  /** Número de rastreo activo: prioriza retorno si aplica, sino el tracking original. */
  const activeTrackingNumber = useMemo<string | null>(() => {
    if (!currentShipment) return null;
    const p = currentShipment.permissions;
    if (p.showReturnTracking)
      return currentShipment.dispute?.return_tracking_number ?? null;
    if (p.showOriginalTracking) return currentShipment.tracking_number;
    return null;
  }, [currentShipment]);

  /** Hook de pago de retorno — depende de currentShipment (hook de arriba). */
  const returnPayment = useReturnPayment(
    currentShipment?.dispute?.id ?? '',
  );

  // --- 5. HANDLERS ---
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

  // --- 6. EARLY RETURN (SKELETON) ---
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

  // --- REVIEW DATA (seguro: order no es null acá) ---
  const orderWithReview = order as OrderWithReview;
  const reviewData = orderWithReview.review;
  const canReview =
    order.status === 'completed' && order.isBuyer && !reviewData?.length;

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
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        <ScreenHeader
          title={t('orders:detail.title')}
          subtitle={t('orders:detail.subTitle')}
        />

        {/* ─────────────────────────────────────────────── */}
        {/* BANNER MULTI-VENDEDOR                           */}
        {/* Solo cuando hay más de un shipment y no hay     */}
        {/* shipment_id en la URL (vista global).           */}
        {/* ─────────────────────────────────────────────── */}
        {order.shipments && order.shipments.length > 1 && !shipment_id && (
          <Box
            backgroundColor="cardBackground"
            padding="m"
            borderRadius="l"
            borderWidth={1}
            borderColor="primary"
            marginBottom="m"
          >
            <Box
              flexDirection="row"
              alignItems="center"
              gap="m"
              marginBottom="m"
            >
              <MaterialCommunityIcons
                name="account-group"
                size={24}
                color={theme.colors.primary}
              />
              <Box flex={1}>
                <Text variant="body-md" fontWeight="bold" color="primary">
                  {t('orders:detail.multiSellerTitle', {
                    count: order.shipments.length,
                    defaultValue: `Esta orden tiene ${order.shipments.length} vendedores`,
                  })}
                </Text>
              </Box>
            </Box>

            {order.shipments.map((shipment) => (
              <Box
                key={shipment.id}
                flexDirection="row"
                alignItems="center"
                paddingVertical="s"
                borderBottomWidth={1}
                borderBottomColor="separator"
              >
                <Box flex={1}>
                  <Text variant="body-sm" color="textPrimary">
                    {shipment.items.length}{' '}
                    {t('orders:detail.items', {
                      count: shipment.items.length,
                      defaultValue: 'producto(s)',
                    })}
                  </Text>
                  <Text variant="caption-md" color="textSecondary">
                    {t(`orders:status.${shipment.status}`)}
                  </Text>
                </Box>
                <TouchableOpacity
                  onPress={() =>
                    router.setParams({ shipment_id: shipment.id })
                  }
                >
                  <Text
                    variant="caption-md"
                    color="primary"
                    textDecorationLine="underline"
                  >
                    {t('orders:detail.viewShipment', {
                      defaultValue: 'Ver envío',
                    })}
                  </Text>
                </TouchableOpacity>
              </Box>
            ))}

            <PrimaryButton
              variant="outline"
              onPress={() =>
                router.push(`/profile/orders/summary/${order.id}` as any)
              }
              style={{ marginTop: 12, borderColor: theme.colors.primary }}
              icon="truck-delivery-outline"
            >
              {t('orders:detail.viewShippingSummary', {
                defaultValue: 'Ver resumen de envíos',
              })}
            </PrimaryButton>
          </Box>
        )}

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT A: BANNER DE ESTADO CRÍTICO                 */}
        {/* OrderActionCard con shipment actual.            */}
        {/* ─────────────────────────────────────────────── */}
        {currentShipment && (
          <OrderActionCard
            order={order}
            shipment={currentShipment}
            returnPayment={returnPayment}
            onRefresh={refetchOrder}
            shareLabel={shareLabel}
            isSharing={isSharing}
          />
        )}

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT B: ADVERTENCIA DE UNBOXING                  */}
        {/* Solo para comprador en flujo normal (sin disputa)*/}
        {/* ─────────────────────────────────────────────── */}
        {currentShipment?.permissions.showUnboxingWarning && (
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

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT C: STEPPER DE PROGRESO                      */}
        {/* Virtualizado para disputas (visualStatus).      */}
        {/* ─────────────────────────────────────────────── */}
        <Box {...cardStyles}>
          <Text variant="header-xl" color="primary" marginBottom="m">
            {t('orders:detail.trackTitle')}
          </Text>
          <OrderStepper status={order.visualStatus} />
        </Box>

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT D: RASTREO LOGÍSTICO                        */}
        {/* Lee desde currentShipment (tracking original o  */}
        {/* return_tracking_number según permisos).         */}
        {/* ─────────────────────────────────────────────── */}
        {!!activeTrackingNumber && (
          <Box {...cardStyles} borderColor="primary" borderWidth={1}>
            <Text variant="header-xl" color="primary" marginBottom="m">
              {currentShipment?.permissions.showReturnTracking
                ? t('orders:detail.returnTrackingTitle', {
                    defaultValue: 'Rastreo de Retorno',
                  })
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

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT E: INSTRUCCIONES DE ENVÍO                   */}
        {/* Controlado por permissions.showInstructions     */}
        {/* ─────────────────────────────────────────────── */}
        {currentShipment?.permissions.showInstructions && (
          <Box marginBottom="m">
            <ShippingInstructions
              carrierName="Paquetexpress"
              labelUrl={currentShipment.label_url ?? undefined}
              orderId={order.id}
            />
          </Box>
        )}

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT F: RUTA LOGÍSTICA — origin_address ahora viene del shipment */}
        {currentShipment && (
          <ShippingRouteCard
            shipment={currentShipment}
            shippingAddress={order.shipping_address as any}
            orderStatus={order.status}
          />
        )}

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT G: LISTADO DE PRODUCTOS                     */}
        {/* Lee items desde currentShipment en lugar de      */}
        {/* order.items (que fue removido de EnrichedOrder).*/}
        {/* ─────────────────────────────────────────────── */}
        <Box {...cardStyles} overflow="hidden">
          <Text variant="header-xl" color="primary" marginBottom="m">
            {order.isBuyer
              ? t('orders:detail.itemsTitlePurchased')
              : t('orders:detail.itemsTitleSold')}
          </Text>
          {currentShipment?.items.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => router.push(`/product/${item.product_id}` as any)}
            >
              <Box
                padding="m"
                flexDirection="row"
                alignItems="center"
                borderBottomWidth={
                  index === currentShipment.items.length - 1 ? 0 : 1
                }
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
          )) ?? (
            <Text variant="body-md" color="textSecondary" padding="m">
              {t('orders:detail.noItems', {
                defaultValue: 'No hay productos disponibles.',
              })}
            </Text>
          )}
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

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT H: ACCIONES SECUNDARIAS                     */}
        {/* Botones de pie: generar guía, confirmar entrega, */}
        {/* cancelar, reportar problema.                    */}
        {/* ─────────────────────────────────────────────── */}
        <Box gap="m" marginTop="m">
          {order.isSeller &&
            currentShipment?.status === 'paid' &&
            !currentShipment?.label_url && (
              <PrimaryButton
                onPress={() =>
                  router.push(
                    `/profile/orders/prepare/${order.id}?shipment_id=${currentShipment.id}` as any,
                  )
                }
                icon="package-variant-closed"
                loading={actions.generateLabel.isLoading}
              >
                {t('orders:actions.generateLabel')}
              </PrimaryButton>
            )}
          {currentShipment?.permissions.canConfirmDelivery && (
            <PrimaryButton
              onPress={() => setShowDeliveryConfirm(true)}
              loading={actions.confirmDelivery.isLoading}
              icon="check-decagram"
            >
              {t('orders:actions.confirmDelivery')}
            </PrimaryButton>
          )}
          {currentShipment?.permissions.canCancel && (
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
          {currentShipment?.permissions.canReport && (
            <TouchableOpacity
              onPress={() =>
                router.push(
                  `/profile/orders/report/${order.id}?shipment_id=${currentShipment.id}` as any,
                )
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

        {/* ─────────────────────────────────────────────── */}
        {/* SECCIÓN DE CALIFICACIÓN (Review)                 */}
        {/* Muestra ReviewCard si ya calificó, o botón si   */}
        {/* puede calificar. canReview se deriva inline.    */}
        {/* ─────────────────────────────────────────────── */}
        {reviewData && reviewData.length > 0 ? (
          <ReviewCard
            rating={reviewData[0].rating}
            comment={reviewData[0].comment}
            createdAt={reviewData[0].created_at}
          />
        ) : canReview ? (
          <PrimaryButton
            onPress={() => reviewModalRef.current?.present()}
            icon="star-outline"
            variant="outline"
            style={{ borderColor: theme.colors.primary }}
          >
            {t('orders:actions.rateSeller', {
              defaultValue: 'CALIFICAR VENDEDOR',
            })}
          </PrimaryButton>
        ) : null}
      </ScrollView>

      {/* ─────────────────────────────────────────────── */}
      {/* DIÁLOGOS DE CONFIRMACIÓN                         */}
      {/* ─────────────────────────────────────────────── */}
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
          await actions.confirmDelivery.execute({
            shipmentId: currentShipment?.id,
          });
          setShowDeliveryConfirm(false);
        }}
        onCancel={() => setShowDeliveryConfirm(false)}
        confirmLabel={t('orders:actions.confirmDelivery')}
        loading={actions.confirmDelivery.isLoading}
        icon="package-variant"
      />

      <ReviewModal
        ref={reviewModalRef}
        order={order as any}
        onSuccess={() => refetchOrder()}
      />
    </Box>
  );
}
