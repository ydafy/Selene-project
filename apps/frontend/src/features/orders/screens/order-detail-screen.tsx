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

import React from 'react';
import { ScrollView, RefreshControl, Linking } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '@/shared/ui/base';
import { GlobalHeader } from '@/shared/ui/layout/global-header';
import { ScreenHeader } from '@/shared/ui/layout/screen-header';
import { OrderActionCard } from '../components/order-action-card';
import { OrderStepper } from '../components/order-stepper';
import { MultiSellerBanner } from '../components/multi-seller-banner';
import { UnboxingWarning } from '../components/unboxing-warning';
import { TrackingNumberCard } from '../components/tracking-number-card';
import { cardStyles } from '../components/order-card-styles';
import { ShippingInstructions } from '../components/shipping-instructions';
import { ShippingRouteCard } from '../components/shipping-route-card';
import { ShipmentItemsCard } from '../components/shipment-items-card';
import { OrderDetailActions } from '../components/order-detail-actions';
import { OrderDetailDialogs } from '../components/order-detail-dialogs';
import { ReviewProductButtons } from '../components/review-product-buttons';
import { PrimaryButton } from '@/shared/ui/button/primary-button';
import { Skeleton } from '@/shared/ui/feedback/skeleton';
import { ShipmentNotFoundState } from '../components/shipment-not-found-state';
import { ShipmentTrackingTimeline } from '../components/shipment-tracking-timeline';
import { useOrderDetail, type ReviewData } from '../hooks/use-order-detail';
import { useOrderDetailActions } from '../hooks/use-order-detail-actions';
import { Theme } from '@/shared/theme';
import { shouldSuppressShipmentActionsForBuyerRecovery } from '../logic/order-recovery-view';
import { describeError } from '@/shared/utils/describe-error';

