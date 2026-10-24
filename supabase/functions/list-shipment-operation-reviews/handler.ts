/**
 * @file supabase/functions/list-shipment-operation-reviews/handler.ts
 *
 * Admin list of shipment operations waiting for a human decision (B4.4c), the data behind the
 * "Envios" section. The response is keyed by bucket so later shipping queues add keys without
 * changing existing ones; the first bucket is `reviews` (preparing-timeout cancellations whose
 * carrier outcome needs an admin). Pure decision logic: index.ts wires the Supabase auth, the
 * `profiles_private.role` lookup and the service-only RPC into these ports. Every row is
 * validated; one unusable row fails the whole request so partial data is never returned.
 * Raw database text only reaches the log.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const REASONS = ['tracking_unknown', 'carrier_refused', 'carrier_ambiguous'] as const;

export type ListShipmentOperationReviewsDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  listReviews: () => Promise<{ data: unknown; error: { message: string } | null }>;
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

/** A bigint arrives as a number or a decimal string; money is a non-negative safe integer, or NULL. */
function toNullableCents(value: unknown): number | null | undefined {
  if (value === null) return null;
  const cents = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof cents === 'number' && Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

function toReview(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  if (!row) return null;

  const shipmentId = text(row.shipment_id);
  const orderId = text(row.order_id);
  const sellerId = text(row.seller_id);
  const trackingNumber = nullableText(row.tracking_number);
  const carrier = nullableText(row.carrier);
  const labelCostCents = toNullableCents(row.label_provider_cost_cents);
  const reason = REASONS.find((r) => r === row.review_reason);
  const outcome = nullableText(row.carrier_cancellation_outcome);
  const requiredAt = typeof row.review_required_at === 'string' ? new Date(row.review_required_at) : null;

  if (
    !shipmentId || !orderId || !sellerId || trackingNumber === undefined || carrier === undefined ||
    labelCostCents === undefined || !reason || outcome === undefined || !requiredAt ||
    Number.isNaN(requiredAt.getTime())
  ) {
    return null;
  }
  return {
    shipment_id: shipmentId,
    order_id: orderId,
    seller_id: sellerId,
    tracking_number: trackingNumber,
    carrier,
    label_provider_cost_cents: labelCostCents,
    review_reason: reason,
    carrier_cancellation_outcome: outcome,
    review_required_at: row.review_required_at,
  };
}

export function createListShipmentOperationReviewsHandler(deps: ListShipmentOperationReviewsDeps) {
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

      const { data, error } = await deps.listReviews();
      if (error) {
        deps.log('ERROR', 'Listing shipment operation reviews failed', { error: error.message });
        return fail(500, 'INTERNAL_ERROR');
      }

      const rows = Array.isArray(data) ? data : null;
      const reviews = rows ? rows.map(toReview) : null;
      if (!reviews || reviews.some((review) => review === null)) {
        deps.log('ERROR', 'Shipment operation reviews returned an unusable result');
        return fail(500, 'INTERNAL_ERROR');
      }

      deps.log('INFO', 'Shipment operation reviews listed', { adminId, count: reviews.length });
      return respond(200, { reviews });
    } catch (error: unknown) {
      deps.log('ERROR', 'Listing shipment operation reviews crashed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(500, 'INTERNAL_ERROR');
    }
  };
}
