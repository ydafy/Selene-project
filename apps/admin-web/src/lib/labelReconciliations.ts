/**
 * Contract of the admin label-reconciliation Edge Functions (`list-shipment-label-reconciliations`,
 * `resolve-shipment-label-reconciliation`): paid shipments whose label outcome is unproven. The
 * admin checks the Envía panel and records either the label that exists or that none was created.
 * Responses are validated at the boundary: one unusable row fails the whole response, so the UI
 * never shows partial data. Money is integer cents; pesos typed by the admin are converted here.
 */

export const STUCK_STATES = ['orphan_pending', 'claimed', 'generation_sent'] as const;
export type StuckState = (typeof STUCK_STATES)[number];

export interface LabelReconciliation {
  shipmentId: string;
  orderId: string;
  sellerId: string;
  sellerName: string | null;
  buyerId: string;
  buyerName: string | null;
  createdAt: string;
  state: StuckState;
  /** When the case got stuck: the lost answer, or the expired attempt. */
  stuckAt: string;
  claimExpiresAt: string | null;
  lastLabelEventAt: string | null;
  quoteCarrier: string | null;
  quoteService: string | null;
  quoteCostCents: number | null;
  quoteRatedAt: string | null;
  originPostalCode: string | null;
  originCity: string | null;
  destinationPostalCode: string | null;
  destinationCity: string | null;
}

export type ResolveLabelReconciliationInput =
  | { shipmentId: string; resolution: 'no_label'; note: string }
  | {
    shipmentId: string;
    resolution: 'label_found';
    note: string;
    enviaShipmentId: string;
    trackingNumber: string;
    labelUrl: string;
    providerCostCents: number;
  };

export interface ResolveLabelReconciliationResult {
  resolution: 'label_found' | 'no_label';
  status: string;
  labelGenerationState: string;
}

/** Same limits as the server: trimmed note of 1 to 200 characters, references up to 200, URL up to 2048. */
export const MAX_RESOLUTION_NOTE_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;

