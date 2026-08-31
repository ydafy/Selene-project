export type ConnectPayoutRunStatus =
  | 'pending_reconciliation'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'reconciliation_needed';

export type ConnectPayoutEventType =
  'payout.paid' | 'payout.failed' | 'payout.canceled';

export interface ConnectPayoutRunForReconciliation {
  id: string;
  status: ConnectPayoutRunStatus | string;
  stripe_payout_id: string | null;
}

export interface ConnectPayoutReconciliationInput {
  eventType: ConnectPayoutEventType;
  payoutId: string;
  metadataRunId?: string | null;
  occurredAt: string;
  failureReason?: string | null;
}

export interface ConnectPayoutReconciliationDeps {
  findRunForPayout: (input: {
    payoutId: string;
    metadataRunId?: string | null;
  }) => Promise<ConnectPayoutRunForReconciliation | null>;
  listRunShipmentIds: (runId: string) => Promise<string[]>;
  markRunStatus: (input: {
    runId: string;
    status: Exclude<
      ConnectPayoutRunStatus,
      'pending_reconciliation' | 'reconciliation_needed'
    >;
    occurredAt: string;
    failureReason?: string | null;
  }) => Promise<void>;
  markRunShipmentsStatus: (input: {
    runId: string;
    status: Exclude<
      ConnectPayoutRunStatus,
      'pending_reconciliation' | 'reconciliation_needed'
    >;
  }) => Promise<void>;
  markShipmentsReleased: (input: {
    shipmentIds: string[];
    stripePayoutId: string;
  }) => Promise<void>;
  markRunReconciliationNeeded: (input: {
    runId: string;
    failureReason: string;
  }) => Promise<void>;
  attachRunPayoutId: (input: {
    runId: string;
    stripePayoutId: string;
  }) => Promise<void>;
}

export type ConnectPayoutReconciliationResult =
  | { status: 'ignored'; reason: 'run_not_found' }
  | { status: 'ignored'; reason: 'payout_id_mismatch' }
  | { status: 'already_reconciled'; runId: string }
  | { status: 'reconciled'; runId: string }
  | { status: 'reconciliation_needed'; runId: string };

function toTargetStatus(
  eventType: ConnectPayoutEventType,
): Exclude<
  ConnectPayoutRunStatus,
  'pending_reconciliation' | 'reconciliation_needed'
> {
  if (eventType === 'payout.paid') return 'paid';
  if (eventType === 'payout.failed') return 'failed';
  return 'canceled';
}

function toFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecoverableMissingPayoutIdStatus(status: string): boolean {
  return (
    status === 'pending_reconciliation' || status === 'reconciliation_needed'
  );
}

export async function reconcileConnectPayoutEvent(
  input: ConnectPayoutReconciliationInput,
  deps: ConnectPayoutReconciliationDeps,
): Promise<ConnectPayoutReconciliationResult> {
  const run = await deps.findRunForPayout({
    payoutId: input.payoutId,
    metadataRunId: input.metadataRunId,
  });

  if (!run) return { status: 'ignored', reason: 'run_not_found' };

  if (run.stripe_payout_id === null) {
    if (
      !input.metadataRunId ||
      input.metadataRunId !== run.id ||
      !isRecoverableMissingPayoutIdStatus(run.status)
    ) {
      return { status: 'ignored', reason: 'payout_id_mismatch' };
    }

    try {
      await deps.attachRunPayoutId({
        runId: run.id,
        stripePayoutId: input.payoutId,
      });
    } catch (error) {
      await deps.markRunReconciliationNeeded({
        runId: run.id,
        failureReason: toFailureReason(error),
      });
      return { status: 'reconciliation_needed', runId: run.id };
    }
  } else if (run.stripe_payout_id !== input.payoutId) {
    return { status: 'ignored', reason: 'payout_id_mismatch' };
  }

  const targetStatus = toTargetStatus(input.eventType);
  if (run.status === targetStatus) {
    return { status: 'already_reconciled', runId: run.id };
  }

  try {
    await deps.markRunShipmentsStatus({ runId: run.id, status: targetStatus });

    if (targetStatus === 'paid') {
      const shipmentIds = await deps.listRunShipmentIds(run.id);
      await deps.markShipmentsReleased({
        shipmentIds,
        stripePayoutId: input.payoutId,
      });
    }

    await deps.markRunStatus({
      runId: run.id,
      status: targetStatus,
      occurredAt: input.occurredAt,
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    });

    return { status: 'reconciled', runId: run.id };
  } catch (error) {
    await deps.markRunReconciliationNeeded({
      runId: run.id,
      failureReason: toFailureReason(error),
    });
    return { status: 'reconciliation_needed', runId: run.id };
  }
}