export function OrderDetailScreen() {
  const { t } = useTranslation(['orders', 'common']);
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // --- 1. DATA ---
  const {
    shipmentId,
    order,
    actions,
    isLoading,
    orderView,
    checkoutRecoveryView,
    currentShipment,
    trackingEvents,
    trackingUrl,
    activeTrackingNumber,
    returnPayment,
    shareLabel,
    isSharing,
    isSellerCancel,
    isMultiShipment,
    displayedTotalCents,
    reviewData,
    canReviewProductFn,
    openReviewFor,
    reviewModalRef,
    activeReviewProductId,
    setReviewError,
    reviewError,
    refetchOrder,
    handleRefresh,
  } = useOrderDetail();

  // --- 2. HANDLERS ---
  const {
    showCancelConfirm,
    setShowCancelConfirm,
    showDeliveryConfirm,
    setShowDeliveryConfirm,
    withOtherShipmentsNote,
    handleConfirmDelivery,
    handleCancelOrder,
    handleCopyTracking,
    handleOpenLabel,
    handleShareLabel,
    handleTrack,
  } = useOrderDetailActions({
    actions,
    currentShipment,
    isMultiShipment,
    isSellerCancel,
    t,
  });

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

  if (shouldSuppressShipmentActionsForBuyerRecovery(checkoutRecoveryView)) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader showBack />
        <Box padding="m" style={{ paddingTop: insets.top + 100 }}>
          <Box backgroundColor="cardBackground" padding="m" borderRadius="l">
            <Text variant="header-xl" color="primary" marginBottom="s">
              {checkoutRecoveryView.kind === 'refunded'
                ? t('recovery.confirmed')
                : t('recovery.pending')}
            </Text>
            {checkoutRecoveryView.kind === 'pending_refund' && (
              <PrimaryButton
                variant="outline"
                onPress={() => Linking.openURL('mailto:support@selene.mx')}
                icon="help-circle-outline"
              >
                {t('recovery.contactSupport')}
              </PrimaryButton>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  if (!orderView) return null;

  if (!shipmentId && orderView.kind !== 'unavailable') {
    return null;
  }

  if (!shipmentId || orderView.kind === 'unavailable' || !currentShipment) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader showBack />
        <ShipmentNotFoundState
          onBack={() => router.replace('/profile/orders')}
        />
      </Box>
    );
  }

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
          subtitle={
            order.isSeller
              ? t('orders:detail.subTitleSeller')
              : t('orders:detail.subTitle')
          }
        />

        {/* ─────────────────────────────────────────────── */}
        {/* BANNER MULTI-VENDEDOR                           */}
        {/* Solo cuando hay más de un shipment y no hay     */}
        {/* shipment_id en la URL (vista global).           */}
        {/* ─────────────────────────────────────────────── */}
        {order.shipments && order.shipments.length > 1 && !shipmentId && (
          <MultiSellerBanner
            shipments={order.shipments}
            onViewShipment={(id) => router.setParams({ shipment_id: id })}
            onViewSummary={() =>
              router.push(`/profile/orders/summary/${order.id}` as any)
            }
          />
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
        {currentShipment.permissions.showUnboxingWarning && <UnboxingWarning />}

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT C: STEPPER DE PROGRESO                      */}
        {/* Virtualizado para disputas (visualStatus).      */}
        {/* ─────────────────────────────────────────────── */}
        <Box {...cardStyles}>
          <Text variant="header-xl" color="primary" marginBottom="m">
            {t('orders:detail.trackTitle')}
          </Text>
          {/* El stepper refleja el progreso logístico del envío actual (per-shipment). */}
          <OrderStepper
            status={currentShipment.status ?? order.visualStatus}
            isSeller={order.isSeller}
          />
        </Box>

        {currentShipment && (
          <Box {...cardStyles}>
            <Text variant="header-xl" color="primary" marginBottom="m">
              {t('orders:tracking.title')}
            </Text>
            <ShipmentTrackingTimeline
              events={trackingEvents.data ?? []}
              isLoading={trackingEvents.isLoading}
              error={trackingEvents.error}
            />
          </Box>
        )}

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT D: RASTREO LOGÍSTICO                        */}
        {/* Lee desde currentShipment (tracking original o  */}
        {/* return_tracking_number según permisos).         */}
        {/* ─────────────────────────────────────────────── */}
        {!!activeTrackingNumber && (
          <TrackingNumberCard
            trackingNumber={activeTrackingNumber}
            isReturn={!!currentShipment.permissions.showReturnTracking}
            trackingUrl={trackingUrl.data?.url ?? undefined}
            onCopy={handleCopyTracking}
            onTrack={handleTrack}
          />
        )}

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT E: INSTRUCCIONES DE ENVÍO                   */}
        {/* Controlado por permissions.showInstructions     */}
        {/* ─────────────────────────────────────────────── */}
        {currentShipment.permissions.showInstructions && (
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
        <ShipmentItemsCard
          items={currentShipment.items}
          isBuyer={order.isBuyer}
          isSeller={currentShipment.isSeller}
          totalCents={displayedTotalCents}
          isReviewed={(productId) =>
            reviewData.some(
              (r: ReviewData[number]) => r.product_id === productId,
            )
          }
          onOpenProduct={(productId) =>
            router.push(`/product/${productId}` as any)
          }
        />

        {/* ─────────────────────────────────────────────── */}
        {/* SLOT H: ACCIONES SECUNDARIAS                     */}
        {/* Botones de pie: generar guía, confirmar entrega, */}
        {/* cancelar, reportar problema.                    */}
        {/* ─────────────────────────────────────────────── */}
        <OrderDetailActions
          shipment={currentShipment}
          isGeneratingLabel={actions.generateLabel.isLoading}
          isConfirmingDelivery={actions.confirmDelivery.isLoading}
          isCancelling={actions.cancelOrder.isLoading}
          onGenerateLabel={() =>
            router.push(
              `/profile/orders/prepare/${order.id}?shipment_id=${currentShipment.id}` as any,
            )
          }
          onOpenLabel={handleOpenLabel}
          onShareLabel={handleShareLabel}
          onConfirmDelivery={() => setShowDeliveryConfirm(true)}
          onCancel={() => setShowCancelConfirm(true)}
          onReport={() =>
            router.push(
              `/profile/orders/report/${order.id}?shipment_id=${currentShipment.id}` as any,
            )
          }
        />

        {/* ─────────────────────────────────────────────── */}
        {/* V2: REVIEWS */}
        <ReviewProductButtons
          items={currentShipment.items}
          canReview={canReviewProductFn}
          onRate={openReviewFor}
        />
      </ScrollView>

      {/* ─────────────────────────────────────────────── */}
      {/* DIÁLOGOS DE CONFIRMACIÓN                         */}
      {/* ─────────────────────────────────────────────── */}
      <OrderDetailDialogs
        order={order as any}
        shipment={currentShipment}
        cancelVisible={showCancelConfirm}
        cancelDescription={withOtherShipmentsNote(
          t(
            isSellerCancel
              ? 'orders:dialogs.cancelMsgSeller'
              : 'orders:dialogs.cancelMsgBuyer',
          ),
        )}
        isCancelling={actions.cancelOrder.isLoading}
        onConfirmCancel={handleCancelOrder}
        onDismissCancel={() => setShowCancelConfirm(false)}
        deliveryVisible={showDeliveryConfirm}
        isConfirmingDelivery={actions.confirmDelivery.isLoading}
        onConfirmDelivery={handleConfirmDelivery}
        onDismissDelivery={() => setShowDeliveryConfirm(false)}
        reviewModalRef={reviewModalRef}
        activeReviewProductId={activeReviewProductId}
        onReviewSuccess={async () => {
          try {
            await refetchOrder();
          } catch (e) {
            console.error('[review] refresh failed', describeError(e));
            setReviewError(t('orders:dialogs.reviewErrorMsg'));
          }
        }}
        reviewError={reviewError}
        onRetryReview={async () => {
          setReviewError(null);
          await refetchOrder();
        }}
        onDismissReviewError={() => setReviewError(null)}
      />
    </Box>
  );
}
