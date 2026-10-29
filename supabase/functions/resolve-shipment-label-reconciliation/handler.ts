/**
 * @file supabase/functions/resolve-shipment-label-reconciliation/handler.ts
 *
 * Admin resolution of a shipment stuck in label generation (B6.1). The admin has checked the Envia panel
 * and records either label_found (the label exists: tracking number, label URL, Envia shipment id and
 * the provider cost in integer cents) or no_label (no label was created: the shipment returns to the
 * seller and can be cancelled and refunded). The RPC does the work under the shipment row lock; this
 * function starts no refund and calls neither Stripe nor Envia. Pure decision logic: index.ts wires the
 * Supabase auth, the `profiles_private.role` lookup and the service-only RPC into these ports. The actor
 * id is the verified user, never the body. A shipment that is no longer stuck answers 409
 * ALREADY_RESOLVED and nothing changes. Raw database text only reaches the log; the note, the label URL
 * and the tracking number are never logged.
 */

import { z } from '../_shared/zod-runtime.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;

const shipmentIdSchema = z.string().regex(UUID);
const resolutionSchema = z.enum(['label_found', 'no_label']);
const noteSchema = z.string().trim().min(1).max(MAX_NOTE_LENGTH);
const referenceSchema = z.string().trim().min(1).max(MAX_REFERENCE_LENGTH);
// The cost is integer cents, the unit the database stores; pesos with decimals are rejected here.
const costSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const labelUrlSchema = z.string().trim().min(1).max(MAX_URL_LENGTH).refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
});

export type ResolveShipmentLabelReconciliationInput = {
  shipmentId: string;
  adminId: string;
  resolution: 'label_found' | 'no_label';
  note: string;
  enviaShipmentId: string | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  providerCostCents: number | null;
};

export type ResolveShipmentLabelReconciliationDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  resolve: (
    input: ResolveShipmentLabelReconciliationInput,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  log: (level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) => unknown;
};

const respond = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string): Response => respond(status, { error: code });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Stable code for the RPC errors a caller can act on; everything else is INTERNAL_ERROR. */
const RPC_ERRORS: readonly { sql: string; status: number; code: string }[] = [
  { sql: 'ADMIN_REQUIRED', status: 403, code: 'ADMIN_ONLY' },
  { sql: 'INVALID_RESOLUTION_NOTE', status: 422, code: 'INVALID_RESOLUTION_NOTE' },
  { sql: 'INVALID_RESOLUTION', status: 422, code: 'INVALID_RESOLUTION' },
  { sql: 'SHIPMENT_NOT_FOUND', status: 404, code: 'SHIPMENT_NOT_FOUND' },
  { sql: 'INVALID_PROVIDER_RESULT', status: 422, code: 'INVALID_PROVIDER_RESULT' },
  { sql: 'UNEXPECTED_PROVIDER_FIELDS', status: 422, code: 'UNEXPECTED_PROVIDER_FIELDS' },
  // The print settings are server configuration, so the caller cannot fix it: a 5xx reaches Sentry.
  { sql: 'LABEL_SETTINGS_MISSING', status: 500, code: 'LABEL_SETTINGS_MISSING' },
];

function mapRpcError(message: string): { status: number; code: string } | null {
  return RPC_ERRORS.find((e) => message.includes(e.sql)) ?? null;
}

function parseResult(data: unknown): { status: number; body: Record<string, unknown> } | null {
  const result = asRecord(data);
  if (
    !result || typeof result.shipment_id !== 'string' || result.shipment_id === '' ||
    typeof result.status !== 'string' || typeof result.label_generation_state !== 'string'
  ) {
    return null;
  }
  const state = {
    shipment_id: result.shipment_id,
    status: result.status,
    label_generation_state: result.label_generation_state,
  };
  if (result.result === 'already_resolved') {
    return { status: 409, body: { error: 'ALREADY_RESOLVED', ...state } };
  }
  if (result.result === 'resolved' && (result.resolution === 'label_found' || result.resolution === 'no_label')) {
    return { status: 200, body: { result: 'resolved', resolution: result.resolution, ...state } };
  }
  return null;
}

