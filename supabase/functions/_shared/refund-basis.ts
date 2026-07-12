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

export interface CancellationLossWeightInput {
  shipmentId: string;
  refundCents: number;
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

  if (
    input.orderChargeCents <= 0 ||
    input.orderChargeCents < orderSubtotalCents
  ) {
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

export function allocateCancellationLossCents(
  actualStripeFeeCents: number | null,
  shipments: CancellationLossWeightInput[],
): Map<string, number> | null {
  if (actualStripeFeeCents === null) {
    return null;
  }

  if (
    !Number.isFinite(actualStripeFeeCents) ||
    !Number.isInteger(actualStripeFeeCents) ||
    actualStripeFeeCents < 0
  ) {
    throw new ApiError(422, 'ACTUAL_STRIPE_FEE_INVALID');
  }

  if (!Array.isArray(shipments) || shipments.length === 0) {
    throw new ApiError(422, 'CANCELLATION_LOSS_SHIPMENTS_REQUIRED');
  }

  const normalized = shipments.map((shipment) => {
    if (
      !shipment ||
      typeof shipment.shipmentId !== 'string' ||
      shipment.shipmentId.length === 0 ||
      !Number.isFinite(shipment.refundCents) ||
      !Number.isInteger(shipment.refundCents) ||
      shipment.refundCents < 0
    ) {
      throw new ApiError(422, 'CANCELLATION_LOSS_INPUT_INVALID');
    }

    return shipment;
  });

  const totalRefundCents = normalized.reduce(
    (sum, shipment) => sum + shipment.refundCents,
    0,
  );

  if (totalRefundCents <= 0) {
    throw new ApiError(422, 'CANCELLATION_LOSS_INPUT_INVALID');
  }

  const allocations = normalized.map((shipment) => {
    const exact =
      (actualStripeFeeCents * shipment.refundCents) / totalRefundCents;
    const base = Math.floor(exact);
    return {
      shipmentId: shipment.shipmentId,
      amount: base,
      remainder: exact - base,
    };
  });

  let allocated = allocations.reduce((sum, entry) => sum + entry.amount, 0);
  let remaining = actualStripeFeeCents - allocated;

  const ranked = [...allocations].sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    return left.shipmentId < right.shipmentId
      ? -1
      : left.shipmentId > right.shipmentId
        ? 1
        : 0;
  });

  for (const entry of ranked) {
    if (remaining <= 0) {
      break;
    }
    entry.amount += 1;
    remaining -= 1;
  }

  return new Map(allocations.map((entry) => [entry.shipmentId, entry.amount]));
}
