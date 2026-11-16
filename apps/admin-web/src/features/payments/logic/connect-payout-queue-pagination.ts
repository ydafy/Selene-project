import type {
  ConnectPayoutQueueBucket,
  ConnectPayoutQueueCounts,
  ConnectPayoutQueueScope,
  ConnectPayoutReleaseQueueRow,
} from '@selene/types';
import { isRecord } from '@/shared/utils/as-record';
import { OVERDUE_REFUND_CLOSED_RUN } from './overdue-payouts';

export interface PayoutQueueRequest {
  bucket: ConnectPayoutQueueBucket;
  scope: ConnectPayoutQueueScope;
  page: number;
}

export interface ValidatedPayoutQueueResponse extends PayoutQueueRequest {
  rows: ConnectPayoutReleaseQueueRow[];
  counts: ConnectPayoutQueueCounts;
  pageSize: 20;
  totalGroups: number;
  totalPages: number;
  selectedGroupCount: number;
  selectionComplete: boolean;
}

const buckets: readonly ConnectPayoutQueueBucket[] = [
  'ready',
  'overdue',
  'processing',
  'action-required',
  'history',
];
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const invalid = (): never => {
  throw new Error(
    'La cola recibida está incompleta o no corresponde a la consulta. Actualiza los datos.',
  );
};

/** Validates the additive RPC envelope; never upgrades a legacy response to a complete selection. */
export function validatePayoutQueueResponse(
  input: unknown,
  request: PayoutQueueRequest,
): ValidatedPayoutQueueResponse {
  if (
    !buckets.includes(request.bucket) ||
    !['page', 'selection'].includes(request.scope) ||
    !count(request.page) ||
    request.page > 2147483647 ||
    (request.scope === 'selection' &&
      !['ready', 'action-required'].includes(request.bucket)) ||
    !isRecord(input) ||
    input.success !== true ||
    input.bucket !== request.bucket ||
    input.scope !== request.scope ||
    !Array.isArray(input.rows) ||
    !isRecord(input.counts) ||
    !buckets.every((bucket) =>
      count(input.counts && (input.counts as Record<string, unknown>)[bucket]),
    ) ||
    !count(input.page) ||
    input.pageSize !== 20 ||
    !count(input.totalGroups) ||
    !count(input.totalPages) ||
    !count(input.selectedGroupCount) ||
    input.totalGroups !== input.counts[request.bucket] ||
    input.totalPages !== Math.max(1, Math.ceil(input.totalGroups / 20)) ||
    input.page !==
      (request.scope === 'selection'
        ? 0
        : Math.min(request.page, input.totalPages - 1)) ||
    input.selectionComplete !== (request.scope === 'selection') ||
    (request.scope === 'page' && input.selectedGroupCount !== 0) ||
    input.selectedGroupCount > input.totalGroups
  )
    return invalid();

  const groups = new Map<string, { selectable: boolean; signature: string }>();
  const shipments = new Set<string>();
  for (const value of input.rows) {
    if (!isRecord(value)) return invalid();
    const row = value as unknown as ConnectPayoutReleaseQueueRow;
    const runId = row.payout_run_id;
    if (runId !== null && (typeof runId !== 'string' || !runId))
      return invalid();
    if (!runId && (!row.seller_id || !row.shipment_id || !row.order_id))
      return invalid();
    // Mirrors fn_get_admin_payout_queue: a run-less overdue shipment has its own
    // group, and a run closed by the overdue refund is history (#549).
    const overdue = !runId && row.is_payout_overdue === true;
    const bucket: ConnectPayoutQueueBucket = !runId
      ? overdue
        ? 'overdue'
        : 'ready'
      : row.payout_run_status === 'paid' ||
          (row.payout_run_status === 'canceled' &&
            row.payout_run_failure_reason === OVERDUE_REFUND_CLOSED_RUN)
        ? 'history'
        : row.payout_run_status === 'pending_reconciliation'
          ? 'processing'
          : 'action-required';
    if (bucket !== request.bucket) return invalid();
    const groupId = runId
      ? `run:${runId}`
      : `${overdue ? 'overdue' : 'seller'}:${row.seller_id}`;
    if (row.shipment_id !== null) {
      if (
        typeof row.shipment_id !== 'string' ||
        !row.shipment_id ||
        shipments.has(row.shipment_id)
      )
        return invalid();
      shipments.add(row.shipment_id);
    }
    const amount = runId
      ? row.payout_run_amount_cents
      : row.release_amount_cents;
    if (amount !== null && !count(amount)) return invalid();
    // Nothing in the overdue bucket can be released.
    const selectable = runId
      ? row.payout_run_status === 'failed' && row.is_retryable === true
      : !overdue &&
        row.is_eligible === true &&
        (row.release_amount_cents ?? 0) > 0;
    const signature = JSON.stringify(
      runId
        ? [
            row.seller_id,
            row.payout_run_status,
            row.payout_run_amount_cents,
            row.is_retryable,
            row.retry_of_run_id,
            row.payout_run_paid_at,
          ]
        : [row.seller_id, row.stripe_account_id],
    );
    const previous = groups.get(groupId);
    if (previous && previous.signature !== signature) return invalid();
    groups.set(groupId, {
      signature,
      selectable: previous
        ? runId
          ? previous.selectable && selectable
          : previous.selectable || selectable
        : selectable,
    });
  }
  const expectedGroups =
    request.scope === 'selection'
      ? input.selectedGroupCount
      : Math.min(20, Math.max(0, input.totalGroups - input.page * 20));
  if (
    groups.size !== expectedGroups ||
    (request.scope === 'selection' &&
      [...groups.values()].some((group) => !group.selectable))
  )
    return invalid();

  // This proves envelope/group consistency, not independent transport authenticity
  // or freshness. Financial callers must fetch and compare fresh selected details.
  return {
    bucket: request.bucket,
    scope: request.scope,
    page: input.page,
    rows: input.rows as ConnectPayoutReleaseQueueRow[],
    counts: input.counts as ConnectPayoutQueueCounts,
    pageSize: 20,
    totalGroups: input.totalGroups,
    totalPages: input.totalPages,
    selectedGroupCount: input.selectedGroupCount,
    selectionComplete: input.selectionComplete,
  };
}