type ProviderFields = Pick<
  ResolveShipmentLabelReconciliationInput,
  'enviaShipmentId' | 'trackingNumber' | 'labelUrl' | 'providerCostCents'
>;

/** Provider fields for the resolution, or the 422 code that rejects them. */
function parseProviderFields(
  resolution: 'label_found' | 'no_label',
  body: Record<string, unknown> | null,
): { fields: ProviderFields } | { code: string } {
  const raw = [body?.envia_shipment_id, body?.tracking_number, body?.label_url, body?.provider_cost_cents];
  if (resolution === 'no_label') {
    return raw.some((v) => v !== undefined && v !== null)
      ? { code: 'UNEXPECTED_PROVIDER_FIELDS' }
      : { fields: { enviaShipmentId: null, trackingNumber: null, labelUrl: null, providerCostCents: null } };
  }
  const envia = referenceSchema.safeParse(body?.envia_shipment_id);
  const tracking = referenceSchema.safeParse(body?.tracking_number);
  const url = labelUrlSchema.safeParse(body?.label_url);
  const cost = costSchema.safeParse(body?.provider_cost_cents);
  if (!envia.success || !tracking.success || !url.success || !cost.success) {
    return { code: 'INVALID_PROVIDER_RESULT' };
  }
  return {
    fields: {
      enviaShipmentId: envia.data,
      trackingNumber: tracking.data,
      labelUrl: url.data,
      providerCostCents: cost.data,
    },
  };
}

export function createResolveShipmentLabelReconciliationHandler(
  deps: ResolveShipmentLabelReconciliationDeps,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');

    try {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!token) return fail(401, 'AUTH_REQUIRED');

      const adminId = await deps.getUserId(token);
      if (!adminId) return fail(401, 'AUTH_REQUIRED');

      if (!(await deps.isAdmin(adminId))) return fail(403, 'ADMIN_ONLY');

      const body = asRecord(await req.json().catch(() => null));
      const shipmentId = shipmentIdSchema.safeParse(body?.shipment_id);
      if (!shipmentId.success) return fail(422, 'INVALID_SHIPMENT_ID');
      const resolution = resolutionSchema.safeParse(body?.resolution);
      if (!resolution.success) return fail(422, 'INVALID_RESOLUTION');
      const note = noteSchema.safeParse(body?.note);
      if (!note.success) return fail(422, 'INVALID_RESOLUTION_NOTE');
      const provider = parseProviderFields(resolution.data, body);
      if ('code' in provider) return fail(422, provider.code);

      const { data, error } = await deps.resolve({
        shipmentId: shipmentId.data,
        adminId,
        resolution: resolution.data,
        note: note.data,
        ...provider.fields,
      });
      if (error) {
        deps.log('ERROR', 'Shipment label reconciliation failed', {
          shipmentId: shipmentId.data,
          error: error.message,
        });
        const mapped = mapRpcError(error.message);
        return mapped ? fail(mapped.status, mapped.code) : fail(500, 'INTERNAL_ERROR');
      }

      const result = parseResult(data);
      if (!result) {
        deps.log('ERROR', 'Shipment label reconciliation returned an unusable result', {
          shipmentId: shipmentId.data,
        });
        return fail(500, 'INTERNAL_ERROR');
      }

      deps.log(
        result.status === 200 ? 'INFO' : 'WARN',
        result.status === 200 ? 'Shipment label reconciliation resolved' : 'Shipment label reconciliation already resolved',
        { shipmentId: shipmentId.data, adminId, resolution: resolution.data },
      );
      return respond(result.status, result.body);
    } catch (error: unknown) {
      deps.log('ERROR', 'Shipment label reconciliation crashed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(500, 'INTERNAL_ERROR');
    }
  };
}
