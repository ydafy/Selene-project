import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { EnrichedOrder, EnrichedShipment } from '@selene/types';
import { useAuthContext } from '@/shared/lib/auth/auth-provider';
import {
  useShipmentTrackingEvents,
  useShipmentTrackingUrl,
} from './use-shipment-tracking';
import { useOrderById } from './use-orders';
import { useShipmentsByOrder } from './use-shipments';
import { useOrderActions } from './use-order-actions';
import { useReturnPayment } from './use-return-payment';
import { useShareLabel } from './use-share-label';
import {
  canReviewProduct,
  type CanReviewProductContext,
} from '../logic/can-review-product';
import { resolveRoleAwareOrderView } from '../logic/order-view-routing';
import { resolveBuyerCheckoutRecoveryView } from '../logic/order-recovery-view';

// --- TIPO AUXILIAR PARA REVIEW (viene en la query de useOrderById pero no en EnrichedOrder) ---
// V2: adds product_id / shipment_id / seller_id so the review gate can match
// existing reviews per product instead of by array length (the V1 single-review
// gate that hid the button for every product once any review landed).
export type ReviewData = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  product_id: string | null;
  shipment_id: string | null;
  seller_id: string;
}[];

type OrderWithReview = EnrichedOrder & { review?: ReviewData };

export function useOrderDetail() {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the resolver returns a plain string href that typed routes reject
      router.replace(orderView.href as any);
    }
  }, [isLoading, orderView, router, shipmentId]);

  // --- 2b. HOOK COMPARTIDO ---
  const { shareLabel, isSharing } = useShareLabel();

  // --- 3. LOCAL STATE ---
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

  return {
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
    displayedTotal,
    reviewData,
    canReviewProductFn,
    openReviewFor,
    reviewModalRef,
    activeReviewProductId,
    reviewError,
    setReviewError,
    refetchOrder,
    handleRefresh,
  };
}
