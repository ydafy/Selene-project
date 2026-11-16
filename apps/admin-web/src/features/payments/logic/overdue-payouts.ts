/**
 * Contract of the overdue held payout actions (#549): `record-payout-hold-note`
 * keeps a payout on hold with a note, and `refund-overdue-payout` refunds the
 * buyer when Stripe rejected the seller's account. Responses are validated at
 * the boundary so the screen never shows a wrong amount or note.
 */

import { asRecord } from '@/shared/utils/as-record';

/** `connect_payout_runs.failure_reason` of a run the overdue refund closed. */
export const OVERDUE_REFUND_CLOSED_RUN = 'overdue_payout_refunded';

/** Same rule as the server: trimmed, 1 to 1000 characters. */
export const MAX_HOLD_NOTE_LENGTH = 1000;

/** Characters of the trimmed note, counted as code points like SQL `char_length`. */
export function holdNoteLength(input: string): number {
  return [...input.trim()].length;
}

/** The trimmed note, or null when it is blank or over the server limit. */
export function normalizeHoldNote(input: string): string | null {
  const note = input.trim();
  const length = holdNoteLength(note);
  return length === 0 || length > MAX_HOLD_NOTE_LENGTH ? null : note;
}

/**
 * The server refuses the refund unless Stripe rejected the account, so the
 * screen offers it only for that block reason.
 */
export function canRefundOverduePayout(blockReason: string | null): boolean {
  return blockReason === 'onboarding_rejected';
}

export interface HoldNoteResult {
  id: string;
  shipmentId: string;
  note: string;
  notedAt: string;
  notedBy: string;
}

export interface OverdueRefundResult {
  /** `refunded` (HTTP 200) or `pending` in Stripe (HTTP 202). */
  status: 'refunded' | 'pending';
  shipmentId: string;
  refundId: string;
  /** Integer cents the server refunded; computed on the server. */
  amountCents: number;
}

