import type { Tables } from '@selene/types';

export function summaryAmounts(
  role: 'buyer' | 'seller',
  visibleItems: readonly Pick<Tables<'order_items'>, 'price_at_purchase'>[],
  persistedTotal: Tables<'orders'>['total_amount'],
) {
  return {
    subtotalCents: visibleItems.reduce(
      (sum, item) => sum + Math.round(Number(item.price_at_purchase) * 100),
      0,
    ),
    totalPaidCents: role === 'buyer' ? Math.round(persistedTotal * 100) : null,
  };
}

export function resolveSummaryState(input: {
  hasOrder: boolean;
  orderPending: boolean;
  orderError: boolean;
  hasShipments: boolean;
  shipmentsPending: boolean;
  shipmentsError: boolean;
}): 'loading' | 'error' | 'missing' | 'ready' {
  if (!input.hasOrder) {
    if (input.orderError) return 'error';
    return input.orderPending ? 'loading' : 'missing';
  }
  if (!input.hasShipments) {
    if (input.shipmentsError) return 'error';
    return input.shipmentsPending ? 'loading' : 'error';
  }
  return 'ready';
}
