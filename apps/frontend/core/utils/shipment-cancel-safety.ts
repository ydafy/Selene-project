import type { Shipment } from '@selene/types';

export const DEFAULT_CANCEL_ORDER_REASON =
  'Cancelación solicitada por el usuario';

type ShipmentStatus = Shipment['status'];

export interface CancelOrderPayloadInput {
  orderId: string;
  shipmentId: string;
  reason?: string | null;
}

export interface CancelOrderPayload {
  orderId: string;
  shipmentId: string;
  reason: string;
}

export type CancelErrorGroup =
  | 'maintenance'
  | 'session'
  | 'notAllowed'
  | 'notCancelable'
  | 'busy'
  | 'inProgress'
  | 'review'
  | 'needsSupport'
  | 'generic';

export interface CancelOrderFailureToast {
  titleKey: string;
  messageKey: string;
}

export interface ShipmentPreparingWindowCopyInput {
  isBuyer: boolean;
  isSeller: boolean;
  timeLeft: string;
  isExpired?: boolean;
}

export function canBuyerCancelShipment(input: {
  isBuyer: boolean;
  status: ShipmentStatus;
}): boolean {
  return canCancelShipment({
    isBuyer: input.isBuyer,
    isSeller: false,
    status: input.status,
  });
}

export function canCancelShipment(input: {
  isBuyer: boolean;
  isSeller: boolean;
  status: ShipmentStatus;
}): boolean {
  return (input.isBuyer || input.isSeller) && input.status === 'paid';
}

export function normalizeCancelOrderReason(reason?: string | null): string {
  const trimmed = reason?.trim();
  return trimmed?.length ? trimmed : DEFAULT_CANCEL_ORDER_REASON;
}

export function buildCancelOrderPayload(
  input: CancelOrderPayloadInput,
): CancelOrderPayload {
  return {
    orderId: input.orderId,
    shipmentId: input.shipmentId,
    reason: normalizeCancelOrderReason(input.reason),
  };
}

// What the user can do about each cancel-order error. Unlisted codes fall back
// to `generic`; codes after a refund may exist never ask for a blind retry.
const CANCEL_ERROR_GROUPS: Record<string, CancelErrorGroup> = {
  MAINTENANCE_MODE: 'maintenance',
  AUTH_REQUIRED: 'session',
  // Older text answered by cancel-order before it used AUTH_REQUIRED (#15).
  'No autorizado': 'session',
  UNAUTHORIZED: 'notAllowed',
  BUYER_ONLY: 'notAllowed',
  ORDER_BUYER_MISMATCH: 'notAllowed',
  SHIPMENT_SELLER_MISMATCH: 'notAllowed',
  SHIPMENT_ORDER_MISMATCH: 'notAllowed',
  ORDER_NOT_FOUND: 'notAllowed',
  SHIPMENT_NOT_CANCELABLE: 'notCancelable',
  CANCELLATION_BUSY: 'busy',
  CANCELLATION_CLAIM_FAILED: 'busy',
  CANCELLATION_START_FAILED: 'busy',
  CANCELLATION_REFUND_UNCONFIRMED: 'inProgress',
  CANCELLATION_REFUND_PROVIDER_FAILED: 'inProgress',
  CANCELLATION_REFUND_RECORD_FAILED: 'inProgress',
  CANCELLATION_REFUND_RECORD_INVALID: 'inProgress',
  CANCELLATION_REFUND_LOOKUP_FAILED: 'inProgress',
  CANCELLATION_RECOVERY_UNAVAILABLE: 'inProgress',
  CANCELLATION_ESCALATION_FAILED: 'inProgress',
  CANCELLATION_RECOVERY_REQUIRED: 'review',
  CANCELLATION_CARRIER_PENDING: 'review',
  STRIPE_TRANSFER_ALREADY_RELEASED: 'needsSupport',
  REFUND_AMOUNT_EXCEEDS_CAP: 'needsSupport',
};

// cancel-order answers this sentence when the refund succeeded but the
// shipment update failed.
const REFUNDED_BUT_NOT_UPDATED_PREFIX = 'Dinero devuelto';

export function resolveCancelOrderFailureToast(
  error: unknown,
): CancelOrderFailureToast {
  const message = (
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  ).trim();

  const group: CancelErrorGroup = message.startsWith(
    REFUNDED_BUT_NOT_UPDATED_PREFIX,
  )
    ? 'inProgress'
    : (CANCEL_ERROR_GROUPS[message] ?? 'generic');

  return {
    titleKey: `orders:cancelErrors.${group}.title`,
    messageKey: `orders:cancelErrors.${group}.message`,
  };
}

export interface ShipmentPreparingWindowMessage {
  key: string;
  params: { timeLeft?: string };
}

export function resolveShipmentPreparingWindowMessage(
  input: ShipmentPreparingWindowCopyInput,
): ShipmentPreparingWindowMessage {
  if (input.isExpired) {
    return {
      key: input.isSeller
        ? 'orders:actionCard.carrierScanWindowClosed'
        : 'orders:actionCard.sellerShippingWindowClosed',
      params: {},
    };
  }

  const params = { timeLeft: input.timeLeft };

  if (input.isBuyer) {
    return { key: 'orders:actionCard.preparingWindowBuyer', params };
  }

  if (input.isSeller) {
    return { key: 'orders:actionCard.preparingWindowSeller', params };
  }

  return { key: 'orders:actionCard.preparingWindowOther', params };
}
