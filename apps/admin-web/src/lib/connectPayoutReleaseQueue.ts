import type {
  ConnectPayoutReleaseQueueRow,
  ConnectPayoutReleaseRequest,
} from '@selene/types';

export type ReleaseQueueShipmentIndicator = 'ready_for_release' | 'blocked';

export type ReleaseQueueBatchState = 'ready' | 'partial' | 'blocked';

export interface ReleaseQueueShipment {
  completedAt: string | null;
  ineligibleReason: string | null;
  isEligible: boolean;
  orderId: string;
  releaseAmountCents: number;
  reconciliationIndicator: ReleaseQueueShipmentIndicator;
  shipmentId: string;
  status: string | null;
  stripePaymentIntentId: string | null;
}

export interface ReleaseQueueBatch {
  sellerId: string;
  sellerName: string | null;
  stripeAccountId: string | null;
  totalEligibleAmountCents: number;
  eligibleShipmentCount: number;
  ineligibleShipmentCount: number;
  releaseState: ReleaseQueueBatchState;
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
}

/**
 * Why a payout run needs operator attention. Only `retryable_failed` runs
 * carry retry authority; every other reason is presentation-only.
 */
export type ReleaseQueueActionRequiredReason =
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
        shipments: [],
      } satisfies ReleaseQueueBatch);

    batch.shipments.push({
      completedAt: row.completed_at,
      ineligibleReason: isEligible
        ? null
        : (row.ineligible_reason ?? 'NOT_ELIGIBLE'),
      isEligible,
      orderId: row.order_id,
      releaseAmountCents,
      reconciliationIndicator: isEligible ? 'ready_for_release' : 'blocked',
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
export function classifyPayoutRunRow(row: ConnectPayoutReleaseQueueRow): {
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

  switch (run.status) {
    case 'paid':
      return { history: run };
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

  for (const row of rows) {
    if (!row.payout_run_id) continue;

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

  for (const { destination } of classificationByRun.values()) {
    if (destination.actionRequired) {
      actionRequiredRuns.push(destination.actionRequired);
    } else if (destination.processing) {
      processingRuns.push(destination.processing);
    } else if (destination.history) {
      historyRuns.push(destination.history);
    }
  }

  return {
    releaseBatches: groupConnectPayoutReleaseQueue(
      rows.filter((row) => !row.payout_run_id),
    ),
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