class MalformedOverdueResponseError extends Error {
  constructor(what: string) {
    super(`Malformed ${what} response`);
    this.name = 'MalformedOverdueResponseError';
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

export function parseHoldNoteResult(payload: unknown): HoldNoteResult {
  const body = asRecord(payload);
  const id = text(body?.id);
  const shipmentId = text(body?.shipment_id);
  const note = text(body?.note);
  const notedAt = text(body?.noted_at);
  const notedBy = text(body?.noted_by);
  if (
    !id ||
    !shipmentId ||
    !note ||
    !notedAt ||
    !notedBy ||
    Number.isNaN(Date.parse(notedAt))
  )
    throw new MalformedOverdueResponseError('hold note');
  return { id, shipmentId, note, notedAt, notedBy };
}

export function parseOverdueRefundResult(
  payload: unknown,
): OverdueRefundResult {
  const body = asRecord(payload);
  const status = body?.status;
  const shipmentId = text(body?.shipment_id);
  const refundId = text(body?.refund_id);
  const amountCents = body?.amount_cents;
  if (
    (status !== 'refunded' && status !== 'pending') ||
    !shipmentId ||
    !refundId ||
    typeof amountCents !== 'number' ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0
  )
    throw new MalformedOverdueResponseError('overdue refund');
  return { status, shipmentId, refundId, amountCents };
}

const ADMIN_ONLY =
  'Tu cuenta no tiene permisos de administrador activos para esta acción.';
const AUTH_REQUIRED = 'Tu sesión expiró. Vuelve a iniciar sesión.';
const SHIPMENT_NOT_FOUND =
  'No encontramos este envío. Actualiza la cola y revísalo.';

const HOLD_NOTE_ERRORS: Record<string, string> = {
  PAYOUT_NOT_OVERDUE:
    'Este pago ya no está vencido (por ejemplo, ya se pagó o la cuenta ya puede cobrar). Actualiza la cola.',
  INVALID_HOLD_NOTE: 'Escribe una nota de entre 1 y 1000 caracteres.',
  INVALID_SHIPMENT_ID:
    'El envío no es válido. Actualiza la cola e inténtalo de nuevo.',
  SHIPMENT_NOT_FOUND,
  ADMIN_ONLY,
  AUTH_REQUIRED,
};
const HOLD_NOTE_GENERIC =
  'No se guardó la nota por un error del servidor. Intenta de nuevo.';

export function holdNoteErrorMessage(code: string | null): string {
  return (code && HOLD_NOTE_ERRORS[code]) || HOLD_NOTE_GENERIC;
}

const REFUND_ERRORS: Record<string, string> = {
  REFUND_FAILED:
    'Stripe no pudo devolver el dinero a la tarjeta del comprador y el monto regresó al saldo de Selene. Repaga al comprador por otro medio y registra la referencia en Necesita atención > Reembolsos con problemas.',
  REFUND_IN_PROGRESS:
    'Ya hay un reembolso de este envío en curso. Intenta de nuevo en unos minutos.',
  SELLER_ACCOUNT_NOT_REJECTED:
    'Stripe no rechazó la cuenta del vendedor (puede estar en revisión), así que este pago no se puede reembolsar. Sigue reteniéndolo con una nota.',
  PAYMENT_METHOD_NOT_REFUNDABLE:
    'Este pago no se hizo con tarjeta y no se puede reembolsar desde aquí.',
  PAYOUT_NOT_OVERDUE:
    'Este pago ya no está vencido: aún no cumple 30 días, ya se pagó o la cuenta ya puede cobrar. Actualiza la cola.',
  SHIPMENT_NOT_COMPLETED:
    'El envío ya no está completado. Actualiza la cola y revísalo.',
  SHIPMENT_ALREADY_REFUNDED: 'Este envío ya fue reembolsado.',
  SHIPMENT_FUNDS_ALREADY_RELEASED:
    'Este pago ya se transfirió al vendedor; no se puede reembolsar desde aquí.',
  SHIPMENT_TRANSFER_OPERATION_ACTIVE:
    'Ya se inició una transferencia de este envío al vendedor; no se puede reembolsar.',
  PAYOUT_RUN_NOT_PARKED:
    'Una dispersión que incluye este envío sigue activa. Revísala en Necesita atención antes de reembolsar.',
  SHIPMENT_CANCELLATION_OPERATION_ACTIVE:
    'Hay otra operación de cancelación en curso para este envío. Intenta más tarde.',
  REFUND_AMOUNT_EXCEEDS_CAP:
    'El cargo ya no tiene saldo suficiente para reembolsar este envío. Revísalo en Stripe.',
  REFUND_RECOVERY_REQUIRED:
    'Un reembolso anterior de este envío necesita revisión manual. Revisa Necesita atención > Reembolsos con problemas.',
  REFUND_UNCONFIRMED:
    'No pudimos confirmar la respuesta de Stripe para este envío. Revísalo en Stripe antes de volver a intentar.',
  STRIPE_REQUEST_FAILED:
    'Stripe no respondió. Intenta de nuevo: no se crea un segundo reembolso.',
  REFUND_COMPLETION_FAILED:
    'Stripe hizo el reembolso, pero no se terminó de registrar. Intenta de nuevo para completarlo; no se crea un segundo reembolso.',
  SHIPMENT_NOT_FOUND,
  ADMIN_ONLY,
  AUTH_REQUIRED,
  INVALID_SHIPMENT_ID:
    'El envío no es válido. Actualiza la cola e inténtalo de nuevo.',
};
const REFUND_GENERIC =
  'No sabemos si el reembolso se hizo por un error del servidor. Actualiza la cola antes de volver a intentar; un nuevo intento no crea un segundo reembolso.';

export function overdueRefundErrorMessage(code: string | null): string {
  return (code && REFUND_ERRORS[code]) || REFUND_GENERIC;
}
