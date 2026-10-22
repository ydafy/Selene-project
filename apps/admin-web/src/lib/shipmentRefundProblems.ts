/**
 * Contract of the admin refund-problem Edge Functions (`list-shipment-refund-problems`,
 * `resolve-shipment-refund`). Responses are validated at the boundary: one unusable
 * row fails the whole response, so the UI never shows partial money data.
 */

export const REFUND_PROBLEM_KINDS = [
  'refund_failed',
  'refund_canceled',
  'refund_not_found',
  'refund_ambiguous',
] as const;
export type RefundProblemKind = (typeof REFUND_PROBLEM_KINDS)[number];

export interface RefundProblem {
  shipmentId: string;
  orderId: string;
  buyerId: string;
  shipmentStatus: string;
  kind: RefundProblemKind;
  refundId: string | null;
  refundFailureReason: string | null;
  /** Integer cents owed to the buyer. */
  amountOwedCents: number;
  paymentIntentId: string;
  since: string;
}

export interface ResolveRefundResult {
  /** False when the refund was already resolved; `reference` is then the stored one. */
  resolved: boolean;
  shipmentCancelled: boolean;
  amountOwedCents: number;
  reference: string;
}

/** Same rule as the server: trimmed, 1 to 200 characters. */
export const MAX_RESOLUTION_REFERENCE_LENGTH = 200;

export class MalformedRefundResponseError extends Error {
  constructor(what: string) {
    super(`Malformed ${what} response`);
    this.name = 'MalformedRefundResponseError';
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

function toProblem(value: unknown): RefundProblem | null {
  const row = asRecord(value);
  if (!row) return null;
  const shipmentId = text(row.shipmentId);
  const orderId = text(row.orderId);
  const buyerId = text(row.buyerId);
  const shipmentStatus = text(row.shipmentStatus);
  const paymentIntentId = text(row.paymentIntentId);
  const since = text(row.since);
  const kind = REFUND_PROBLEM_KINDS.find((candidate) => candidate === row.kind);
  const refundId = nullableText(row.refundId);
  const refundFailureReason = nullableText(row.refundFailureReason);
  const amountOwedCents = row.amountOwedCents;
  if (
    !shipmentId || !orderId || !buyerId || !shipmentStatus || !paymentIntentId || !since || !kind ||
    refundId === undefined || refundFailureReason === undefined ||
    typeof amountOwedCents !== 'number' || !Number.isSafeInteger(amountOwedCents) || amountOwedCents <= 0 ||
    Number.isNaN(Date.parse(since))
  ) {
    return null;
  }
  return {
    shipmentId, orderId, buyerId, shipmentStatus, kind, refundId, refundFailureReason,
    amountOwedCents, paymentIntentId, since,
  };
}

export function parseRefundProblems(payload: unknown): RefundProblem[] {
  const rows = asRecord(payload)?.problems;
  if (!Array.isArray(rows)) throw new MalformedRefundResponseError('refund problems');
  const problems = rows.map(toProblem);
  if (problems.some((problem) => problem === null)) throw new MalformedRefundResponseError('refund problems');
  return problems as RefundProblem[];
}

export function parseResolveResult(payload: unknown): ResolveRefundResult {
  const result = asRecord(payload);
  if (
    !result ||
    typeof result.resolved !== 'boolean' ||
    typeof result.shipment_cancelled !== 'boolean' ||
    typeof result.amount_owed_cents !== 'number' ||
    !Number.isSafeInteger(result.amount_owed_cents) ||
    typeof result.reference !== 'string'
  ) {
    throw new MalformedRefundResponseError('refund resolution');
  }
  return {
    resolved: result.resolved,
    shipmentCancelled: result.shipment_cancelled,
    amountOwedCents: result.amount_owed_cents,
    reference: result.reference,
  };
}

/** The trimmed reference, or null when it is empty or over the server limit. */
export function normalizeResolutionReference(input: string): string | null {
  const reference = input.trim();
  return reference === '' || reference.length > MAX_RESOLUTION_REFERENCE_LENGTH ? null : reference;
}

const ERROR_MESSAGES: Record<string, string> = {
  REFUND_NOT_RESOLVABLE: 'Este reembolso ya no se puede resolver manualmente. Actualiza la lista.',
  SHIPMENT_STATUS_UNEXPECTED: 'El estado del envío cambió y no se puede cancelar. Actualiza la lista y revisa el envío.',
  INVALID_RESOLUTION_REFERENCE: 'Escribe una referencia del pago externo de entre 1 y 200 caracteres.',
  ADMIN_ONLY: 'Tu cuenta no tiene permisos de administrador activos para esta acción.',
};
const GENERIC_ERROR_MESSAGE = 'No se pudo marcar el reembolso como resuelto. Intenta de nuevo.';

export function resolveRefundErrorMessage(code: string | null): string {
  return (code && ERROR_MESSAGES[code]) || GENERIC_ERROR_MESSAGE;
}

/** The stable server error code carried by a thrown error, if any. */
export function getErrorCode(error: unknown): string | null {
  const code = asRecord(error)?.code;
  return typeof code === 'string' ? code : null;
}
