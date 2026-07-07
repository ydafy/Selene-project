import { describe, expect, it } from 'bun:test';

import {
  reconcileConnectPayoutEvent,
  type ConnectPayoutReconciliationDeps,
} from './connect-payout-reconciliation';

function createDeps(overrides: Partial<ConnectPayoutReconciliationDeps> = {}) {
  const calls = {
    runStatuses: [] as unknown[],
    mappingStatuses: [] as unknown[],
    shipmentReleases: [] as unknown[],
    reconciliationNeeded: [] as unknown[],
    payoutAttachments: [] as unknown[],
  };

  const deps: ConnectPayoutReconciliationDeps & { calls: typeof calls } = {
    calls,
    findRunForPayout: async () => ({
      id: 'run-1',
      status: 'pending_reconciliation',
      stripe_payout_id: 'po_123',
    }),
    listRunShipmentIds: async () => ['shipment-1', 'shipment-2'],
    markRunStatus: async (input) => {
      calls.runStatuses.push(input);
    },
    markRunShipmentsStatus: async (input) => {
      calls.mappingStatuses.push(input);
    },
    markShipmentsReleased: async (input) => {
      calls.shipmentReleases.push(input);
    },
    markRunReconciliationNeeded: async (input) => {
      calls.reconciliationNeeded.push(input);
    },
    attachRunPayoutId: async (input) => {
      calls.payoutAttachments.push(input);
    },
    ...overrides,
  };

  return deps;
}

