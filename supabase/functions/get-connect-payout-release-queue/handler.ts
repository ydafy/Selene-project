import type { Database } from '../../../packages/types/src/database.types.ts';
import {
  assertAdminProfile,
  buildConnectPayoutReleaseQueue,
  getQueueErrorStatus,
  type ConnectPayoutReleaseQueueRow,
} from './get-connect-payout-release-queue.ts';

type Args =
  Database['public']['Functions']['fn_get_admin_payout_queue']['Args'];
export interface QueueDependencies {
  getUser(token: string): Promise<{ id: string } | null>;
  getProfile(id: string): Promise<{ role: string | null } | null>;
  legacy(search: string): Promise<ConnectPayoutReleaseQueueRow[]>;
  rpc(args: Args): Promise<unknown>;
}
// The five buckets fn_get_admin_payout_queue counts; `overdue` holds run-less shipments
// held 30 days or more (#549).
const buckets = [
  'ready',
  'overdue',
  'processing',
  'action-required',
  'history',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function parse(body: Record<string, unknown>): Args {
  if (!buckets.includes(body.bucket as string))
    throw Error('INVALID_QUEUE_BUCKET');
  if ('search' in body && typeof body.search !== 'string')
    throw Error('INVALID_QUEUE_SEARCH');
  const page = 'page' in body ? body.page : 0;
  const scope = 'scope' in body ? body.scope : 'page';
  if (!integer(page) || page > 2147483647) throw Error('INVALID_QUEUE_PAGE');
  if (scope !== 'page' && scope !== 'selection')
    throw Error('INVALID_QUEUE_SCOPE');
  if (
    scope === 'selection' &&
    body.bucket !== 'ready' &&
    body.bucket !== 'action-required'
  )
    throw Error('QUEUE_SELECTION_NOT_ALLOWED');
  return {
    p_search: typeof body.search === 'string' ? body.search.trim() : '',
    p_bucket: body.bucket as string,
    p_page: page,
    p_scope: scope,
  };
}
const stringFields = [
  'completed_at',
  'latest_hold_note',
  'ineligible_reason',
  'order_id',
  'payout_run_failed_at',
  'payout_run_failure_reason',
  'payout_run_id',
  'payout_run_paid_at',
  'payout_run_status',
  'retry_of_run_id',
  'seller_id',
  'seller_name',
  // Any string: an account gate code added later must still reach the admin.
  'seller_payout_block_reason',
  'shipment_id',
  'status',
  'stripe_account_id',
  'stripe_onboarding_status',
  'stripe_payment_intent_id',
  'stripe_transfer_id',
  'transfer_group',
];
function validRow(value: unknown): value is Record<string, unknown> {
  return (
    object(value) &&
    stringFields.every(
      (key) => value[key] === null || typeof value[key] === 'string',
    ) &&
    ['is_eligible', 'is_retryable', 'requires_manual_review'].every(
      (key) => value[key] === null || typeof value[key] === 'boolean',
    ) &&
    // The view always computes it; null would hide an overdue shipment.
    typeof value.is_payout_overdue === 'boolean' &&
    (value.latest_hold_noted_at === null ||
      (typeof value.latest_hold_noted_at === 'string' &&
        !Number.isNaN(Date.parse(value.latest_hold_noted_at)))) &&
    (value.latest_hold_noted_by === null ||
      (typeof value.latest_hold_noted_by === 'string' &&
        UUID.test(value.latest_hold_noted_by))) &&
    [
      'days_since_completed',
      'payout_run_amount_cents',
      'release_amount_cents',
    ].every(
      (key) =>
        value[key] === null ||
        (typeof value[key] === 'number' && Number.isSafeInteger(value[key])),
    )
  );
}
function validate(
  data: unknown,
  args: Args,
): asserts data is Record<string, unknown> {
  const fail = () => {
    throw Error('INVALID_QUEUE_RESPONSE');
  };
  if (!object(data)) return fail();
  const keys = [
    'rows',
    'counts',
    'bucket',
    'scope',
    'page',
    'pageSize',
    'totalGroups',
    'totalPages',
    'selectedGroupCount',
    'selectionComplete',
  ];
  if (
    Object.keys(data).length !== keys.length ||
    !keys.every((key) => key in data)
  )
    return fail();
  if (
    !Array.isArray(data.rows) ||
    !data.rows.every(validRow) ||
    !object(data.counts) ||
    Object.keys(data.counts).length !== buckets.length ||
    !buckets.every((key) =>
      integer((data.counts as Record<string, unknown>)[key]),
    )
  )
    return fail();
  if (
    data.bucket !== args.p_bucket ||
    data.scope !== args.p_scope ||
    data.pageSize !== 20 ||
    !integer(data.totalGroups) ||
    !integer(data.totalPages) ||
    !integer(data.page) ||
    !integer(data.selectedGroupCount)
  )
    return fail();
  if (
    data.totalGroups !== data.counts[data.bucket as string] ||
    data.totalPages !== Math.max(1, Math.ceil(data.totalGroups / 20))
  )
    return fail();
  // The same group keys as the SQL: a run-less overdue shipment leaves its seller's group.
  const groupIds = new Set(
    data.rows.map((row) =>
      row.payout_run_id !== null
        ? `run:${row.payout_run_id}`
        : row.is_payout_overdue === true
          ? `overdue:${row.seller_id}`
          : `seller:${row.seller_id}`,
    ),
  );
  if (
    data.rows.some(
      (row) => row.payout_run_id === null && typeof row.seller_id !== 'string',
    )
  )
    return fail();
  const expectedGroups =
    args.p_scope === 'selection'
      ? data.selectedGroupCount
      : Math.min(20, data.totalGroups - data.page * 20);
  if (groupIds.size !== expectedGroups) return fail();
  if (args.p_scope === 'selection') {
    if (
      data.selectionComplete !== true ||
      data.page !== 0 ||
      data.selectedGroupCount > data.totalGroups ||
      (data.selectedGroupCount === 0) !== (data.rows.length === 0)
    )
      return fail();
  } else if (
    data.selectionComplete !== false ||
    data.selectedGroupCount !== 0 ||
    data.page !== Math.min(args.p_page ?? 0, data.totalPages - 1) ||
    (data.totalGroups === 0) !== (data.rows.length === 0)
  )
    return fail();
}

/** Read-only handler; injected dependencies keep authorization and RPC tests offline. */
export function createQueueHandler(deps: QueueDependencies) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== 'POST') throw Error('METHOD_NOT_ALLOWED');
      const header = req.headers.get('Authorization');
      if (!header?.startsWith('Bearer ')) throw Error('AUTH_REQUIRED');
      const user = await deps.getUser(header.slice(7));
      if (!user) throw Error('AUTH_REQUIRED');
      assertAdminProfile(await deps.getProfile(user.id));
      const body = (await req.json().catch(() => ({}))) as { search?: unknown };
      if (object(body) && 'bucket' in body) {
        const args = parse(body);
        let data: unknown;
        try {
          data = await deps.rpc(args);
        } catch {
          throw Error('QUEUE_RPC_FAILED');
        }
        validate(data, args);
        return json({ success: true, ...data }, 200);
      }
      const search = typeof body.search === 'string' ? body.search.trim() : '';
      const rows = await deps.legacy(search);
      return json({ ...buildConnectPayoutReleaseQueue(rows), rows }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(
        { success: false, error: message },
        getQueueErrorStatus(message),
      );
    }
  };
}
