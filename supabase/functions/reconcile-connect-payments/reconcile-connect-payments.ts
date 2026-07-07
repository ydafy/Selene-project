export interface ReconcilePaymentIntentLike {
  status: string;
  metadata: Record<string, string | undefined>;
  localShipmentStatus: string | null;
}

export function shouldReconcilePaymentIntent(intent: ReconcilePaymentIntentLike) {
  return (
    intent.status === 'succeeded' &&
    intent.localShipmentStatus === 'draft' &&
    Boolean(intent.metadata.seller_id) &&
    Boolean(intent.metadata.order_id) &&
    Boolean(intent.metadata.shipment_id)
  );
}
