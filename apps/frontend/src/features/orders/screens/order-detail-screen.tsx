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

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import {
  ScrollView,
  RefreshControl,
  Linking,
  Share,
  Clipboard,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../../shared/ui/base';
import { GlobalHeader } from '../../../shared/ui/global-header';
import { ScreenHeader } from '../../../shared/ui/screen-header';
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
import { PrimaryButton } from '../../../shared/ui/primary-button';
import { Skeleton } from '../../../shared/ui/skeleton';
import { ShipmentNotFoundState } from '../components/shipment-not-found-state';
import { ShipmentTrackingTimeline } from '../components/shipment-tracking-timeline';
import {
  useShipmentTrackingEvents,
  useShipmentTrackingUrl,
} from '../hooks/use-shipment-tracking';
import { useAuthContext } from '../../../shared/lib/auth/auth-provider';
import { useOrderById } from '../hooks/use-orders';
import { useShipmentsByOrder } from '../hooks/use-shipments';
import { useOrderActions } from '../hooks/use-order-actions';
import { useReturnPayment } from '../hooks/use-return-payment';
import { useShareLabel } from '../hooks/use-share-label';
import { Theme } from '../../../shared/theme';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { EnrichedOrder, EnrichedShipment } from '@selene/types';
import {
  canReviewProduct,
  type CanReviewProductContext,
} from '../logic/can-review-product';
import { resolveRoleAwareOrderView } from '../logic/order-view-routing';
import {
  resolveBuyerCheckoutRecoveryView,
  shouldSuppressShipmentActionsForBuyerRecovery,
} from '../logic/order-recovery-view';
import Toast from 'react-native-toast-message';
import { describeError } from '../../../shared/utils/describe-error';

// --- TIPO AUXILIAR PARA REVIEW (viene en la query de useOrderById pero no en EnrichedOrder) ---
// V2: adds product_id / shipment_id / seller_id so the review gate can match
// existing reviews per product instead of by array length (the V1 single-review
// gate that hid the button for every product once any review landed).
type ReviewData = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  product_id: string | null;
  shipment_id: string | null;
  seller_id: string;
}[];

type OrderWithReview = EnrichedOrder & { review?: ReviewData };

