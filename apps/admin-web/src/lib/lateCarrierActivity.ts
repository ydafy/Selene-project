/**
 * Contract of the admin late-carrier-activity Edge Functions (`list-shipment-late-carrier-activity`,
 * `acknowledge-shipment-late-carrier-activity`): cancellations whose shipment saw carrier activity
 * after the cancellation refund started. Acknowledging only records that an admin looked at the
 * package; it never changes the shipment, the order or any refund. Responses are validated at the
 * boundary: one unusable row fails the whole response, so the UI never shows partial data.
 */

export const EVENT_TYPES = ['created', 'information', 'in_transit', 'delivered', 'exception', 'returned'] as const;
export type CarrierEventType = (typeof EVENT_TYPES)[number];

export const SHIPMENT_STATUSES = [
  'pending',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'dispute',
  'refunded',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const CANCELLATION_SOURCES = ['buyer', 'seller', 'paid_timeout', 'preparing_timeout'] as const;
export type CancellationSource = (typeof CANCELLATION_SOURCES)[number];

export const REFUND_STATUSES = ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export interface LateCarrierActivity {
  shipmentId: string;
  orderId: string;
  sellerId: string;
  trackingNumber: string | null;
  carrier: string | null;
  shipmentStatus: ShipmentStatus;
  source: CancellationSource;
  /** Null when the refund state is unknown. */
  refundStatus: RefundStatus | null;
  /** When the carrier activity was recorded, after the refund had started. */
  activityAt: string;
  eventType: CarrierEventType;
}

export interface AcknowledgementResult {
  acknowledgedAt: string;
  note: string;
  /** True when another acknowledgement already existed; the stored one is returned unchanged. */
  alreadyAcknowledged: boolean;
}

export const EVENT_TYPE_LABELS: Record<CarrierEventType, string> = {
  created: 'Guía creada',
  information: 'Actualización de información',
  in_transit: 'En tránsito',
  delivered: 'Entregado',
  exception: 'Incidencia',
  returned: 'Devuelto',
};

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagado',
  preparing: 'En preparación',
  shipped: 'Enviado',
  delivered: 'Entregado',
  completed: 'Completado',
  cancelled: 'Cancelado',
  dispute: 'En disputa',
  refunded: 'Reembolsado',
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: 'En proceso',
  requires_action: 'Requiere acción',
  succeeded: 'Reembolsado',
  failed: 'Falló',
  canceled: 'Cancelado',
};

/** Same rule as the server: trimmed, 1 to 200 characters. */
export const MAX_ACKNOWLEDGEMENT_NOTE_LENGTH = 200;

export class MalformedLateCarrierActivityResponseError extends Error {
  constructor(what: string) {
    super(`Malformed ${what} response`);
    this.name = 'MalformedLateCarrierActivityResponseError';
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const nullableText = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' ? value : undefined;

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.find((candidate) => candidate === value);

function toActivity(value: unknown): LateCarrierActivity | null {
  const row = asRecord(value);
  if (!row) return null;
  const shipmentId = text(row.shipment_id);
  const orderId = text(row.order_id);
  const sellerId = text(row.seller_id);
  const trackingNumber = nullableText(row.tracking_number);
  const carrier = nullableText(row.carrier);
  const shipmentStatus = oneOf(SHIPMENT_STATUSES, row.shipment_status);
  const source = oneOf(CANCELLATION_SOURCES, row.source);
  const refundStatus = row.refund_status === null ? null : oneOf(REFUND_STATUSES, row.refund_status);
  const eventType = oneOf(EVENT_TYPES, row.late_carrier_activity_event_type);
  const activityAt = text(row.late_carrier_activity_at);
  if (
    !shipmentId || !orderId || !sellerId || trackingNumber === undefined || carrier === undefined ||
    !shipmentStatus || !source || refundStatus === undefined || !eventType || !activityAt ||
    Number.isNaN(Date.parse(activityAt))
  ) {
    return null;
  }
  return {
    shipmentId, orderId, sellerId, trackingNumber, carrier, shipmentStatus, source, refundStatus, activityAt, eventType,
  };
}

export function parseLateCarrierActivity(payload: unknown): LateCarrierActivity[] {
  const rows = asRecord(payload)?.late_carrier_activity;
  if (!Array.isArray(rows)) throw new MalformedLateCarrierActivityResponseError('late carrier activity');
  const cases = rows.map(toActivity);
  if (cases.some((item) => item === null)) throw new MalformedLateCarrierActivityResponseError('late carrier activity');
  return cases as LateCarrierActivity[];
}

export function parseAcknowledgement(payload: unknown): AcknowledgementResult {
  const result = asRecord(payload);
  const acknowledgedAt = text(result?.acknowledged_at);
  if (
    !result || !acknowledgedAt || Number.isNaN(Date.parse(acknowledgedAt)) ||
    typeof result.acknowledged_note !== 'string' || typeof result.already_acknowledged !== 'boolean'
  ) {
    throw new MalformedLateCarrierActivityResponseError('late carrier activity acknowledgement');
  }
  return {
    acknowledgedAt,
    note: result.acknowledged_note,
    alreadyAcknowledged: result.already_acknowledged,
  };
}

/** The trimmed note, or null when it is empty or over the server limit. */
export function normalizeAcknowledgementNote(input: string): string | null {
  const note = input.trim();
  return note === '' || note.length > MAX_ACKNOWLEDGEMENT_NOTE_LENGTH ? null : note;
}

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  ADMIN_ONLY: 'Tu cuenta no tiene permisos de administrador activos para esta acción.',
  SHIPMENT_NOT_FOUND: 'No encontramos este envío. Actualiza la lista.',
  LATE_CARRIER_ACTIVITY_NOT_FOUND: 'Este caso ya no está en la lista. Actualiza la lista.',
  INVALID_ACKNOWLEDGEMENT_NOTE: `Escribe una nota de entre 1 y ${MAX_ACKNOWLEDGEMENT_NOTE_LENGTH} caracteres.`,
  INVALID_SHIPMENT_ID: 'El envío no es válido. Actualiza la página e intenta de nuevo.',
};
const GENERIC_ERROR_MESSAGE = 'No se pudo marcar el caso como revisado. Intenta de nuevo.';

export function resolveLateCarrierActivityErrorMessage(code: string | null): string {
  return (code && ERROR_MESSAGES[code]) || GENERIC_ERROR_MESSAGE;
}
