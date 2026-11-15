import type {
  ConnectPayoutReleaseQueueRow,
  ConnectPayoutReleaseRequest,
} from '@selene/types';
import { OVERDUE_REFUND_CLOSED_RUN } from './overdue-payouts';

type ReleaseQueueShipmentIndicator = 'ready_for_release' | 'blocked';

type ReleaseQueueBatchState = 'ready' | 'partial' | 'blocked';

interface ReleaseQueueShipment {
  completedAt: string | null;
  /** Whole days since `completedAt`; null until the shipment completes. */
  daysSinceCompleted: number | null;
  ineligibleReason: string | null;
  isEligible: boolean;
  orderId: string;
  releaseAmountCents: number;
  reconciliationIndicator: ReleaseQueueShipmentIndicator;
  /**
   * Why Stripe cannot pay the seller's account, as the view's code. Display
   * only: `isEligible` still decides selection, and release re-checks the
   * account gate on the server.
   */
  sellerPayoutBlockReason: string | null;
  shipmentId: string;
  status: string | null;
  stripePaymentIntentId: string | null;
}

/** The newest note an admin wrote to keep an overdue payout on hold. */
interface PayoutHoldNote {
  note: string;
  notedAt: string;
  /** The admin's user id; the queue carries no name. */
  notedBy: string;
}

/**
 * A completed, never-transferred shipment held 30 days or more because the
 * seller's account cannot be paid, and not inside a payout run (#549). It is
 * never selectable for release.
 */
export interface OverduePayout {
  shipmentId: string;
  orderId: string;
  sellerId: string;
  sellerName: string | null;
  stripeAccountId: string | null;
  sellerPayoutBlockReason: string | null;
  daysSinceCompleted: number | null;
  completedAt: string | null;
  /** Integer cents the seller would be paid; not the buyer refund amount. */
  heldAmountCents: number;
  latestHoldNote: PayoutHoldNote | null;
}

export interface ReleaseQueueBatch {
  sellerId: string;
  sellerName: string | null;
  stripeAccountId: string | null;
  totalEligibleAmountCents: number;
  eligibleShipmentCount: number;
  ineligibleShipmentCount: number;
  releaseState: ReleaseQueueBatchState;
  /** The first non-null shipment block reason; it describes the seller's account. */
  sellerPayoutBlockReason: string | null;
  shipments: ReleaseQueueShipment[];
}

/** Payout run surfaced in a read-only bucket (Processing or History). */
export interface ReleaseQueueRun {
  runId: string;
  retryOfRunId: string | null;
  /**
   * Seller attribution is presentation data, not run identity: a row can
   * carry a payout run without a joinable seller, and such a run must stay
   * operator-visible rather than being silently dropped.
   */
  sellerId: string | null;
  sellerName: string | null;
  status: string;
  amountCents: number;
  /** Observed Stripe payment time, exposed only for History; never bank finality. */
  paidAt?: string | null;
  /** Shipments of this run that are overdue held payouts; absent when none. */
  overdueShipmentCount?: number;
}

/**
 * Why a payout run needs operator attention. Only `retryable_failed` runs
 * carry retry authority; every other reason is presentation-only.
 */
type ReleaseQueueActionRequiredReason =
  | 'reconciliation_needed'
  | 'retryable_failed'
  | 'failed'
  | 'canceled'
  | 'manual_review'
  | 'unexpected_status';

export interface ReleaseQueueActionRequiredRun extends ReleaseQueueRun {
  reason: ReleaseQueueActionRequiredReason;
  canRetry: boolean;
  failureReason: string | null;
  failedAt: string | null;
}

/**
 * Operator-visible presentation buckets for the payout release lifecycle.
 * Every returned payout run lands in exactly one of the three run buckets;
 * rows without a payout run feed the Ready release batches.
 */
export interface ConnectPayoutReleaseQueue {
  releaseBatches: ReleaseQueueBatch[];
  overduePayouts: OverduePayout[];
  processingRuns: ReleaseQueueRun[];
  actionRequiredRuns: ReleaseQueueActionRequiredRun[];
  historyRuns: ReleaseQueueRun[];
}

interface BuildReleasePayloadInput {
  batch: ReleaseQueueBatch;
  selectedShipmentIds: string[];
  idempotencyKey: string;
}

function isSelectableReleaseRow(row: ConnectPayoutReleaseQueueRow): boolean {
  return Boolean(
    row.is_eligible &&
    row.seller_id &&
    row.shipment_id &&
    row.order_id &&
    (row.release_amount_cents ?? 0) > 0,
  );
}

function resolveBatchState(
  eligibleShipmentCount: number,
  ineligibleShipmentCount: number,
): ReleaseQueueBatchState {
  if (eligibleShipmentCount === 0) return 'blocked';
  if (ineligibleShipmentCount > 0) return 'partial';
  return 'ready';
}

