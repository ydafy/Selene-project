/**
 * @file core/hooks/useOrders.ts
 * Lógica de enriquecimiento de órdenes sincronizada con Edge Functions y 4 fases de disputa.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import {
  EnrichedOrder,
  OrderStatus,
  Dispute,
  BuyerEvidence,
  SellerEvidence,
  Tables,
  Product,
} from '@selene/types';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useReviewStore } from '../store/useReviewStore';

const DISPUTE_WINDOW_MS = 48 * 60 * 60 * 1000;

type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  product_id: string | null;
  shipment_id: string | null;
  seller_id: string;
};

type RawOrder = Tables<'orders'> & {
  // These fields arrive after the paid-checkout-recovery migration is applied.
  // They remain optional until the maintainer regenerates database types.
  compensation_state?: string | null;
  payment_processing?: boolean | null;
  items: (Tables<'order_items'> & { product: Tables<'products'> })[];
  dispute: Tables<'disputes'> | null;
  // PostgREST returns `review` as a SINGLE object when the FK is detected as
  // 1:1 (exactly one review row matches) and as an ARRAY for 0 or 2+ rows.
  // The TypeScript types declare it always an array — they lie. The runtime
  // union is handled by `normalizeReview` in `enrichOrder` so every consumer
  // downstream can rely on `review` always being an array.
  review: ReviewRow[] | ReviewRow | null;
};

type RawOrderItem = Tables<'order_items'> & {
  product: Tables<'products'>;
  order?: RawOrder;
};

type EnrichedDispute = Dispute & {
  buyer_evidence: BuyerEvidence;
  seller_evidence: SellerEvidence;
};

export interface CompatEnrichedOrder extends EnrichedOrder {
  items: (Tables<'order_items'> & { product: Product })[];
  dispute: EnrichedDispute | null;
  permissions: {
    canCancel: boolean;
    canReport: boolean;
    showSellerDeliveredBanner: boolean;
    canConfirmDelivery: boolean;
    canPayReturn: boolean;
    canUploadReturnEvidence: boolean;
    showDisputeBanner: boolean;
    showReturnBanner: boolean;
    canGenerateReturnLabel: boolean;
    showInstructions: boolean;
    showUnboxingWarning: boolean;
    showReturnTracking: boolean;
    showOriginalTracking: boolean;
    canReview: boolean;
  };
}

const enrichOrder = (
  order: RawOrder,
  userId: string,
  ignoredOrderIds?: string[],
): CompatEnrichedOrder => {
  const dispute = order.dispute as EnrichedDispute | null;
  const isBuyer = order.buyer_id === userId;
  const isSeller =
    order.items?.some((i: RawOrderItem) => i.seller_id === userId) || false;

  const isDispute = order.status === 'dispute' && !!dispute;

  const phase = {
    isOpen: isDispute && dispute?.status === 'open',
    isWaitingPayment:
      isDispute &&
      dispute?.status === 'waiting_return' &&
      dispute?.return_payout_status === 'pending',
    isWaitingShipment:
      isDispute &&
      dispute?.status === 'waiting_return' &&
      dispute?.return_payout_status === 'paid' &&
      !dispute?.return_tracking_number,
    isPreparing:
      isDispute &&
      dispute?.status === 'waiting_return' &&
      !!dispute?.return_tracking_number,
    isDelivered: isDispute && dispute?.status === 'return_delivered',
  };

  let visualStatus: OrderStatus = order.status;
  if (isDispute) {
    if (phase.isDelivered) visualStatus = 'delivered';
    else if (dispute?.return_payout_status === 'paid')
      visualStatus = 'preparing';
  }

  const now = Date.now();
  const deliveredAt = order.delivered_at
    ? new Date(order.delivered_at).getTime()
    : 0;
  const isWithinDisputeWindow =
    order.status === 'delivered' && now - deliveredAt < DISPUTE_WINDOW_MS;
  // Normalize `review` to always be an array — PostgREST returns a single
  // object when the FK is detected as 1:1 instead of 1:many, and an array
  // (possibly empty) otherwise. Doing this at the source means no consumer
  // needs defensive `Array.isArray` / `?? []` checks further down.
  const normalizedReview: ReviewRow[] = Array.isArray(order.review)
    ? order.review
    : order.review
      ? [order.review]
      : [];
  const reviewExists = normalizedReview.length > 0;
  const isIgnored = ignoredOrderIds?.includes(order.id) ?? false;

  const permissions = {
    canCancel: order.status === 'paid',
    canReport:
      isBuyer &&
      !['dispute', 'cancelled', 'refunded', 'completed'].includes(
        order.status,
      ) &&
      (order.status === 'shipped' || isWithinDisputeWindow),
    showSellerDeliveredBanner:
      isSeller && order.status === 'delivered' && !isDispute,
    canConfirmDelivery:
      isBuyer && ['shipped', 'delivered'].includes(order.status) && !isDispute,
    canPayReturn: isSeller && phase.isWaitingPayment,
    canUploadReturnEvidence: isBuyer && phase.isWaitingShipment,
    showDisputeBanner: phase.isOpen,
    showReturnBanner: isDispute && !phase.isOpen,
    canGenerateReturnLabel: isBuyer && phase.isWaitingShipment,
    showInstructions:
      (isSeller && ['paid', 'preparing'].includes(order.status)) ||
      (isBuyer && phase.isWaitingShipment),
    showUnboxingWarning:
      isBuyer &&
      ['paid', 'preparing', 'shipped', 'delivered'].includes(order.status) &&
      !isDispute,
    showReturnTracking: !!dispute?.return_tracking_number,
    showOriginalTracking: !isDispute,
    canReview:
      order.status === 'completed' &&
      isBuyer &&
      !order.dispute &&
      !reviewExists &&
      !isIgnored,
  };

  return {
    ...order,
    review: normalizedReview,
    items: order.items as (Tables<'order_items'> & { product: Product })[],
    dispute,
    isBuyer,
    isSeller,
    visualStatus,
    permissions,
  } as unknown as CompatEnrichedOrder;
};

export const useOrderById = (orderId: string | undefined) => {
  const { session } = useAuthContext();
  const userId = session?.user.id || '';
  const ignoredOrderIds = useReviewStore((s) => s.ignoredOrderIds);
  const query = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => {
      if (!orderId) throw new Error('Order ID required');
      const { data, error } = await supabase
        .from('orders')
        .select(
          `*,
          items:order_items(*, product:products(*)),
          dispute:disputes(*),
          shipments:shipments(*, items:order_items(*, product:products(*)), dispute:disputes(*)),
          review:reviews(id, rating, comment, created_at, product_id, shipment_id, seller_id)`,
        )
        .eq('id', orderId)
        .single();

      if (error) throw error;
      return data as unknown as RawOrder;
    },
    enabled: !!orderId && !!userId,
  });

  const enrichedData = useMemo(
    () =>
      query.data ? enrichOrder(query.data, userId, ignoredOrderIds) : null,
    [query.data, userId, ignoredOrderIds],
  );
  return { ...query, data: enrichedData };
};

export const useMyPurchases = (userId: string | undefined) => {
  const ignoredOrderIds = useReviewStore((s) => s.ignoredOrderIds);
  return useQuery({
    queryKey: ['my-purchases', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('orders')
        .select(
          '*, items:order_items(*, product:products(*)), dispute:disputes(*), shipments:shipments(*, items:order_items(*, product:products(*)), dispute:disputes(*)), review:reviews(id, rating, comment, created_at, product_id, shipment_id, seller_id)',
        )
        .eq('buyer_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as RawOrder[]).map((o) =>
        enrichOrder(o, userId, ignoredOrderIds),
      );
    },
    enabled: !!userId,
  });
};

export const useMySales = (userId: string | undefined) => {
  const ignoredOrderIds = useReviewStore((s) => s.ignoredOrderIds);
  return useQuery({
    queryKey: ['my-sales', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('order_items')
        .select(
          '*, order:orders(*, dispute:disputes(*), shipments:shipments(*, items:order_items(*, product:products(*)), dispute:disputes(*)), review:reviews(id, rating, comment, created_at)), product:products(*)',
        )
        .eq('seller_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const ordersMap = new Map<string, CompatEnrichedOrder>();
      (data as unknown as RawOrderItem[]).forEach((item) => {
        if (!item.order) return;
        if (!ordersMap.has(item.order.id)) {
          const enriched = enrichOrder(item.order, userId, ignoredOrderIds);
          enriched.items = [];
          ordersMap.set(item.order.id, enriched);
        }
        const itemData = { ...item };
        delete itemData.order;
        ordersMap.get(item.order.id)!.items.push(itemData);
      });
      return Array.from(ordersMap.values());
    },
    enabled: !!userId,
  });
};
