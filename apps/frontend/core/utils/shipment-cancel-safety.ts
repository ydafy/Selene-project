import type { Shipment } from '@selene/types';

export const DEFAULT_CANCEL_ORDER_REASON = 'Cancelación solicitada por el usuario';

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

export interface CancelOrderFailureToast {
  title: string;
  message: string;
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

export function resolveCancelOrderFailureToast(
  error: unknown,
): CancelOrderFailureToast {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'UNKNOWN_CANCEL_ERROR';

  if (message.includes('MAINTENANCE_MODE')) {
    return {
      title: 'No pudimos cancelar el envío',
      message:
        'Estamos haciendo mantenimiento. Intenta nuevamente en unos minutos.',
    };
  }

  if (message.includes('SHIPMENT_NOT_CANCELABLE')) {
    return {
      title: 'Este envío no se puede cancelar',
      message:
        'Si ya fue enviado, usa soporte o disputa para continuar el caso.',
    };
  }

  if (message.includes('REFUND_AMOUNT_EXCEEDS_CAP')) {
    return {
      title: 'No pudimos cancelar el envío',
      message:
        'La devolución calculada supera el monto disponible para reembolso.',
    };
  }

  if (message.includes('STRIPE_TRANSFER_ALREADY_RELEASED')) {
    return {
      title: 'No pudimos cancelar el envío',
      message:
        'Ese envío ya liberó fondos. Contacta soporte para continuar.',
    };
  }

  return {
    title: 'No pudimos cancelar el envío',
    message: 'Inténtalo de nuevo. Si sigue fallando, contacta soporte.',
  };
}

export function resolveShipmentPreparingWindowMessage(
  input: ShipmentPreparingWindowCopyInput,
): string {
  if (input.isExpired) {
    return input.isSeller
      ? 'Your carrier scan window has closed.'
      : 'The seller\'s shipping window has closed.';
  }

  if (input.isBuyer) {
    return `The seller has ${input.timeLeft} to ship it. If it does not ship in time, the shipment auto-cancels and your refund is triggered.`;
  }

  if (input.isSeller) {
    return `You have ${input.timeLeft} to get a carrier scan. If it does not happen, the shipment auto-cancels.`;
  }

  return `The seller has ${input.timeLeft} before the shipment is locked for auto-cancel.`;
}