export function groupConnectPayoutReleaseQueue(
  rows: ConnectPayoutReleaseQueueRow[],
): ReleaseQueueBatch[] {
  const batchBySeller = new Map<string, ReleaseQueueBatch>();

  for (const row of rows) {
    if (!row.seller_id || !row.shipment_id || !row.order_id) continue;

    const isEligible = isSelectableReleaseRow(row);
    const releaseAmountCents = row.release_amount_cents ?? 0;
    const existing = batchBySeller.get(row.seller_id);
    const batch =
      existing ??
      ({
        sellerId: row.seller_id,
        sellerName: row.seller_name,
        stripeAccountId: row.stripe_account_id,
        totalEligibleAmountCents: 0,
        eligibleShipmentCount: 0,
        ineligibleShipmentCount: 0,
        releaseState: 'blocked',
        sellerPayoutBlockReason: null,
        shipments: [],
      } satisfies ReleaseQueueBatch);

    batch.sellerPayoutBlockReason ??= row.seller_payout_block_reason;
    batch.shipments.push({
      completedAt: row.completed_at,
      daysSinceCompleted: row.days_since_completed,
      ineligibleReason: isEligible
        ? null
        : (row.ineligible_reason ?? 'NOT_ELIGIBLE'),
      isEligible,
      orderId: row.order_id,
      releaseAmountCents,
      reconciliationIndicator: isEligible ? 'ready_for_release' : 'blocked',
      sellerPayoutBlockReason: row.seller_payout_block_reason,
      shipmentId: row.shipment_id,
      status: row.status,
      stripePaymentIntentId: row.stripe_payment_intent_id,
    });

    if (isEligible) {
      batch.eligibleShipmentCount += 1;
      batch.totalEligibleAmountCents += releaseAmountCents;
    } else {
      batch.ineligibleShipmentCount += 1;
    }
    batch.releaseState = resolveBatchState(
      batch.eligibleShipmentCount,
      batch.ineligibleShipmentCount,
    );

    batchBySeller.set(row.seller_id, batch);
  }

  return Array.from(batchBySeller.values()).sort((left, right) =>
    (left.sellerName ?? left.sellerId).localeCompare(
      right.sellerName ?? right.sellerId,
    ),
  );
}

/**
 * Classifies one payout run row into its read-only/action destination.
 * Classification order matters: `paid` is terminal history, in-flight
 * reconciliation states are processing, and every other run is surfaced to
 * the operator under Action required. Unrecognized statuses default to
 * Action required so no run row is ever silently dropped. A missing seller
 * attribution never blocks classification.
 */
function classifyPayoutRunRow(row: ConnectPayoutReleaseQueueRow): {
  processing?: ReleaseQueueRun;
  actionRequired?: ReleaseQueueActionRequiredRun;
  history?: ReleaseQueueRun;
} {
  if (!row.payout_run_id) return {};

  const run = {
    runId: row.payout_run_id,
    retryOfRunId: row.retry_of_run_id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    status: row.payout_run_status ?? 'unknown',
    amountCents: row.payout_run_amount_cents ?? 0,
  } satisfies ReleaseQueueRun;

  if (
    run.status === 'canceled' &&
    row.payout_run_failure_reason === OVERDUE_REFUND_CLOSED_RUN
  )
    return { history: { ...run, paidAt: null } };

  switch (run.status) {
    case 'paid':
      return { history: { ...run, paidAt: row.payout_run_paid_at ?? null } };
    case 'pending_reconciliation':
      return { processing: run };
    case 'reconciliation_needed':
      return {
        actionRequired: {
          ...run,
          reason: 'reconciliation_needed',
          canRetry: false,
          failureReason: row.payout_run_failure_reason,
          failedAt: row.payout_run_failed_at,
        },
      };
    case 'failed':
      return {
        actionRequired: {
          ...run,
          reason: row.is_retryable ? 'retryable_failed' : 'failed',
          canRetry: Boolean(row.is_retryable),
          failureReason: row.payout_run_failure_reason,
          failedAt: row.payout_run_failed_at,
        },
      };
    case 'canceled':
      return {
        actionRequired: {
          ...run,
          reason: row.requires_manual_review ? 'manual_review' : 'canceled',
          canRetry: false,
          failureReason: row.payout_run_failure_reason,
          failedAt: row.payout_run_failed_at,
        },
      };
    default:
      return {
        actionRequired: {
          ...run,
          reason: 'unexpected_status',
          canRetry: false,
          failureReason: row.payout_run_failure_reason,
          failedAt: row.payout_run_failed_at,
        },
      };
  }
}

