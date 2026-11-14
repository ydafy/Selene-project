import type { Tables } from '@selene/types';

export function summaryAmounts(
  role: 'buyer' | 'seller',
  visibleItems: readonly Pick<
    Tables<'order_items'>,
    'price_at_purchase_cents'
  >[],
  persistedTotalCents: Tables<'orders'>['total_amount_cents'],
) {
  return {
    subtotalCents: visibleItems.reduce(
      (sum, item) => sum + item.price_at_purchase_cents,
      0,
    ),
    totalPaidCents: role === 'buyer' ? persistedTotalCents : null,
  };
}

/** Amount shown on an orders list card: buyers see what they paid, sellers only their own items. */
export function orderCardAmountCents(
  role: 'buyer' | 'seller',
  visibleItems: readonly Pick<
    Tables<'order_items'>,
    'price_at_purchase_cents'
  >[],
  persistedTotalCents: Tables<'orders'>['total_amount_cents'],
): number {
  const amounts = summaryAmounts(role, visibleItems, persistedTotalCents);
  return amounts.totalPaidCents ?? amounts.subtotalCents;
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
