export { ApiError, computeShipmentRefundAmountCents } from '../_shared/refund-basis.ts';
export type { ShipmentCancelItem } from '../_shared/refund-basis.ts';

import {
  ApiError,
  computeShipmentRefundAmountCents as computeShipmentRefundAmountCentsShared,
  type ShipmentCancelItem,
} from '../_shared/refund-basis.ts';

export interface CancelOrderRequestBody {
  orderId: string;
  shipmentId: string;
  reason: string;
}

export interface CancelShipmentRefundParamsInput {
  paymentIntentId: string;
  amountCents: number;
  orderId: string;
  shipmentId: string;
  callerRole: 'buyer' | 'seller';
  reason: string;
}

export interface ManualShipmentCancelPlanInput {
  isMaintenance: boolean;
  callerRole: 'buyer' | 'seller' | 'system' | 'admin';
  callerId: string;
  orderId: string;
  orderBuyerId: string;
  shipmentSellerId: string;
  shipmentId: string;
  shipmentOrderId: string;
  shipmentStatus: string;
  shipmentStripePaymentIntentId: string | null;
  shipmentStripeTransferId: string | null;
  shipmentItems: ShipmentCancelItem[];
  orderItems: ShipmentCancelItem[];
  orderChargeCents: number;
  remainingRefundableCents?: number | null;
  reason: string;
  onCritical?: (message: string, metadata: Record<string, unknown>) => void;
}

export interface ManualShipmentCancelPlan {
  amountCents: number;
  refundParams: ReturnType<typeof buildCancelShipmentRefundParams>;
  rpcInput: {
    p_shipment_id: string;
    p_cancelled_by_role: 'buyer' | 'seller';
    p_reason: string;
  };
}

const DEFAULT_CANCEL_REASON = 'Cancelación solicitada por el usuario';

export function parseCancelOrderRequestBody(
  body: unknown,
): CancelOrderRequestBody {
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'INVALID_CANCEL_REQUEST');
  }

  const record = body as Record<string, unknown>;
  const orderId = typeof record.orderId === 'string' ? record.orderId : '';
  const shipmentId = typeof record.shipmentId === 'string' ? record.shipmentId : '';
  const reason =
    typeof record.reason === 'string' && record.reason.trim().length > 0
      ? record.reason.trim()
      : DEFAULT_CANCEL_REASON;

  if (!orderId) {
    throw new ApiError(422, 'ORDER_ID_REQUIRED');
  }

  if (!shipmentId) {
    throw new ApiError(422, 'SHIPMENT_ID_REQUIRED');
  }

  return {
    orderId,
    shipmentId,
    reason,
  };
}

export function buildCancelShipmentRefundParams(
  input: CancelShipmentRefundParamsInput,
): {
  params: {
    payment_intent: string;
    amount: number;
    reason: 'requested_by_customer';
    metadata: {
      shipment_id: string;
      order_id: string;
      caller_role: 'buyer' | 'seller';
      reason: string;
    };
  };
  options: { idempotencyKey: string };
} {
  return {
    params: {
      payment_intent: input.paymentIntentId,
      amount: input.amountCents,
      reason: 'requested_by_customer',
      metadata: {
        shipment_id: input.shipmentId,
        order_id: input.orderId,
        caller_role: input.callerRole,
        reason: input.reason,
      },
    },
    options: {
      idempotencyKey: `cancel_shipment_${input.shipmentId}`,
    },
  };
}

export function resolveManualShipmentCancelPlan(
  input: ManualShipmentCancelPlanInput,
): ManualShipmentCancelPlan {
  if (input.isMaintenance) {
    throw new ApiError(503, 'MAINTENANCE_MODE');
  }

  if (input.callerRole !== 'buyer' && input.callerRole !== 'seller') {
    throw new ApiError(403, 'BUYER_ONLY');
  }

  if (input.callerRole === 'buyer' && input.callerId !== input.orderBuyerId) {
    throw new ApiError(403, 'ORDER_BUYER_MISMATCH');
  }

  if (input.callerRole === 'seller' && input.callerId !== input.shipmentSellerId) {
    throw new ApiError(403, 'SHIPMENT_SELLER_MISMATCH');
  }

  if (input.shipmentOrderId !== input.orderId) {
    throw new ApiError(422, 'SHIPMENT_ORDER_MISMATCH');
  }

  if (input.shipmentStatus !== 'paid') {
    throw new ApiError(422, 'SHIPMENT_NOT_CANCELABLE');
  }

  if (input.shipmentStripeTransferId) {
    input.onCritical?.('CRITICAL_TRANSFER_BLOCKED', {
      orderId: input.orderId,
      shipmentId: input.shipmentId,
      stripeTransferId: input.shipmentStripeTransferId,
    });
    throw new ApiError(409, 'STRIPE_TRANSFER_ALREADY_RELEASED');
  }

  if (!input.shipmentStripePaymentIntentId) {
    throw new ApiError(500, 'PAYMENT_INTENT_NOT_FOUND');
  }

  const amountCents = computeShipmentRefundAmountCentsShared({
    shipmentItems: input.shipmentItems,
    orderItems: input.orderItems,
    orderChargeCents: input.orderChargeCents,
    remainingRefundableCents: input.remainingRefundableCents,
  });

  const refundParams = buildCancelShipmentRefundParams({
    paymentIntentId: input.shipmentStripePaymentIntentId,
    amountCents,
    orderId: input.orderId,
    shipmentId: input.shipmentId,
    callerRole: input.callerRole,
    reason: input.reason,
  });

  return {
    amountCents,
    refundParams,
    rpcInput: {
      p_shipment_id: input.shipmentId,
      p_cancelled_by_role: input.callerRole,
      p_reason: input.reason,
    },
  };
}
