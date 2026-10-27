/**
 * @file supabase/functions/list-shipment-late-carrier-activity/handler.ts
 *
 * Admin list of cancelled-shipment cases where the carrier recorded activity after the
 * cancellation refund started and no admin has acknowledged it yet (B5.8b), the data behind a
 * bucket of the "Envios" section. The cancellation itself has already completed; the case only
 * waits for a person to look at the package. The response is keyed by bucket, like
 * list-shipment-operation-reviews, so later queues add keys without changing existing ones.
 * Pure decision logic: index.ts wires the Supabase auth, the `profiles_private.role` lookup and
 * the service-only RPC into these ports. Every row is validated; one unusable row fails the whole
 * request so partial data is never returned. Raw database text only reaches the log.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const SHIPMENT_STATUSES = [
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
const SOURCES = ['buyer', 'seller', 'paid_timeout', 'preparing_timeout'] as const;
const REFUND_STATUSES = ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const;
const EVENT_TYPES = ['created', 'information', 'in_transit', 'delivered', 'exception', 'returned'] as const;

export type ListShipmentLateCarrierActivityDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  listLateCarrierActivity: () => Promise<{ data: unknown; error: { message: string } | null }>;
  log: (level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) => unknown;
};

const respond = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string): Response => respond(status, { error: code });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const nullableText = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' ? value : undefined;

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.find((v) => v === value);

function toCase(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  if (!row) return null;

  const shipmentId = text(row.shipment_id);
  const orderId = text(row.order_id);
  const sellerId = text(row.seller_id);
  const trackingNumber = nullableText(row.tracking_number);
  const carrier = nullableText(row.carrier);
  const shipmentStatus = oneOf(SHIPMENT_STATUSES, row.shipment_status);
  const source = oneOf(SOURCES, row.source);
  const refundStatus = row.refund_status === null ? null : oneOf(REFUND_STATUSES, row.refund_status);
  const eventType = oneOf(EVENT_TYPES, row.late_carrier_activity_event_type);
  const activityAt = typeof row.late_carrier_activity_at === 'string'
    ? new Date(row.late_carrier_activity_at)
    : null;

  if (
    !shipmentId || !orderId || !sellerId || trackingNumber === undefined || carrier === undefined ||
    !shipmentStatus || !source || refundStatus === undefined || !eventType || !activityAt ||
    Number.isNaN(activityAt.getTime())
  ) {
    return null;
  }
  return {
    shipment_id: shipmentId,
    order_id: orderId,
    seller_id: sellerId,
    tracking_number: trackingNumber,
    carrier,
    shipment_status: shipmentStatus,
    source,
    refund_status: refundStatus,
    late_carrier_activity_at: row.late_carrier_activity_at,
    late_carrier_activity_event_type: eventType,
  };
}

export function createListShipmentLateCarrierActivityHandler(deps: ListShipmentLateCarrierActivityDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    // POST is accepted because supabase-js `functions.invoke` sends POST by default.
    if (req.method !== 'GET' && req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');

    try {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!token) return fail(401, 'AUTH_REQUIRED');

      const adminId = await deps.getUserId(token);
      if (!adminId) return fail(401, 'AUTH_REQUIRED');

      if (!(await deps.isAdmin(adminId))) return fail(403, 'ADMIN_ONLY');

      const { data, error } = await deps.listLateCarrierActivity();
      if (error) {
        deps.log('ERROR', 'Listing shipment late carrier activity failed', { error: error.message });
        return fail(500, 'INTERNAL_ERROR');
      }

      const rows = Array.isArray(data) ? data : null;
      const cases = rows ? rows.map(toCase) : null;
      if (!cases || cases.some((c) => c === null)) {
        deps.log('ERROR', 'Shipment late carrier activity returned an unusable result');
        return fail(500, 'INTERNAL_ERROR');
      }

      deps.log('INFO', 'Shipment late carrier activity listed', { adminId, count: cases.length });
      return respond(200, { late_carrier_activity: cases });
    } catch (error: unknown) {
      deps.log('ERROR', 'Listing shipment late carrier activity crashed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(500, 'INTERNAL_ERROR');
    }
  };
}
