import { describe, expect, it } from 'bun:test';

import {
  buildReleasePayload,
  getSelectedEligibleShipmentIds,
  groupConnectPayoutReleaseQueue,
  mapConnectPayoutReleaseQueue,
  type ReleaseQueueActionRequiredRun,
  type ReleaseQueueRun,
} from './connectPayoutReleaseQueue';
import type { ConnectPayoutReleaseQueueRow } from '@selene/types';

type QueueRow = ConnectPayoutReleaseQueueRow & {
  payout_run_id: string | null;
  payout_run_status: string | null;
  payout_run_amount_cents: number | null;
  payout_run_failure_reason: string | null;
  payout_run_failed_at: string | null;
  retry_of_run_id: string | null;
  is_retryable: boolean;
  requires_manual_review: boolean;
};

const row = (overrides: Partial<QueueRow>): QueueRow => ({
  completed_at: '2026-06-22T10:00:00.000Z',
  ineligible_reason: null,
  is_eligible: true,
  is_retryable: false,
  order_id: 'order-1',
  payout_run_amount_cents: null,
  payout_run_failed_at: null,
  payout_run_failure_reason: null,
  payout_run_id: null,
  payout_run_status: null,
  release_amount_cents: 12500,
  requires_manual_review: false,
  retry_of_run_id: null,
  seller_id: 'seller-1',
  seller_name: 'Selene Seller',
  shipment_id: 'shipment-1',
  status: 'completed',
  stripe_account_id: 'acct_123',
  stripe_onboarding_status: 'completed',
  stripe_payment_intent_id: 'pi_123',
  ...overrides,
});

const runRow = (overrides: Partial<QueueRow>): QueueRow =>
  row({
    shipment_id: null,
    order_id: null,
    payout_run_id: 'run-1',
    payout_run_amount_cents: 12_500,
    ...overrides,
  });

const runIdentity = {
  runId: 'run-1',
  retryOfRunId: null,
  sellerId: 'seller-1',
  sellerName: 'Selene Seller',
  amountCents: 12_500,
};

describe('connect payout release queue shipment batching', () => {
  it('groups eligible seller shipments into release-ready batches', () => {
    const batches = groupConnectPayoutReleaseQueue([
      row({ shipment_id: 'shipment-1', release_amount_cents: 12_500 }),
      row({ shipment_id: 'shipment-2', release_amount_cents: 8_000 }),
    ]);

    expect(batches).toEqual([
      {
        sellerId: 'seller-1',
        sellerName: 'Selene Seller',
        stripeAccountId: 'acct_123',
        totalEligibleAmountCents: 20_500,
        eligibleShipmentCount: 2,
        ineligibleShipmentCount: 0,
        releaseState: 'ready',
        shipments: [
          {
            completedAt: '2026-06-22T10:00:00.000Z',
            ineligibleReason: null,
            isEligible: true,
            orderId: 'order-1',
            releaseAmountCents: 12_500,
            reconciliationIndicator: 'ready_for_release',
            shipmentId: 'shipment-1',
            status: 'completed',
            stripePaymentIntentId: 'pi_123',
          },
          {
            completedAt: '2026-06-22T10:00:00.000Z',
            ineligibleReason: null,
            isEligible: true,
            orderId: 'order-1',
            releaseAmountCents: 8_000,
            reconciliationIndicator: 'ready_for_release',
            shipmentId: 'shipment-2',
            status: 'completed',
            stripePaymentIntentId: 'pi_123',
          },
        ],
      },
    ]);
  });

  it('keeps ineligible shipments disabled with reasons and blocked indicators', () => {
    const batches = groupConnectPayoutReleaseQueue([
      row({ shipment_id: 'shipment-ready', release_amount_cents: 10_000 }),
      row({
        shipment_id: 'shipment-blocked',
        is_eligible: false,
        ineligible_reason: 'ACTIVE_DISPUTE',
        release_amount_cents: 9_000,
      }),
    ]);

    expect(batches[0]).toMatchObject({
      totalEligibleAmountCents: 10_000,
      eligibleShipmentCount: 1,
      ineligibleShipmentCount: 1,
      releaseState: 'partial',
    });
    expect(batches[0].shipments[1]).toMatchObject({
      shipmentId: 'shipment-blocked',
      isEligible: false,
      ineligibleReason: 'ACTIVE_DISPUTE',
      reconciliationIndicator: 'blocked',
    });
  });

  it('builds a release payload only from selected eligible shipments', () => {
    const batches = groupConnectPayoutReleaseQueue([
      row({ shipment_id: 'shipment-a', release_amount_cents: 10_000 }),
      row({ shipment_id: 'shipment-b', release_amount_cents: 15_000 }),
      row({
        shipment_id: 'shipment-c',
        is_eligible: false,
        ineligible_reason: 'SELLER_PAYOUT_NOT_READY',
        release_amount_cents: 20_000,
      }),
    ]);

    const selectedShipmentIds = getSelectedEligibleShipmentIds(batches[0], [
      'shipment-a',
      'shipment-c',
    ]);

    expect(selectedShipmentIds).toEqual(['shipment-a']);
    expect(
      buildReleasePayload({
        batch: batches[0],
        selectedShipmentIds,
        idempotencyKey: 'release-key-1',
      }),
    ).toEqual({
      sellerId: 'seller-1',
      shipmentIds: ['shipment-a'],
      idempotencyKey: 'release-key-1',
    });
  });

  it('marks sellers without eligible selectable shipments as blocked', () => {
    const batches = groupConnectPayoutReleaseQueue([
      row({
        shipment_id: 'shipment-blocked',
        is_eligible: false,
        ineligible_reason: 'MISSING_STRIPE_ACCOUNT',
      }),
    ]);

    expect(batches[0]).toMatchObject({
      totalEligibleAmountCents: 0,
      eligibleShipmentCount: 0,
      ineligibleShipmentCount: 1,
      releaseState: 'blocked',
    });
  });
});