export function OrderDetailScreen() {
  // --- 1. PARAMS ---
  const { id, shipment_id } = useLocalSearchParams<{
    id: string;
    shipment_id?: string;
  }>();
  // Expo Router surfaces `useLocalSearchParams` values as `string | string[]`.
  // Comparing `s.id === shipment_id` against an array is always false and
  // silently falls back to `source[0]` (the PAID shipment), hiding the
  // per-product review button on the COMPLETED shipment. Normalize to a scalar
  // and use `shipmentId` everywhere downstream.
  const shipmentId = Array.isArray(shipment_id)
    ? shipment_id[0]
    : (shipment_id ?? undefined);
  const { t } = useTranslation(['orders', 'common']);
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuthContext();

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
  const orderView = useMemo(
    () =>
      order
        ? resolveRoleAwareOrderView(
            {
              id: order.id,
              buyerId: order.buyer_id,
              shipments: (shipments ?? order.shipments).map((shipment) => ({
                id: shipment.id,
                sellerId: shipment.seller_id,
              })),
            },
            session?.user.id,
            shipmentId,
          )
        : null,
    [order, session?.user.id, shipmentId, shipments],
  );

  useEffect(() => {
    if (
      !isLoading &&
      !shipmentId &&
      orderView &&
      orderView.kind !== 'unavailable'
    ) {
      router.replace(orderView.href as any);
    }
  }, [isLoading, orderView, router, shipmentId]);

  // --- 2b. HOOK COMPARTIDO ---
  const { shareLabel, isSharing } = useShareLabel();

  // --- 3. LOCAL STATE ---
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeliveryConfirm, setShowDeliveryConfirm] = useState(false);
  // V2 per-product reviews: the product the buyer tapped "Calificar producto"
  // for. Drives ReviewModal.productId so the modal scopes the review to the
  // tapped product instead of always the first item in the shipment.
  const [activeReviewProductId, setActiveReviewProductId] = useState<
    string | null
  >(null);
  // Surfaced when the review mutation's `onSuccess` refetch fails, or when the
  // refetch itself rejects. Pre-3.x the screen silently swallowed the error
  // (`onSuccess={() => refetchOrder()}`) so the buyer never learned their
  // rating was saved but the local cache was stale. The dialog offers a retry
  // that re-runs the refetch instead of forcing a full app reload.
  const [reviewError, setReviewError] = useState<string | null>(null);

  // --- 4. COMPUTED PROPERTIES ---

  /** Envío actual según `shipment_id` o el primero de la orden.
   *  - Se PREFIERE `useShipmentsByOrder` porque enriquece cada envío con
   *    `isBuyer`, `isSeller` y `permissions` calculados por envío (no a
   *    nivel orden). `order.shipments` sólo trae columnas crudas + items +
   *    dispute, por lo que se reserva como fallback transitorio (y en ese
   *    caso se toman prestados los permisos de la orden para evitar crashes). */
  const currentShipment = useMemo<EnrichedShipment | null>(() => {
    const source = shipments ?? order?.shipments;
    if (!source || source.length === 0 || !shipmentId) return null;

    const rawShipment = shipmentId
      ? source.find((s) => s.id === shipmentId)
      : source[0];

    // When a specific shipment was requested but isn't in the loaded rows yet,
    // short-circuit instead of inventing one via source[0] (which would render
    // the wrong shipment — e.g. the PAID one — and break the per-product review
    // gate that depends on currentShipment.status === 'completed').
    if (shipmentId && !rawShipment) return null;

    if (!rawShipment) return null;

    return {
      ...rawShipment,
      permissions: rawShipment.permissions ?? order?.permissions ?? {},
    } as EnrichedShipment;
  }, [order, shipments, shipmentId]);
  const trackingEvents = useShipmentTrackingEvents(currentShipment?.id);
  const trackingUrl = useShipmentTrackingUrl(currentShipment?.id);

  /** Número de rastreo activo: prioriza retorno si aplica, sino el tracking original.
   *  Los permisos se leen desde el envío actual (per-shipment) en lugar del
   *  nivel orden: si otra shipment entra en dispute, ésta aún puede mostrar
   *  su tracking original. */
  const activeTrackingNumber = useMemo<string | null>(() => {
    if (!currentShipment) return null;
    const p = currentShipment.permissions;
    if (p?.showReturnTracking)
      return currentShipment.dispute?.return_tracking_number ?? null;
    if (p?.showOriginalTracking) return currentShipment.tracking_number;
    return null;
  }, [currentShipment]);

  /** Hook de pago de retorno — depende de currentShipment (hook de arriba). */
  const returnPayment = useReturnPayment(currentShipment?.dispute?.id ?? '');

  /** Both buyer and seller may cancel a `paid` shipment; copy follows the viewer's role. */
  const isSellerCancel = currentShipment?.isSeller ?? false;

  /** Subtotal del envío actual: suma de price_at_purchase de sus items.
   *  Se usa como total mostrado al pie del listado de productos cuando hay
   *  multiples envios (cada card lista sólo los items de su shipment).
   *  En ordenes single-seller se conserva `order.total_amount` (que incluye
   *  envio/fee) para no alterar el comportamiento existente. */
  const shipmentSubtotal = useMemo(() => {
    if (!currentShipment) return 0;
    return currentShipment.items.reduce(
      (sum, i) => sum + Number(i.price_at_purchase ?? 0),
      0,
    );
  }, [currentShipment]);

  const isMultiShipment = (order?.shipments?.length ?? 0) > 1;
  // Sellers never see order.total_amount: it is the buyer's payment (all items, shipping and fees).
  const displayedTotal =
    isMultiShipment || currentShipment?.isSeller
      ? shipmentSubtotal
      : (order?.total_amount ?? 0);
  const checkoutRecoveryView = resolveBuyerCheckoutRecoveryView({
    isBuyer: order?.isBuyer ?? false,
    paymentProcessing: (
      order as
        (OrderWithReview & { payment_processing?: boolean | null }) | null
    )?.payment_processing,
    compensationState: (
      order as (OrderWithReview & { compensation_state?: string | null }) | null
    )?.compensation_state,
    orderStatus: order?.status,
  });

  // --- 5. HANDLERS ---
  const handleConfirmDelivery = async () => {
    if (!currentShipment) {
      setShowDeliveryConfirm(false);
      return;
    }

    try {
      await actions.confirmDelivery.execute({
        shipmentId: currentShipment.id,
      });
      setShowDeliveryConfirm(false);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      Toast.show({
        type: 'success',
        text1: t('orders:dialogs.deliverySuccessTitle'),
        text2: t('orders:dialogs.deliverySuccessMsg'),
      });
    } catch {
      // El hook dispara el toast de error; el diálogo queda abierto para reintentar
    }
  };

  // Only one shipment is cancelled; say so when the order has others.
  const withOtherShipmentsNote = (message: string) =>
    isMultiShipment
      ? `${message} ${t('orders:dialogs.otherShipmentsContinue')}`
      : message;

  const handleCancelOrder = async () => {
    if (!currentShipment) {
      setShowCancelConfirm(false);
      return;
    }

    try {
      await actions.cancelOrder.execute({
        shipmentId: currentShipment.id,
      });
      setShowCancelConfirm(false);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      Toast.show({
        type: 'info',
        text1: t('orders:dialogs.cancelSuccessTitle'),
        text2: withOtherShipmentsNote(
          t(
            isSellerCancel
              ? 'orders:dialogs.cancelSuccessMsgSeller'
              : 'orders:dialogs.cancelSuccessMsgBuyer',
          ),
        ),
      });
    } catch {
      // El hook dispara el toast de error; el diálogo queda abierto para reintentar
    }
  };
  const handleCopyTracking = useCallback((tracking: string) => {
    Clipboard.setString(tracking);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleOpenLabel = async () => {
    if (!currentShipment?.label_url) return;

    try {
      await Linking.openURL(currentShipment.label_url);
    } catch {
      Toast.show({
        type: 'error',
        text1: t('common:errors.generic'),
      });
    }
  };

  const handleShareLabel = async () => {
    if (!currentShipment?.label_url) return;

    try {
      await Share.share({
        title: t('orders:actions.shareTitle'),
        message: t('orders:actions.shareMessage', {
          url: currentShipment.label_url,
        }),
        url: currentShipment.label_url,
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: t('common:errors.generic'),
      });
    }
  };

  const handleTrack = useCallback((url: string) => {
    Linking.openURL(url).catch(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    );
  }, []);

  // V2 Compat: `enrichOrder` normaliza `review` para que siempre sea un array.
  // Al mover este bloque arriba del Skeleton de carga para cumplir con las reglas de React,
  // 'order' puede ser temporalmente nulo. Usamos un retorno defensivo de array vacío '[]'
  // mientras la consulta está en vuelo, asegurando que TypeScript compile y evitando crashes de nulos.

  const reviewData = useMemo<ReviewData>(() => {
    if (!order) return [];
    return (order as OrderWithReview).review ?? [];
  }, [order]);

  // V2: per-product review gate. Replaces the V1 single boolean that gated the
  // review button on whether ANY review existed on the whole order, which hid
  // the button for every product once a single review landed. The gate logic
  // lives in a pure helper (`canReviewProduct`) so it is testable without
  // rendering the React Native screen.
  // NOTA DE ARQUITECTURA: Se declara arriba del Skeleton para respetar el orden constante de Hooks.
  // Retorna 'false' preventivamente si la orden de base de datos todavía no terminó de cargar.

  const canReviewProductFn = useCallback(
    (productId: string) => {
      if (!order) return false;
      const ctx: CanReviewProductContext = {
        shipmentStatus: currentShipment?.status ?? '',
        isBuyer: order.isBuyer,
        reviews: reviewData,
      };
      return canReviewProduct(productId, ctx);
    },
    [currentShipment?.status, order?.isBuyer, reviewData],
  );

  const openReviewFor = useCallback((productId: string) => {
    setActiveReviewProductId(productId);
    reviewModalRef.current?.present();
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
          total={displayedTotal}
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
