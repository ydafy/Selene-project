const REFUNDABLE_SHIPMENT_STATUSES = ['shipped', 'delivered'];

/** Error code when the shipment cannot be refunded, or null when it can. */
export function refundBlockedReason(
  shipmentStatus: string | null | undefined,
): string | null {
  if (shipmentStatus && REFUNDABLE_SHIPMENT_STATUSES.includes(shipmentStatus)) {
    return null;
  }
  return `SHIPMENT_NOT_REFUNDABLE:${shipmentStatus ?? 'unknown'}`;
}

/**
 * Error code when there is no Stripe payment intent to refund (no shipment, or a
 * shipment without one), or null when there is. Every shipment created today is
 * a Connect shipment; a dispute without one needs manual intervention.
 */
export function refundIntentBlockedReason(
  paymentIntentId: string | null | undefined,
): string | null {
  return paymentIntentId ? null : 'SHIPMENT_WITHOUT_PAYMENT_INTENT';
}

/** Stripe refund id, or null when the refund was already made earlier. */
export function extractRefundId(
  refund: { id?: string } | null | undefined,
): string | null {
  return refund?.id ?? null;
}