function toOverduePayout(row: ConnectPayoutReleaseQueueRow): OverduePayout[] {
  if (
    row.payout_run_id ||
    row.is_payout_overdue !== true ||
    !row.seller_id ||
    !row.shipment_id ||
    !row.order_id
  )
    return [];
  return [
    {
      shipmentId: row.shipment_id,
      orderId: row.order_id,
      sellerId: row.seller_id,
      sellerName: row.seller_name,
      stripeAccountId: row.stripe_account_id,
      sellerPayoutBlockReason: row.seller_payout_block_reason,
      daysSinceCompleted: row.days_since_completed,
      completedAt: row.completed_at,
      heldAmountCents: row.release_amount_cents ?? 0,
      latestHoldNote:
        row.latest_hold_note &&
        row.latest_hold_noted_at &&
        row.latest_hold_noted_by
          ? {
              note: row.latest_hold_note,
              notedAt: row.latest_hold_noted_at,
              notedBy: row.latest_hold_noted_by,
            }
          : null,
    },
  ];
}

export function mapConnectPayoutReleaseQueue(
  rows: ConnectPayoutReleaseQueueRow[],
): ConnectPayoutReleaseQueue {
  const processingRuns: ReleaseQueueRun[] = [];
  const actionRequiredRuns: ReleaseQueueActionRequiredRun[] = [];
  const historyRuns: ReleaseQueueRun[] = [];

  /**
   * Escalation rank for deduplicating rows of one payout run. A run whose
   * duplicate rows disagree is kept in the most conservative bucket:
   * Action required outranks Processing, which outranks History, so
   * conflicting evidence always surfaces for operator attention instead of
   * hiding behind a terminal or in-flight appearance.
   */
  const bucketRank = { history: 0, processing: 1, actionRequired: 2 } as const;

  type ClassifiedRun = {
    rank: (typeof bucketRank)[keyof typeof bucketRank];
    destination: ReturnType<typeof classifyPayoutRunRow>;
  };

  const classificationByRun = new Map<string, ClassifiedRun>();
  const overdueByRun = new Map<string, number>();

  for (const row of rows) {
    if (!row.payout_run_id) continue;
    if (row.is_payout_overdue === true)
      overdueByRun.set(
        row.payout_run_id,
        (overdueByRun.get(row.payout_run_id) ?? 0) + 1,
      );

    const destination = classifyPayoutRunRow(row);
    const bucket = destination.actionRequired
      ? 'actionRequired'
      : destination.processing
        ? 'processing'
        : destination.history
          ? 'history'
          : null;
    if (!bucket) continue;

    const existing = classificationByRun.get(row.payout_run_id);
    const rank = bucketRank[bucket];
    // First observation wins inside a bucket; a more conservative bucket
    // replaces a less conservative one when duplicate rows conflict.
    if (!existing || rank > existing.rank) {
      classificationByRun.set(row.payout_run_id, { rank, destination });
    }
  }

  const withOverdue = <T extends ReleaseQueueRun>(run: T): T => {
    const count = overdueByRun.get(run.runId) ?? 0;
    return count > 0 ? { ...run, overdueShipmentCount: count } : run;
  };
  for (const { destination } of classificationByRun.values()) {
    if (destination.actionRequired) {
      actionRequiredRuns.push(withOverdue(destination.actionRequired));
    } else if (destination.processing) {
      processingRuns.push(withOverdue(destination.processing));
    } else if (destination.history) {
      historyRuns.push(withOverdue(destination.history));
    }
  }

  const paymentTime = (run: ReleaseQueueRun) => {
    const timestamp = run.paidAt ? Date.parse(run.paidAt) : NaN;
    return Number.isFinite(timestamp) ? timestamp : -Infinity;
  };
  historyRuns.sort((left, right) => {
    const leftTime = paymentTime(left);
    const rightTime = paymentTime(right);
    if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;
    return left.runId === right.runId ? 0 : left.runId > right.runId ? -1 : 1;
  });

  return {
    releaseBatches: groupConnectPayoutReleaseQueue(
      rows.filter(
        (row) => !row.payout_run_id && row.is_payout_overdue !== true,
      ),
    ),
    overduePayouts: rows.flatMap(toOverduePayout),
    processingRuns,
    actionRequiredRuns,
    historyRuns,
  };
}

export function getSelectedEligibleShipmentIds(
  batch: ReleaseQueueBatch,
  selectedShipmentIds: string[],
): string[] {
  const selected = new Set(selectedShipmentIds);

  return batch.shipments
    .filter(
      (shipment) => shipment.isEligible && selected.has(shipment.shipmentId),
    )
    .map((shipment) => shipment.shipmentId);
}

export function buildReleasePayload({
  batch,
  selectedShipmentIds,
  idempotencyKey,
}: BuildReleasePayloadInput): ConnectPayoutReleaseRequest {
  return {
    sellerId: batch.sellerId,
    shipmentIds: selectedShipmentIds,
    idempotencyKey,
  };
}

export function createReleaseIdempotencyKey(
  sellerId: string,
  shipmentIds: string[],
): string {
  return `admin-release:${sellerId}:${[...shipmentIds].sort().join(',')}`;
}
