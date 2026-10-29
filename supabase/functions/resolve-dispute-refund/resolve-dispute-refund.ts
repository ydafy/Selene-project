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

/** Stripe refund id, or null when the refund was already made earlier. */
export function extractRefundId(
  refund: { id?: string } | null | undefined,
): string | null {
  return refund?.id ?? null;
}
