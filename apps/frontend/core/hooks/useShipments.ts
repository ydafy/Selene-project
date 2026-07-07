/**
 * @file core/hooks/useShipments.ts
 * Fetch, enrich, and compute shipment-level permissions.
 * Replaces the shipment logic previously inside useOrders.ts's enrichOrder.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import {
  EnrichedShipment,
  Dispute,
  BuyerEvidence,
  SellerEvidence,
  Tables,
  Product,
} from '@selene/types';
import { useAuthContext } from '../../components/auth/AuthProvider';

const DISPUTE_WINDOW_MS = 48 * 60 * 60 * 1000;

type RawShipment = Tables<'shipments'> & {
  items: (Tables<'order_items'> & { product: Tables<'products'> })[];
  dispute: Tables<'disputes'> | null;
  seller: Tables<'profiles'> | null;
  order: { buyer_id: string } | null;
};

type EnrichedDispute = Dispute & {
  buyer_evidence: BuyerEvidence;
  seller_evidence: SellerEvidence;
};

const enrichShipment = (
  shipment: RawShipment,
  userId: string,
  buyerId: string,
): EnrichedShipment => {
  const dispute = shipment.dispute as EnrichedDispute | null;
  const isBuyer = buyerId === userId;
  const isSeller = shipment.seller_id === userId;

  const isDispute = !!dispute;

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
    isInTransit: isDispute && dispute?.status === 'return_shipped',
    isDelivered: isDispute && dispute?.status === 'return_delivered',
  };

  const now = Date.now();
  const deliveredAt = shipment.delivered_at
    ? new Date(shipment.delivered_at).getTime()
    : 0;
  const isWithinDisputeWindow =
    shipment.status === 'delivered' && now - deliveredAt < DISPUTE_WINDOW_MS;

  const permissions = {
    canCancel: shipment.status === 'paid',
    canReport:
      isBuyer &&
      !['dispute', 'cancelled', 'refunded', 'completed'].includes(
        shipment.status,
      ) &&
      (shipment.status === 'shipped' || isWithinDisputeWindow),
    showSellerDeliveredBanner:
      isSeller && shipment.status === 'delivered' && !isDispute,
    canConfirmDelivery:
      isBuyer && ['shipped', 'delivered'].includes(shipment.status) && !isDispute,
    canPayReturn: isSeller && phase.isWaitingPayment,
    canUploadReturnEvidence: isBuyer && phase.isWaitingShipment,
    showDisputeBanner: phase.isOpen,
    showReturnBanner: isDispute && !phase.isOpen,
    canGenerateReturnLabel: isBuyer && phase.isWaitingShipment,
    showInstructions:
      (isSeller &&
        shipment.label_url &&
        ['paid', 'preparing'].includes(shipment.status)) ||
      (isBuyer && phase.isWaitingShipment),
    showUnboxingWarning:
      isBuyer &&
      ['paid', 'preparing', 'shipped', 'delivered'].includes(
        shipment.status,
      ) &&
      !isDispute,
    showReturnTracking: !!dispute?.return_tracking_number,
    showOriginalTracking: !!shipment.tracking_number && !isDispute,
    canReview:
      shipment.status === 'completed' && isBuyer && !shipment.dispute,
  };

  return {
    ...shipment,
    items: shipment.items as (Tables<'order_items'> & { product: Product })[],
    dispute,
    isBuyer,
    isSeller,
    permissions,
  } as EnrichedShipment;
};

export const useShipmentsByOrder = (orderId: string | undefined) => {
  const { session } = useAuthContext();
  const userId = session?.user.id || '';

  const query = useQuery({
    queryKey: ['shipments', orderId, userId],
    queryFn: async () => {
      if (!orderId) throw new Error('Order ID required');

      // Single query: embed buyer_id via nested join (same pattern as useShipmentById)
      const { data, error } = await supabase
        .from('shipments')
        .select(
          `*,
          items:order_items(*, product:products(*)),
          dispute:disputes(*),
          seller:profiles!shipments_seller_id_fkey(*),
          order:orders(buyer_id)`,
        )
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const typedData = data as unknown as (RawShipment)[];
      const buyerId = typedData[0]?.order?.buyer_id || '';
      return { shipments: typedData, buyerId };
    },
    enabled: !!orderId && !!userId,
  });

  const enrichedData = useMemo(() => {
    if (!query.data) return null;
    const { shipments, buyerId } = query.data;

    return shipments.map((s) => enrichShipment(s, userId, buyerId));
  }, [query.data, userId]);

  return { ...query, data: enrichedData };
};

export const useShipmentById = (shipmentId: string | undefined) => {
  const { session } = useAuthContext();
  const userId = session?.user.id || '';

  const query = useQuery({
    queryKey: ['shipment', shipmentId],
    queryFn: async () => {
      if (!shipmentId) throw new Error('Shipment ID required');

      const { data, error } = await supabase
        .from('shipments')
        .select(
          `*,
          items:order_items(*, product:products(*)),
          dispute:disputes(*),
          seller:profiles!shipments_seller_id_fkey(*),
          order:orders(buyer_id)`,
        )
        .eq('id', shipmentId)
        .single();

      if (error) throw error;
      return data as unknown as RawShipment & { order: { buyer_id: string } };
    },
    enabled: !!shipmentId && !!userId,
  });

  const enrichedData = useMemo(() => {
    if (!query.data) return null;
    const raw = query.data;
    const buyerId = raw.order?.buyer_id || '';
    const { order: _order, ...shipment } = raw;
    return enrichShipment(shipment as RawShipment, userId, buyerId);
  }, [query.data, userId]);

  return { ...query, data: enrichedData };
};