describe('reconcileConnectPayoutEvent', () => {
  it('marks a paid payout run, mapping rows, and linked shipments exactly once', async () => {
    const deps = createDeps();

    await expect(
      reconcileConnectPayoutEvent(
        {
          eventType: 'payout.paid',
          payoutId: 'po_123',
          metadataRunId: 'run-1',
          occurredAt: '2026-06-21T20:00:00.000Z',
        },
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

    expect(deps.calls.mappingStatuses).toEqual([
      { runId: 'run-1', status: 'paid' },
    ]);
    expect(deps.calls.shipmentReleases).toEqual([
      {
        shipmentIds: ['shipment-1', 'shipment-2'],
        stripePayoutId: 'po_123',
      },
    ]);
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        status: 'paid',
        occurredAt: '2026-06-21T20:00:00.000Z',
      },
    ]);
  });

  it('ignores a metadata run match when the stored Stripe payout id differs from the incoming payout', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-stale-metadata',
        status: 'pending_reconciliation',
        stripe_payout_id: 'po_stale',
      }),
    });

    await expect(
      reconcileConnectPayoutEvent(
        {
          eventType: 'payout.paid',
          payoutId: 'po_incoming',
          metadataRunId: 'run-stale-metadata',
          occurredAt: '2026-06-21T20:00:00.000Z',
        },
        deps,
      ),
    ).resolves.toEqual({ status: 'ignored', reason: 'payout_id_mismatch' });

    expect(deps.calls.mappingStatuses).toEqual([]);
    expect(deps.calls.shipmentReleases).toEqual([]);
    expect(deps.calls.runStatuses).toEqual([]);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });

  it('reconciles by Stripe payout id when metadata run id is missing', async () => {
    const deps = createDeps({
      findRunForPayout: async (input) => {
        expect(input).toEqual({ payoutId: 'po_123', metadataRunId: null });
        return {
          id: 'run-by-payout-id',
          status: 'pending_reconciliation',
          stripe_payout_id: 'po_123',
        };
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        {
          eventType: 'payout.paid',
          payoutId: 'po_123',
          metadataRunId: null,
          occurredAt: '2026-06-21T20:00:00.000Z',
        },
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-by-payout-id' });

    expect(deps.calls.shipmentReleases).toEqual([
      {
        shipmentIds: ['shipment-1', 'shipment-2'],
        stripePayoutId: 'po_123',
      },
    ]);
  });

  it('recovers a metadata run when the payout id was not stored after Stripe payout creation', async () => {
    const deps = createDeps({
      findRunForPayout: async (input) => {
        expect(input).toEqual({
          payoutId: 'po_recovered',
          metadataRunId: 'run-recoverable',
        });
        return {
          id: 'run-recoverable',
          status: 'pending_reconciliation',
          stripe_payout_id: null,
        };
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        {
          eventType: 'payout.paid',
          payoutId: 'po_recovered',
          metadataRunId: 'run-recoverable',
          occurredAt: '2026-06-21T20:00:00.000Z',
        },
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-recoverable' });

    expect(deps.calls.payoutAttachments).toEqual([
      { runId: 'run-recoverable', stripePayoutId: 'po_recovered' },
    ]);
    expect(deps.calls.shipmentReleases).toEqual([
      {
        shipmentIds: ['shipment-1', 'shipment-2'],
        stripePayoutId: 'po_recovered',
      },
    ]);
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-recoverable',
        status: 'paid',
        occurredAt: '2026-06-21T20:00:00.000Z',
      },
    ]);
  });

  it('marks reconciliation_needed when attaching the recovered payout id fails', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-recoverable',
        status: 'reconciliation_needed',
        stripe_payout_id: null,
      }),
      attachRunPayoutId: async (input) => {
        deps.calls.payoutAttachments.push(input);
        throw new Error('attach failed');
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        {
          eventType: 'payout.paid',
          payoutId: 'po_recovered',
          metadataRunId: 'run-recoverable',
          occurredAt: '2026-06-21T20:00:00.000Z',
        },
        deps,
      ),
    ).resolves.toEqual({
      status: 'reconciliation_needed',
      runId: 'run-recoverable',
    });

    expect(deps.calls.payoutAttachments).toEqual([
      { runId: 'run-recoverable', stripePayoutId: 'po_recovered' },
    ]);
    expect(deps.calls.reconciliationNeeded).toEqual([
      { runId: 'run-recoverable', failureReason: 'attach failed' },
    ]);
    expect(deps.calls.shipmentReleases).toEqual([]);
    expect(deps.calls.runStatuses).toEqual([]);
  });

  it('does not release shipments again when the payout run is already paid', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'paid',
        stripe_payout_id: 'po_123',
      }),
    });

    await expect(
      reconcileConnectPayoutEvent(
        {
          eventType: 'payout.paid',
          payoutId: 'po_123',
          metadataRunId: 'run-1',
          occurredAt: '2026-06-21T20:00:00.000Z',
        },
        deps,
      ),
    ).resolves.toEqual({ status: 'already_reconciled', runId: 'run-1' });

    expect(deps.calls.shipmentReleases).toEqual([]);
    expect(deps.calls.mappingStatuses).toEqual([]);
    expect(deps.calls.runStatuses).toEqual([]);
  });

  it('marks failed and canceled payouts without releasing shipments', async () => {
    for (const [eventType, status] of [
      ['payout.failed', 'failed'],
      ['payout.canceled', 'canceled'],
    ] as const) {
      const deps = createDeps();

      await expect(
        reconcileConnectPayoutEvent(
          {
            eventType,
            payoutId: 'po_123',
            metadataRunId: 'run-1',
            occurredAt: '2026-06-21T20:00:00.000Z',
            failureReason: `${status} by Stripe`,
          },
          deps,
        ),
      ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

      expect(deps.calls.mappingStatuses).toEqual([{ runId: 'run-1', status }]);
      expect(deps.calls.shipmentReleases).toEqual([]);
      expect(deps.calls.runStatuses).toEqual([
        {
          runId: 'run-1',
          status,
          occurredAt: '2026-06-21T20:00:00.000Z',
          failureReason: `${status} by Stripe`,
        },
      ]);
    }
  });

  it('moves a paid payout run to reconciliation_needed when shipment release fails', async () => {
    const deps = createDeps({
      markShipmentsReleased: async () => {
        throw new Error('shipments update failed');
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        {
          eventType: 'payout.paid',
          payoutId: 'po_123',
          metadataRunId: 'run-1',
          occurredAt: '2026-06-21T20:00:00.000Z',
        },
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });

    expect(deps.calls.reconciliationNeeded).toEqual([
      {
        runId: 'run-1',
        failureReason: 'shipments update failed',
      },
    ]);
    expect(deps.calls.runStatuses).toEqual([]);
  });

  it('moves a failed payout run to reconciliation_needed when mapping update fails', async () => {
    const deps = createDeps({
      markRunShipmentsStatus: async () => {
        throw new Error('mapping update failed');
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        {
          eventType: 'payout.failed',
          payoutId: 'po_123',
          metadataRunId: 'run-1',
          occurredAt: '2026-06-21T20:00:00.000Z',
        },
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });

    expect(deps.calls.reconciliationNeeded).toEqual([
      {
        runId: 'run-1',
        failureReason: 'mapping update failed',
      },
    ]);
    expect(deps.calls.shipmentReleases).toEqual([]);
  });
});
