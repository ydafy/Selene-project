import type { Shipment } from '@selene/types';

type ShipmentStatus = Shipment['status'];

export interface ShipmentConfirmationPayloadInput {
  orderId: string;
  shipmentId: string;
}

export interface ShipmentConfirmationPayload extends ShipmentConfirmationPayloadInput {
  idempotencyKey: string;
}

export interface ShipmentConfirmationFailureToast {
  title: string;
  message: string;
}

export function canConfirmShipmentDelivery(input: {
  isBuyer: boolean;
  status: ShipmentStatus;
  activeDispute: boolean;
}): boolean {
  return input.isBuyer && input.status === 'delivered' && !input.activeDispute;
}

export function buildShipmentConfirmationPayload(
  input: ShipmentConfirmationPayloadInput,
): ShipmentConfirmationPayload {
  return {
    ...input,
    idempotencyKey: `confirm_shipment_${input.shipmentId}`,
  };
}

export function resolveShipmentConfirmationFailureToast(
  error: unknown,
): ShipmentConfirmationFailureToast {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'UNKNOWN_CONFIRMATION_ERROR';

  if (message.includes('MAINTENANCE_MODE')) {
    return {
      title: 'No pudimos confirmar la entrega',
      message:
        'Estamos haciendo mantenimiento. Intenta nuevamente en unos minutos.',
    };
  }

  if (message.includes('ACTIVE_DISPUTE')) {
    return {
      title: 'No pudimos confirmar la entrega',
      message: 'Este envío tiene una disputa activa.',
    };
  }

  if (message.includes('SHIPMENT_NOT_DELIVERED')) {
    return {
      title: 'No pudimos confirmar la entrega',
      message: 'Solo puedes confirmar un envío después de que sea entregado.',
    };
  }

  return {
    title: 'No pudimos confirmar la entrega',
    message: 'Inténtalo de nuevo. Si sigue fallando, contacta soporte.',
  };
}
