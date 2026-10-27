/**
 * @file supabase/functions/resolve-shipment-operation-review/handler.ts
 *
 * Admin decision on a preparing-timeout cancellation whose carrier outcome needs review (B4.4c):
 * `refund_approved` lets the next cron run start the refund, `closed_no_refund` stops the
 * cancellation for good. The decision itself moves no money. Pure decision logic: index.ts wires
 * the Supabase auth, the `profiles_private.role` lookup and the service-only RPC into these ports.
 * The admin id is the verified user, never the body. Raw database text only reaches the log, and
 * the note text is never logged.
 */

import { z } from '../_shared/zod-runtime.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOLUTIONS = ['refund_approved', 'closed_no_refund'] as const;
const MAX_NOTE_LENGTH = 500;

const shipmentIdSchema = z.string().regex(UUID);
const resolutionSchema = z.enum(RESOLUTIONS);
const noteSchema = z.string().trim().min(1).max(MAX_NOTE_LENGTH);

export type ResolveShipmentOperationReviewInput = {
  shipmentId: string;
  adminId: string;
  resolution: (typeof RESOLUTIONS)[number];
  note: string;
};

export type ResolveShipmentOperationReviewDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  resolveReview: (
    input: ResolveShipmentOperationReviewInput,
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
  { sql: 'SHIPMENT_NOT_FOUND', status: 404, code: 'SHIPMENT_NOT_FOUND' },
  { sql: 'CARRIER_REVIEW_NOT_PENDING', status: 409, code: 'CARRIER_REVIEW_NOT_PENDING' },
  { sql: 'CARRIER_REVIEW_ALREADY_RESOLVED', status: 409, code: 'CARRIER_REVIEW_ALREADY_RESOLVED' },
  {
    sql: 'CANCELLATION_EXTERNAL_ALREADY_STARTED',
    status: 409,
    code: 'CANCELLATION_EXTERNAL_ALREADY_STARTED',
  },
  { sql: 'SHIPMENT_NOT_CANCELABLE', status: 409, code: 'SHIPMENT_NOT_CANCELABLE' },
  { sql: 'INVALID_REVIEW_RESOLUTION', status: 422, code: 'INVALID_REVIEW_RESOLUTION' },
  { sql: 'INVALID_REVIEW_NOTE', status: 422, code: 'INVALID_REVIEW_NOTE' },
];

function mapRpcError(message: string): { status: number; code: string } | null {
  return RPC_ERRORS.find((e) => message.includes(e.sql)) ?? null;
}

/** A bigint arrives as a number or a decimal string; the loss is a non-negative safe integer, or NULL. */
function toNullableCents(value: unknown): number | null | undefined {
  if (value === null) return null;
  const cents = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof cents === 'number' && Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

function parseResult(data: unknown): Record<string, unknown> | null {
  const result = asRecord(data);
  if (!result) return null;
  const resolution = resolutionSchema.safeParse(result.review_resolution);
  const resolvedAt = typeof result.review_resolved_at === 'string'
    ? new Date(result.review_resolved_at)
    : null;
  const loss = toNullableCents(result.label_cost_loss_cents);
  if (
    !resolution.success || !resolvedAt || Number.isNaN(resolvedAt.getTime()) ||
    typeof result.review_resolved_by !== 'string' ||
    typeof result.review_resolution_note !== 'string' || loss === undefined
  ) {
    return null;
  }
  return {
    review_resolution: resolution.data,
    review_resolved_at: result.review_resolved_at,
    review_resolved_by: result.review_resolved_by,
    review_resolution_note: result.review_resolution_note,
    label_cost_loss_cents: loss,
  };
}

export function createResolveShipmentOperationReviewHandler(
  deps: ResolveShipmentOperationReviewDeps,
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
      if (!resolution.success) return fail(422, 'INVALID_REVIEW_RESOLUTION');
      const note = noteSchema.safeParse(body?.note);
      if (!note.success) return fail(422, 'INVALID_REVIEW_NOTE');

      const { data, error } = await deps.resolveReview({
        shipmentId: shipmentId.data,
        adminId,
        resolution: resolution.data,
        note: note.data,
      });
      if (error) {
        deps.log('ERROR', 'Shipment operation review resolution failed', {
          shipmentId: shipmentId.data,
          error: error.message,
        });
        const mapped = mapRpcError(error.message);
        return mapped ? fail(mapped.status, mapped.code) : fail(500, 'INTERNAL_ERROR');
      }

      const result = parseResult(data);
      if (!result) {
        deps.log('ERROR', 'Shipment operation review resolution returned an unusable result', {
          shipmentId: shipmentId.data,
        });
        return fail(500, 'INTERNAL_ERROR');
      }

      deps.log('INFO', 'Shipment operation review resolved', {
        shipmentId: shipmentId.data,
        adminId,
        resolution: result.review_resolution,
      });
      return respond(200, result);
    } catch (error: unknown) {
      deps.log('ERROR', 'Shipment operation review resolution crashed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(500, 'INTERNAL_ERROR');
    }
  };
}
