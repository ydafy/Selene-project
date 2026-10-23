/**
 * @file supabase/functions/resolve-shipment-refund/handler.ts
 *
 * Admin "mark resolved with reference" for a shipment refund that failed or was
 * canceled (B2.3.1). Pure decision logic: index.ts wires the Supabase auth, the
 * `profiles_private.role` lookup and the service-only RPC into these ports.
 * Raw database text only reaches the log, never the response.
 */

import { isActiveAdmin } from '../_shared/admin-auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REFERENCE_LENGTH = 200;

export type ResolveShipmentRefundInput = {
  shipmentId: string;
  adminId: string;
  reference: string;
};

export type ResolveShipmentRefundDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  resolveRefund: (
    input: ResolveShipmentRefundInput,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  log: (level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) => unknown;
};

export { isActiveAdmin };

const respond = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string): Response => respond(status, { error: code });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Stable code for the RPC errors a caller can act on; everything else is INTERNAL_ERROR. */
function mapRpcError(message: string): { status: number; code: string } | null {
  if (message.includes('REFUND_NOT_RESOLVABLE')) return { status: 409, code: 'REFUND_NOT_RESOLVABLE' };
  if (message.includes('SHIPMENT_STATUS_UNEXPECTED')) {
    return { status: 409, code: 'SHIPMENT_STATUS_UNEXPECTED' };
  }
  if (message.includes('INVALID_RESOLUTION_REFERENCE')) {
    return { status: 422, code: 'INVALID_RESOLUTION_REFERENCE' };
  }
  return null;
}

function parseResult(data: unknown): Record<string, unknown> | null {
  const result = asRecord(data);
  if (
    !result ||
    typeof result.resolved !== 'boolean' ||
    typeof result.shipment_cancelled !== 'boolean' ||
    typeof result.amount_owed_cents !== 'number' ||
    !Number.isInteger(result.amount_owed_cents) ||
    typeof result.reference !== 'string'
  ) {
    return null;
  }
  return {
    resolved: result.resolved,
    shipment_cancelled: result.shipment_cancelled,
    amount_owed_cents: result.amount_owed_cents,
    reference: result.reference,
  };
}

export function createResolveShipmentRefundHandler(deps: ResolveShipmentRefundDeps) {
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
      const shipmentId = body?.shipment_id;
      if (typeof shipmentId !== 'string' || !UUID.test(shipmentId)) {
        return fail(422, 'INVALID_SHIPMENT_ID');
      }
      const reference = typeof body?.reference === 'string' ? body.reference.trim() : '';
      if (reference === '' || reference.length > MAX_REFERENCE_LENGTH) {
        return fail(422, 'INVALID_RESOLUTION_REFERENCE');
      }

      const { data, error } = await deps.resolveRefund({ shipmentId, adminId, reference });
      if (error) {
        deps.log('ERROR', 'Shipment refund resolution failed', { shipmentId, error: error.message });
        const mapped = mapRpcError(error.message);
        return mapped ? fail(mapped.status, mapped.code) : fail(500, 'INTERNAL_ERROR');
      }

      const result = parseResult(data);
      if (!result) {
        deps.log('ERROR', 'Shipment refund resolution returned an unusable result', { shipmentId });
        return fail(500, 'INTERNAL_ERROR');
      }

      deps.log('INFO', 'Shipment refund resolved', {
        shipmentId,
        adminId,
        resolved: result.resolved,
        shipmentCancelled: result.shipment_cancelled,
      });
      return respond(200, result);
    } catch (error: unknown) {
      deps.log('ERROR', 'Shipment refund resolution crashed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(500, 'INTERNAL_ERROR');
    }
  };
}
