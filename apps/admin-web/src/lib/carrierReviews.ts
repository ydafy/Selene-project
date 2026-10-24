/**
 * Contract of the admin carrier-review Edge Functions (`list-shipment-operation-reviews`,
 * `resolve-shipment-operation-review`). Responses are validated at the boundary: one unusable
 * row fails the whole response, so the UI never shows partial money data.
 */

export const REVIEW_REASONS = ['tracking_unknown', 'carrier_refused', 'carrier_ambiguous'] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REVIEW_RESOLUTIONS = ['refund_approved', 'closed_no_refund'] as const;
export type ReviewResolution = (typeof REVIEW_RESOLUTIONS)[number];

export interface CarrierReview {
  shipmentId: string;
  orderId: string;
  sellerId: string;
  trackingNumber: string | null;
  carrier: string | null;
  /** Integer cents the label cost Selene; null when unknown. */
  labelCostCents: number | null;
  reason: ReviewReason;
  carrierOutcome: string | null;
  /** When the review was opened; the admin has been owed a decision since then. */
  requiredAt: string;
}

export interface ResolveReviewResult {
  resolution: ReviewResolution;
  resolvedAt: string;
  note: string;
  /** Integer cents of label cost absorbed by Selene; null when unknown or none. */
  labelCostLossCents: number | null;
}

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  tracking_unknown: 'No pudimos confirmar el tracking',
  carrier_refused: 'El carrier rechazó la cancelación',
  carrier_ambiguous: 'El carrier no dio una respuesta clara',
};

/** Same rule as the server: trimmed, 1 to 500 characters. */
export const MAX_REVIEW_NOTE_LENGTH = 500;

export class MalformedCarrierReviewResponseError extends Error {
  constructor(what: string) {
    super(`Malformed ${what} response`);
    this.name = 'MalformedCarrierReviewResponseError';
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

const nullableCents = (value: unknown): number | null | undefined =>
  value === null
    ? null
    : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : undefined;

function toReview(value: unknown): CarrierReview | null {
  const row = asRecord(value);
  if (!row) return null;
  const shipmentId = text(row.shipment_id);
  const orderId = text(row.order_id);
  const sellerId = text(row.seller_id);
  const trackingNumber = nullableText(row.tracking_number);
  const carrier = nullableText(row.carrier);
  const labelCostCents = nullableCents(row.label_provider_cost_cents);
  const reason = REVIEW_REASONS.find((candidate) => candidate === row.review_reason);
  const carrierOutcome = nullableText(row.carrier_cancellation_outcome);
  const requiredAt = text(row.review_required_at);
  if (
    !shipmentId || !orderId || !sellerId || trackingNumber === undefined || carrier === undefined ||
    labelCostCents === undefined || !reason || carrierOutcome === undefined || !requiredAt ||
    Number.isNaN(Date.parse(requiredAt))
  ) {
    return null;
  }
  return {
    shipmentId, orderId, sellerId, trackingNumber, carrier, labelCostCents, reason, carrierOutcome, requiredAt,
  };
}

export function parseCarrierReviews(payload: unknown): CarrierReview[] {
  const rows = asRecord(payload)?.reviews;
  if (!Array.isArray(rows)) throw new MalformedCarrierReviewResponseError('carrier reviews');
  const reviews = rows.map(toReview);
  if (reviews.some((review) => review === null)) throw new MalformedCarrierReviewResponseError('carrier reviews');
  return reviews as CarrierReview[];
}

export function parseResolveReviewResult(payload: unknown): ResolveReviewResult {
  const result = asRecord(payload);
  const resolution = REVIEW_RESOLUTIONS.find((candidate) => candidate === result?.review_resolution);
  const resolvedAt = text(result?.review_resolved_at);
  const labelCostLossCents = nullableCents(result?.label_cost_loss_cents);
  if (
    !result || !resolution || !resolvedAt || Number.isNaN(Date.parse(resolvedAt)) ||
    typeof result.review_resolution_note !== 'string' || labelCostLossCents === undefined
  ) {
    throw new MalformedCarrierReviewResponseError('carrier review resolution');
  }
  return { resolution, resolvedAt, note: result.review_resolution_note, labelCostLossCents };
}

/** The trimmed note, or null when it is empty or over the server limit. */
export function normalizeReviewNote(input: string): string | null {
  const note = input.trim();
  return note === '' || note.length > MAX_REVIEW_NOTE_LENGTH ? null : note;
}

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  ADMIN_ONLY: 'Tu cuenta no tiene permisos de administrador activos para esta acción.',
  SHIPMENT_NOT_FOUND: 'No encontramos este envío. Actualiza la lista.',
  CARRIER_REVIEW_NOT_PENDING: 'Esta revisión ya no está pendiente. Actualiza la lista.',
  CARRIER_REVIEW_ALREADY_RESOLVED: 'Esta revisión ya fue resuelta. Actualiza la lista.',
  CANCELLATION_EXTERNAL_ALREADY_STARTED:
    'La cancelación ya inició el reembolso y no se puede decidir desde aquí. Actualiza la lista.',
  SHIPMENT_NOT_CANCELABLE:
    'El estado del envío cambió y ya no se puede cancelar. Actualiza la lista y revisa el envío.',
  INVALID_REVIEW_NOTE: `Escribe una nota de entre 1 y ${MAX_REVIEW_NOTE_LENGTH} caracteres.`,
  INVALID_REVIEW_RESOLUTION: 'La decisión no es válida. Actualiza la página e intenta de nuevo.',
  INVALID_SHIPMENT_ID: 'El envío no es válido. Actualiza la página e intenta de nuevo.',
};
const GENERIC_ERROR_MESSAGE = 'No se pudo registrar la decisión. Intenta de nuevo.';

export function resolveCarrierReviewErrorMessage(code: string | null): string {
  return (code && ERROR_MESSAGES[code]) || GENERIC_ERROR_MESSAGE;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long a review has waited, in coarse Spanish units; never negative. */
export function formatWaiting(since: string, now: number = Date.now()): string {
  const start = Date.parse(since);
  if (Number.isNaN(start)) return '--';
  const elapsed = Math.max(0, now - start);
  if (elapsed < MINUTE_MS) return 'menos de 1 min';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min`;
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    const minutes = Math.floor((elapsed % HOUR_MS) / MINUTE_MS);
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  const hours = Math.floor((elapsed % DAY_MS) / HOUR_MS);
  return hours ? `${days} d ${hours} h` : `${days} d`;
}
