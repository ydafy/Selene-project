export interface OrderViewShipment {
  id: string;
  sellerId: string;
}

export interface OrderViewOrder {
  id: string;
  buyerId: string;
  shipments: OrderViewShipment[];
}

export type OrderView =
  | {
      kind: 'summary';
      role: 'buyer' | 'seller';
      visibleShipmentIds: string[];
      href: string;
    }
  | {
      kind: 'detail';
      role: 'buyer' | 'seller';
      visibleShipmentIds: [string];
      shipmentId: string;
      href: string;
    }
  | {
      kind: 'unavailable';
      role: 'buyer' | 'none' | 'seller';
      visibleShipmentIds: [];
    };

const detailHref = (orderId: string, shipmentId: string) =>
  `/profile/orders/${orderId}?shipment_id=${shipmentId}`;

export const resolveRoleAwareOrderView = (
  order: OrderViewOrder,
  viewerId: string | null | undefined,
  requestedShipmentId?: string,
): OrderView => {
  if (!viewerId || order.shipments.length === 0) {
    return { kind: 'unavailable', role: 'none', visibleShipmentIds: [] };
  }

  const role = viewerId === order.buyerId ? 'buyer' : 'seller';
  const visibleShipmentIds =
    role === 'buyer'
      ? order.shipments.map((shipment) => shipment.id)
      : order.shipments
          .filter((shipment) => shipment.sellerId === viewerId)
          .map((shipment) => shipment.id);

  if (visibleShipmentIds.length === 0) {
    return {
      kind: 'unavailable',
      role: 'none',
      visibleShipmentIds: [],
    };
  }

  if (requestedShipmentId) {
    if (!visibleShipmentIds.includes(requestedShipmentId)) {
      return {
        kind: 'unavailable',
        role,
        visibleShipmentIds: [],
      };
    }

    return {
      kind: 'detail',
      role,
      visibleShipmentIds: [requestedShipmentId],
      shipmentId: requestedShipmentId,
      href: detailHref(order.id, requestedShipmentId),
    };
  }

  if (visibleShipmentIds.length > 1) {
    return {
      kind: 'summary',
      role,
      visibleShipmentIds,
      href: `/profile/orders/summary/${order.id}`,
    };
  }

  const [shipmentId] = visibleShipmentIds;
  return {
    kind: 'detail',
    role,
    visibleShipmentIds: [shipmentId],
    shipmentId,
    href: detailHref(order.id, shipmentId),
  };
};