describe('connect payout release queue bucket classification', () => {
  it('places paid payout runs in the read-only history bucket exactly once', () => {
    const queue = mapConnectPayoutReleaseQueue([
      runRow({ payout_run_id: 'run-1', payout_run_status: 'paid' }),
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'paid',
        shipment_id: 'shipment-2',
        order_id: 'order-2',
      }),
    ]);

    expect(queue.historyRuns).toEqual([
      { ...runIdentity, status: 'paid' } satisfies ReleaseQueueRun,
    ]);
    expect(queue.processingRuns).toEqual([]);
    expect(queue.actionRequiredRuns).toEqual([]);
    expect(queue.releaseBatches).toEqual([]);
    expect(queue.historyRuns[0]).not.toHaveProperty('canRetry');
  });

  it('places pending_reconciliation payout runs in the read-only processing bucket', () => {
    const queue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'pending_reconciliation',
      }),
    ]);

    expect(queue.processingRuns).toEqual([
      { ...runIdentity, status: 'pending_reconciliation' } satisfies ReleaseQueueRun,
    ]);
    expect(queue.actionRequiredRuns).toEqual([]);
    expect(queue.historyRuns).toEqual([]);
    expect(queue.releaseBatches).toEqual([]);
  });

  it('places reconciliation_needed payout runs in action required without retry authority', () => {
    const queue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'reconciliation_needed',
        is_retryable: true,
      }),
    ]);

    expect(queue.actionRequiredRuns).toEqual([
      {
        ...runIdentity,
        status: 'reconciliation_needed',
        reason: 'reconciliation_needed',
        canRetry: false,
        failureReason: null,
        failedAt: null,
      } satisfies ReleaseQueueActionRequiredRun,
    ]);
    expect(queue.processingRuns).toEqual([]);
    expect(queue.historyRuns).toEqual([]);
  });

  it('exposes the retry action only for explicitly retryable failed runs', () => {
    const retryableQueue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'failed',
        is_retryable: true,
        payout_run_failure_reason: 'bank_account_closed',
        payout_run_failed_at: '2026-06-23T10:00:00.000Z',
      }),
    ]);

    expect(retryableQueue.actionRequiredRuns).toEqual([
      {
        ...runIdentity,
        status: 'failed',
        reason: 'retryable_failed',
        canRetry: true,
        failureReason: 'bank_account_closed',
        failedAt: '2026-06-23T10:00:00.000Z',
      } satisfies ReleaseQueueActionRequiredRun,
    ]);

    const blockedQueue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'failed',
        is_retryable: false,
        payout_run_failure_reason: 'bank_account_closed',
        payout_run_failed_at: '2026-06-23T10:00:00.000Z',
      }),
    ]);

    expect(blockedQueue.actionRequiredRuns).toEqual([
      {
        ...runIdentity,
        status: 'failed',
        reason: 'failed',
        canRetry: false,
        failureReason: 'bank_account_closed',
        failedAt: '2026-06-23T10:00:00.000Z',
      } satisfies ReleaseQueueActionRequiredRun,
    ]);
  });

  it('places canceled manual-review runs in action required without retry authority', () => {
    const queue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'canceled',
        requires_manual_review: true,
      }),
    ]);

    expect(queue.actionRequiredRuns).toEqual([
      {
        ...runIdentity,
        status: 'canceled',
        reason: 'manual_review',
        canRetry: false,
        failureReason: null,
        failedAt: null,
      } satisfies ReleaseQueueActionRequiredRun,
    ]);
    expect(queue.processingRuns).toEqual([]);
    expect(queue.historyRuns).toEqual([]);
  });

  it('places unrecognized payout run statuses in action required as a safety default', () => {
    const queue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'mystery_stage',
      }),
    ]);

    expect(queue.actionRequiredRuns).toEqual([
      {
        ...runIdentity,
        status: 'mystery_stage',
        reason: 'unexpected_status',
        canRetry: false,
        failureReason: null,
        failedAt: null,
      } satisfies ReleaseQueueActionRequiredRun,
    ]);
    expect(queue.processingRuns).toEqual([]);
    expect(queue.historyRuns).toEqual([]);
  });

  it('does not drop any returned payout run and assigns each to exactly one bucket', () => {
    const rows = [
      row({ shipment_id: 'shipment-1', release_amount_cents: 12_500 }),
      row({
        shipment_id: 'shipment-2',
        seller_id: 'seller-1',
        payout_run_id: 'run-paid',
        payout_run_status: 'paid',
        payout_run_amount_cents: 9_000,
      }),
      runRow({
        payout_run_id: 'run-processing',
        payout_run_status: 'pending_reconciliation',
        payout_run_amount_cents: 7_000,
      }),
      runRow({
        payout_run_id: 'run-reconciliation',
        payout_run_status: 'reconciliation_needed',
        payout_run_amount_cents: 6_000,
      }),
      runRow({
        payout_run_id: 'run-retryable',
        payout_run_status: 'failed',
        is_retryable: true,
        payout_run_amount_cents: 5_000,
      }),
      runRow({
        payout_run_id: 'run-review',
        payout_run_status: 'canceled',
        requires_manual_review: true,
        payout_run_amount_cents: 4_000,
      }),
    ];

    const queue = mapConnectPayoutReleaseQueue(rows);

    const bucketedRunIds = [
      ...queue.processingRuns.map((item) => item.runId),
      ...queue.actionRequiredRuns.map((item) => item.runId),
      ...queue.historyRuns.map((item) => item.runId),
    ];
    const runRowIds = [
      'run-paid',
      'run-processing',
      'run-reconciliation',
      'run-retryable',
      'run-review',
    ];

    expect(bucketedRunIds.sort()).toEqual([...runRowIds].sort());
    expect(new Set(bucketedRunIds).size).toBe(bucketedRunIds.length);
    expect(queue.releaseBatches).toHaveLength(1);
    expect(queue.releaseBatches[0].shipments[0]).toMatchObject({
      shipmentId: 'shipment-1',
      isEligible: true,
    });
  });

  it('deduplicates multi-row runs inside their single destination bucket', () => {
    const queue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'pending_reconciliation',
      }),
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'pending_reconciliation',
      }),
    ]);

    expect(queue.processingRuns).toHaveLength(1);
    expect(queue.actionRequiredRuns).toHaveLength(0);
    expect(queue.historyRuns).toHaveLength(0);
  });

  it('keeps payout runs without a seller operator-visible instead of dropping them', () => {
    const queue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-orphan',
        seller_id: null,
        seller_name: null,
        payout_run_status: 'paid',
      }),
    ]);

    expect(queue.historyRuns).toEqual([
      {
        runId: 'run-orphan',
        retryOfRunId: null,
        sellerId: null,
        sellerName: null,
        status: 'paid',
        amountCents: 12_500,
      } satisfies ReleaseQueueRun,
    ]);
    expect(queue.processingRuns).toEqual([]);
    expect(queue.actionRequiredRuns).toEqual([]);
    expect(queue.releaseBatches).toEqual([]);
  });

  it('selects one conservative action-required bucket for a run with contradictory duplicate rows', () => {
    const queue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'paid',
      }),
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'mystery_stage',
      }),
    ]);

    expect(queue.historyRuns).toEqual([]);
    expect(queue.processingRuns).toEqual([]);
    expect(queue.actionRequiredRuns).toEqual([
      {
        ...runIdentity,
        status: 'mystery_stage',
        reason: 'unexpected_status',
        canRetry: false,
        failureReason: null,
        failedAt: null,
      } satisfies ReleaseQueueActionRequiredRun,
    ]);
  });

  it('keeps the first observation for consistent duplicate run rows', () => {
    const queue = mapConnectPayoutReleaseQueue([
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'paid',
        payout_run_amount_cents: 9_000,
      }),
      runRow({
        payout_run_id: 'run-1',
        payout_run_status: 'paid',
        payout_run_amount_cents: 12_500,
      }),
    ]);

    expect(queue.historyRuns).toEqual([
      {
        ...runIdentity,
        amountCents: 9_000,
        status: 'paid',
      } satisfies ReleaseQueueRun,
    ]);
    expect(queue.processingRuns).toEqual([]);
    expect(queue.actionRequiredRuns).toEqual([]);
  });
});