export class MalformedLabelReconciliationResponseError extends Error {
  constructor(what: string) {
    super(`Malformed ${what} response`);
    this.name = 'MalformedLabelReconciliationResponseError';
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

const timestamp = (value: unknown): string | null => {
  const candidate = text(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
};

const nullableTimestamp = (value: unknown): string | null | undefined =>
  value === null ? null : (timestamp(value) ?? undefined);

const nullableCents = (value: unknown): number | null | undefined =>
  value === null ? null : Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.find((candidate) => candidate === value);

function toReconciliation(value: unknown): LabelReconciliation | null {
  const row = asRecord(value);
  if (!row) return null;
  const item = {
    shipmentId: text(row.shipment_id),
    orderId: text(row.order_id),
    sellerId: text(row.seller_id),
    sellerName: nullableText(row.seller_name),
    buyerId: text(row.buyer_id),
    buyerName: nullableText(row.buyer_name),
    createdAt: timestamp(row.shipment_created_at),
    state: oneOf(STUCK_STATES, row.label_generation_state),
    stuckAt: timestamp(row.stuck_at),
    claimExpiresAt: nullableTimestamp(row.claim_expires_at),
    lastLabelEventAt: nullableTimestamp(row.last_label_event_at),
    quoteCarrier: nullableText(row.quote_carrier),
    quoteService: nullableText(row.quote_service),
    quoteCostCents: nullableCents(row.quote_cost_cents),
    quoteRatedAt: nullableTimestamp(row.quote_rated_at),
    originPostalCode: nullableText(row.origin_postal_code),
    originCity: nullableText(row.origin_city),
    destinationPostalCode: nullableText(row.destination_postal_code),
    destinationCity: nullableText(row.destination_city),
  };
  // null is a valid value for the optional columns; undefined, an empty id or a bad date are not.
  const required = [item.shipmentId, item.orderId, item.sellerId, item.buyerId, item.createdAt, item.state, item.stuckAt];
  if (required.some((field) => field === null || field === undefined)) return null;
  if (Object.values(item).some((field) => field === undefined)) return null;
  return item as LabelReconciliation;
}

export function parseLabelReconciliations(payload: unknown): LabelReconciliation[] {
  const rows = asRecord(payload)?.label_reconciliations;
  if (!Array.isArray(rows)) throw new MalformedLabelReconciliationResponseError('label reconciliations');
  const cases = rows.map(toReconciliation);
  if (cases.some((item) => item === null)) throw new MalformedLabelReconciliationResponseError('label reconciliations');
  return cases as LabelReconciliation[];
}

export function parseResolveResult(payload: unknown): ResolveLabelReconciliationResult {
  const result = asRecord(payload);
  if (
    !result || result.result !== 'resolved' ||
    (result.resolution !== 'label_found' && result.resolution !== 'no_label') ||
    typeof result.status !== 'string' || typeof result.label_generation_state !== 'string'
  ) {
    throw new MalformedLabelReconciliationResponseError('label reconciliation result');
  }
  return {
    resolution: result.resolution,
    status: result.status,
    labelGenerationState: result.label_generation_state,
  };
}

/**
 * Pesos as typed by the admin ("93", "93.5", "93.50") to integer cents, without float arithmetic.
 * Null for anything else: empty, negative, more than two decimals, separators, text.
 */
export function pesosToCents(input: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** The trimmed note, or null when it is empty or over the server limit. */
export function normalizeResolutionNote(input: string): string | null {
  const note = input.trim();
  return note === '' || note.length > MAX_RESOLUTION_NOTE_LENGTH ? null : note;
}

export interface LabelFoundFormInput {
  trackingNumber: string;
  labelUrl: string;
  enviaShipmentId: string;
  costPesos: string;
  note: string;
}

export type LabelFoundField = keyof LabelFoundFormInput;

export type LabelFoundValidation =
  | {
    ok: true;
    value: {
      trackingNumber: string;
      labelUrl: string;
      enviaShipmentId: string;
      providerCostCents: number;
      note: string;
    };
  }
  | { ok: false; field: LabelFoundField; message: string };

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

/** Validates the "la guía existe" form with the same rules as the server; the first wrong field wins. */
export function validateLabelFoundForm(input: LabelFoundFormInput): LabelFoundValidation {
  const trackingNumber = input.trackingNumber.trim();
  if (trackingNumber === '' || trackingNumber.length > MAX_REFERENCE_LENGTH) {
    return { ok: false, field: 'trackingNumber', message: 'Escribe el número de guía tal como aparece en Envía.' };
  }
  const labelUrl = input.labelUrl.trim();
  if (labelUrl === '' || labelUrl.length > MAX_URL_LENGTH || !isHttpUrl(labelUrl)) {
    return { ok: false, field: 'labelUrl', message: 'Pega el enlace completo de la guía, que empieza con https://' };
  }
  const enviaShipmentId = input.enviaShipmentId.trim();
  if (enviaShipmentId === '' || enviaShipmentId.length > MAX_REFERENCE_LENGTH) {
    return { ok: false, field: 'enviaShipmentId', message: 'Escribe el ID del envío que muestra Envía.' };
  }
  const providerCostCents = pesosToCents(input.costPesos);
  if (providerCostCents === null) {
    return { ok: false, field: 'costPesos', message: 'Escribe el costo en pesos, solo números. Ej. 93.50' };
  }
  const note = normalizeResolutionNote(input.note);
  if (!note) {
    return { ok: false, field: 'note', message: resolveLabelReconciliationErrorMessage('INVALID_RESOLUTION_NOTE') };
  }
  return { ok: true, value: { trackingNumber, labelUrl, enviaShipmentId, providerCostCents, note } };
}

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  ADMIN_ONLY: 'Tu cuenta no tiene permisos de administrador activos para esta acción.',
  SHIPMENT_NOT_FOUND: 'No encontramos este envío. Actualiza la lista.',
  ALREADY_RESOLVED: 'Este envío ya no está pendiente: alguien más lo resolvió o la guía ya se creó. Actualizamos la lista.',
  INVALID_RESOLUTION_NOTE: `Escribe una nota de entre 1 y ${MAX_RESOLUTION_NOTE_LENGTH} caracteres.`,
  INVALID_PROVIDER_RESULT: 'Revisa los datos de la guía: número, enlace, ID de Envía y costo.',
  UNEXPECTED_PROVIDER_FIELDS: 'Esos datos no corresponden a esta decisión. Actualiza la página e intenta de nuevo.',
  LABEL_SETTINGS_MISSING: 'Falta configurar el formato de impresión de las guías. Avisa a soporte técnico.',
  INVALID_RESOLUTION: 'La decisión no es válida. Actualiza la página e intenta de nuevo.',
  INVALID_SHIPMENT_ID: 'El envío no es válido. Actualiza la página e intenta de nuevo.',
};
const GENERIC_ERROR_MESSAGE = 'No se pudo guardar la decisión. Intenta de nuevo.';

export function resolveLabelReconciliationErrorMessage(code: string | null): string {
  return (code && ERROR_MESSAGES[code]) || GENERIC_ERROR_MESSAGE;
}
