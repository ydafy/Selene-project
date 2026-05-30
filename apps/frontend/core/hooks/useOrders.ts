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

type RawOrder = Tables<'orders'> & {
  items: (Tables<'order_items'> & { product: Tables<'products'> })[];
  dispute: Tables<'disputes'> | null;
  review:
    | {
        id: string;
        rating: number;
        comment: string | null;
        created_at: string;
      }[]
    | [];
};

type RawOrderItem = Tables<'order_items'> & {
  product: Tables<'products'>;
  order?: RawOrder;
};

type EnrichedDispute = Dispute & {
  buyer_evidence: BuyerEvidence;
  seller_evidence: SellerEvidence;
};

const enrichOrder = (
  order: RawOrder,
  userId: string,
  ignoredOrderIds?: string[],
): EnrichedOrder => {
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
  const reviewExists = order.review && order.review.length > 0;
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
    items: order.items as (Tables<'order_items'> & { product: Product })[],
    dispute,
    isBuyer,
    isSeller,
    visualStatus,
    permissions,
  } as unknown as EnrichedOrder;
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
          review:reviews(id, rating, comment, created_at)`,
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
          '*, items:order_items(*, product:products(*)), dispute:disputes(*), review:reviews(id, rating, comment, created_at)',
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
        .select('*, order:orders(*, dispute:disputes(*), review:reviews(id, rating, comment, created_at)), product:products(*)')
        .eq('seller_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const ordersMap = new Map<string, EnrichedOrder>();
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
