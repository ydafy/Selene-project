export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ShipmentCancelItem {
  price_at_purchase: number;
  shipping_amount: number | null;
  shipment_id?: string | null;
}

export interface ShipmentRefundBasisInput {
  shipmentItems: ShipmentCancelItem[];
  orderItems: ShipmentCancelItem[];
  orderChargeCents: number;
  remainingRefundableCents?: number | null;
}

export function computeShipmentRefundAmountCents(
  input: ShipmentRefundBasisInput,
): number {
  const shipmentSubtotalCents = Math.round(
    input.shipmentItems.reduce((sum, item) => sum + item.price_at_purchase, 0) *
      100,
  );
  const orderSubtotalCents = Math.round(
    input.orderItems.reduce((sum, item) => sum + item.price_at_purchase, 0) *
      100,
  );

  if (shipmentSubtotalCents <= 0 || orderSubtotalCents <= 0) {
    throw new ApiError(422, 'SHIPMENT_REFUND_AMOUNT_INVALID');
  }

  if (shipmentSubtotalCents > orderSubtotalCents) {
    throw new ApiError(422, 'SHIPMENT_REFUND_AMOUNT_INVALID');
  }

  if (input.orderChargeCents <= 0 || input.orderChargeCents < orderSubtotalCents) {
    throw new ApiError(422, 'ORDER_CHARGE_AMOUNT_INVALID');
  }

  const buyerFeeCents = input.orderChargeCents - orderSubtotalCents;
  const proportionalBuyerFeeCents = Math.round(
    (buyerFeeCents * shipmentSubtotalCents) / orderSubtotalCents,
  );
  const refundCents = shipmentSubtotalCents + proportionalBuyerFeeCents;
  const refundableCapCents =
    input.remainingRefundableCents ?? input.orderChargeCents;

  if (refundCents <= 0) {
    throw new ApiError(422, 'SHIPMENT_REFUND_AMOUNT_INVALID');
  }

  if (refundCents > refundableCapCents) {
    throw new ApiError(422, 'REFUND_AMOUNT_EXCEEDS_CAP');
  }

  return refundCents;
}
