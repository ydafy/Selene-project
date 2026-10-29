/**
 * @file supabase/functions/list-shipment-label-reconciliations/handler.ts
 *
 * Admin list of paid shipments whose label outcome is unproven (B6.1): the seller asked Envia for a
 * label and the answer was lost (orphan_pending), or a claim expired without an outcome. It is the data
 * behind the third bucket of the "Envios" section; the admin checks the Envia panel and then resolves the
 * case with resolve-shipment-label-reconciliation. The response is keyed by bucket, like
 * list-shipment-late-carrier-activity, so later queues add keys without changing existing ones.
 * Pure decision logic: index.ts wires the Supabase auth, the `profiles_private.role` lookup and the
 * service-only RPC into these ports. Every row is validated; one unusable row fails the whole request so
 * partial data is never returned. Raw database text only reaches the log.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const STUCK_STATES = ['orphan_pending', 'claimed', 'generation_sent'] as const;

export type ListShipmentLabelReconciliationsDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  listLabelReconciliations: () => Promise<{ data: unknown; error: { message: string } | null }>;
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

const timestamp = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
};

const nullableTimestamp = (value: unknown): string | null | undefined =>
  value === null ? null : (timestamp(value) ?? undefined);

const nullableCents = (value: unknown): number | null | undefined =>
  value === null ? null : Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.find((v) => v === value);

function toReconciliation(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  if (!row) return null;

  const fields = {
    shipment_id: text(row.shipment_id),
    order_id: text(row.order_id),
    seller_id: text(row.seller_id),
    seller_name: nullableText(row.seller_name),
    buyer_id: text(row.buyer_id),
    buyer_name: nullableText(row.buyer_name),
    shipment_created_at: timestamp(row.shipment_created_at),
    label_generation_state: oneOf(STUCK_STATES, row.label_generation_state),
    stuck_at: timestamp(row.stuck_at),
    claim_expires_at: nullableTimestamp(row.claim_expires_at),
    last_label_event_at: nullableTimestamp(row.last_label_event_at),
    quote_carrier: nullableText(row.quote_carrier),
    quote_service: nullableText(row.quote_service),
    quote_cost_cents: nullableCents(row.quote_cost_cents),
    quote_rated_at: nullableTimestamp(row.quote_rated_at),
    origin_postal_code: nullableText(row.origin_postal_code),
    origin_city: nullableText(row.origin_city),
    destination_postal_code: nullableText(row.destination_postal_code),
    destination_city: nullableText(row.destination_city),
  };
  // null is a valid value for the nullable columns; undefined and a null id or date are not.
  return Object.values(fields).some((v) => v === undefined) ||
      fields.shipment_id === null || fields.order_id === null || fields.seller_id === null ||
      fields.buyer_id === null || fields.shipment_created_at === null || fields.stuck_at === null
    ? null
    : fields;
}

export function createListShipmentLabelReconciliationsHandler(deps: ListShipmentLabelReconciliationsDeps) {
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

      const { data, error } = await deps.listLabelReconciliations();
      if (error) {
        deps.log('ERROR', 'Listing shipment label reconciliations failed', { error: error.message });
        return fail(500, 'INTERNAL_ERROR');
      }

      const rows = Array.isArray(data) ? data : null;
      const cases = rows ? rows.map(toReconciliation) : null;
      if (!cases || cases.some((c) => c === null)) {
        deps.log('ERROR', 'Shipment label reconciliations returned an unusable result');
        return fail(500, 'INTERNAL_ERROR');
      }

      deps.log('INFO', 'Shipment label reconciliations listed', { adminId, count: cases.length });
      return respond(200, { label_reconciliations: cases });
    } catch (error: unknown) {
      deps.log('ERROR', 'Listing shipment label reconciliations crashed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(500, 'INTERNAL_ERROR');
    }
  };
}
