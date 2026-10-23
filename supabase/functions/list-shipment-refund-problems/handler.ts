/**
 * @file supabase/functions/list-shipment-refund-problems/handler.ts
 *
 * Admin list of unresolved shipment refund problems (B2.4b): failed or canceled
 * refunds and escalated operations with no refund. Pure decision logic: index.ts
 * wires the Supabase auth, the `profiles_private.role` lookup and the service-only
 * RPC into these ports. Every row is validated; one unusable row fails the whole
 * request so partial money data is never returned. Raw database text only reaches the log.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const KINDS = ['refund_failed', 'refund_canceled', 'refund_not_found', 'refund_ambiguous'] as const;

export type ListShipmentRefundProblemsDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  listProblems: () => Promise<{ data: unknown; error: { message: string } | null }>;
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

/** A bigint arrives as a number or a decimal string; only positive safe integers are money. */
function toCents(value: unknown): number | null {
  const cents = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof cents === 'number' && Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function toProblem(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  if (!row) return null;

  const shipmentId = text(row.shipment_id);
  const orderId = text(row.order_id);
  const buyerId = text(row.buyer_id);
  const shipmentStatus = text(row.shipment_status);
  const paymentIntentId = text(row.payment_intent_id);
  const kind = KINDS.find((k) => k === row.kind);
  const refundId = nullableText(row.refund_id);
  const refundFailureReason = nullableText(row.refund_failure_reason);
  const amountOwedCents = toCents(row.amount_owed_cents);
  const since = typeof row.since === 'string' ? new Date(row.since) : null;

  if (
    !shipmentId || !orderId || !buyerId || !shipmentStatus || !paymentIntentId || !kind ||
    refundId === undefined || refundFailureReason === undefined || amountOwedCents === null ||
    !since || Number.isNaN(since.getTime())
  ) {
    return null;
  }
  return {
    shipmentId,
    orderId,
    buyerId,
    shipmentStatus,
    kind,
    refundId,
    refundFailureReason,
    amountOwedCents,
    paymentIntentId,
    since: since.toISOString(),
  };
}

export function createListShipmentRefundProblemsHandler(deps: ListShipmentRefundProblemsDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED');

    try {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!token) return fail(401, 'AUTH_REQUIRED');

      const adminId = await deps.getUserId(token);
      if (!adminId) return fail(401, 'AUTH_REQUIRED');

      if (!(await deps.isAdmin(adminId))) return fail(403, 'ADMIN_ONLY');

      const { data, error } = await deps.listProblems();
      if (error) {
        deps.log('ERROR', 'Listing shipment refund problems failed', { error: error.message });
        return fail(500, 'INTERNAL_ERROR');
      }

      const rows = Array.isArray(data) ? data : null;
      const problems = rows ? rows.map(toProblem) : null;
      if (!problems || problems.some((problem) => problem === null)) {
        deps.log('ERROR', 'Shipment refund problems returned an unusable result');
        return fail(500, 'INTERNAL_ERROR');
      }

      deps.log('INFO', 'Shipment refund problems listed', { adminId, count: problems.length });
      return respond(200, { problems });
    } catch (error: unknown) {
      deps.log('ERROR', 'Listing shipment refund problems crashed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(500, 'INTERNAL_ERROR');
    }
  };
}
