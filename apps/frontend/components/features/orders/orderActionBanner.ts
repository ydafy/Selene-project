import type { Enums, Tables } from '@selene/types';

export type OrderBannerKind = 'cancelledShipment' | 'dispute' | 'refunded' | 'orderStatus';

// A cancelled shipment keeps its own banner whatever the order status is:
// another seller's dispute or refund says nothing about this shipment.
export const resolveOrderBannerKind = ({
  orderStatus,
  shipmentStatus,
}: {
  orderStatus: Enums<'order_status_enum'> | null;
  shipmentStatus: Tables<'shipments'>['status'];
}): OrderBannerKind => {
  if (shipmentStatus === 'cancelled') return 'cancelledShipment';
  if (orderStatus === 'dispute') return 'dispute';
  if (orderStatus === 'refunded') return 'refunded';
  return 'orderStatus';
};
