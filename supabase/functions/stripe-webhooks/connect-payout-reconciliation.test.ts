import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyConnectAccountActionability,
  extractSignedAccountEventData,
  reconcileConnectPayoutEvent,
  resolveAccountActionability,
  type ConnectAccountActionabilityDeps,
  type ConnectPayoutEventEvidenceInput,
  type ConnectPayoutReconciliationDeps,
} from './connect-payout-reconciliation';

// T4: actual handler with a mocked terminal RPC, NOT PostgreSQL execution.
// The model follows the validated SQL-text guard; neither test executes SQL.
describe('stale pending snapshot behind failed terminal writer (mock interleaving)', () => {
  for (const scenario of ['complete', 'wrong payout', 'incomplete mapping', 'missing failed_at', 'child payout', 'held claim'] as const) {
    it(`${scenario}: only complete same-payout failed replay avoids generic parking`, async () => {
      const persisted = {
        id: 'run-1', status: 'pending_reconciliation', release_stage: 'payout_pending',
        stripe_payout_id: scenario === 'wrong payout' ? 'po_other' : 'po_123',
        seller_id: 'seller-1', paid_at: null,
        failed_at: null as string | null, failure_reason: null as string | null,
        release_stage_version: 3,
        payout_claim_token: scenario === 'held claim' ? 'claim-1' : null,
        payout_claim_expires_at: null,
        updated_at: '2026-06-21T19:00:00.000Z',
      };
      const mappings = [{ runId: 'run-1', shipmentId: 'shipment-1', shipmentExists: true, status: 'pending_reconciliation', payoutId: scenario === 'child payout' ? 'po_child' : null }];
      const child = { id: 'run-child', retry_of_run_id: 'run-1', status: 'paid', payoutId: 'po_child', version: 9 };
      const childBefore = { ...child };
      let parked = 0;
      let terminalCalls = 0;
      let committed: typeof persisted | undefined;
      const deps = createDeps({
        findRunForPayout: async () => ({ ...persisted, stripe_payout_id: 'po_123' }),
        appendEventEvidence: async (evidence) => {
          // Writer A commits after writer B's pending read and before B's RPC.
          persisted.status = 'failed';
          persisted.release_stage = 'payout_failed';
          persisted.failed_at = scenario === 'missing failed_at' ? null : '2026-06-21T19:00:00.000Z';
          persisted.failure_reason = 'no_account: original failure';
          persisted.release_stage_version = 4;
          mappings[0].status = scenario === 'incomplete mapping' ? 'pending_reconciliation' : 'failed';
          committed = { ...persisted };
          deps.calls.eventAppends.push(evidence);
          return true;
        },
        markRunStatus: async (input) => {
          terminalCalls++;
          // Model the locked identity-bound failed equivalence, without writes.
          if (persisted.stripe_payout_id !== input.payoutId) return false;
          if (persisted.status === 'failed' && input.status === 'failed') {
            return persisted.release_stage === 'payout_failed'
              && persisted.failed_at !== null
              && persisted.payout_claim_token === null
              && persisted.payout_claim_expires_at === null
              && mappings.length > 0
              && mappings.every((m) => m.runId === input.runId
                && m.shipmentId !== null && m.shipmentExists
                && m.status === 'failed' && m.payoutId === null);
          }
          return !['paid', 'failed', 'canceled'].includes(persisted.status);
        },
        markRunReconciliationNeeded: async () => {
          parked++;
          persisted.status = 'reconciliation_needed';
          persisted.release_stage = 'action_required';
          persisted.release_stage_version++;
        },
      });
      const result = await reconcileConnectPayoutEvent(payoutEvent({
        eventId: `evt_stale_${scenario}`, eventType: 'payout.updated', observedStatus: 'failed',
        failureReason: 'later delivery must not overwrite original failure',
        failureCode: 'no_account', failureBalanceTransaction: 'txn_returned',
      }), deps);
      expect(terminalCalls).toBe(1);
      expect(deps.calls.eventAppends).toHaveLength(1);
      expect(deps.calls.eventAppends[0].failureBalanceTransaction).toBe('txn_returned');
      expect(child).toEqual(childBefore);
      expect(mappings[0].payoutId).toBe(scenario === 'child payout' ? 'po_child' : null);
      expect(persisted.failed_at).toBe(committed?.failed_at);
      expect(persisted.failure_reason).toBe(committed?.failure_reason);
      if (scenario === 'complete') {
        expect(mappings[0].status).toBe('failed');
        expect(parked, 'Validated complete failed model must avoid generic parking').toBe(0);
        expect(result.status).toBe('reconciled');
        expect(persisted).toEqual(committed);
      } else {
        expect(parked).toBe(1);
        expect(result.status).toBe('reconciliation_needed');
        expect(mappings[0].status).toBe(scenario === 'incomplete mapping' ? 'pending_reconciliation' : 'failed');
      }
    });
  }
});

interface DepCalls {
  sequence: string[];
  runStatuses: unknown[];
  reconciliationNeeded: unknown[];
  payoutAttachments: unknown[];
  eventAppends: ConnectPayoutEventEvidenceInput[];
  authorityRetrievals: unknown[];
  sellerAccountLookups: unknown[];
  stageProjections: unknown[];
}

function createDeps(overrides: Partial<ConnectPayoutReconciliationDeps> = {}) {
  const calls: DepCalls = {
    sequence: [],
    runStatuses: [],
    reconciliationNeeded: [],
    payoutAttachments: [],
    eventAppends: [],
    authorityRetrievals: [],
    sellerAccountLookups: [],
    stageProjections: [],
  };

  const deps: ConnectPayoutReconciliationDeps & { calls: DepCalls } = {
    calls,
    findRunForPayout: async () => ({
      id: 'run-1',
      status: 'pending_reconciliation',
      stripe_payout_id: 'po_123',
      seller_id: 'seller-1',
      paid_at: null,
    }),
    listRunShipmentIds: async () => ['shipment-1', 'shipment-2'],
    appendEventEvidence: async (input) => {
      calls.sequence.push('append_event');
      if (
        calls.eventAppends.some(
          (existing) => existing.eventId === input.eventId,
        )
      ) {
        return false;
      }
      calls.eventAppends.push(input);
      return true;
    },
    // The atomic terminal projection is the ONLY outcome write: the run
    // projection, the mapping projection, and the shipment payout-id
    // set/clear are one guarded RPC unit, so the module performs no
    // dependent write after it (refusal or acceptance alike).
    markRunStatus: async (input) => {
      calls.sequence.push('project_outcome');
      calls.runStatuses.push(input);
      return true;
    },
    markRunReconciliationNeeded: async (input) => {
      calls.sequence.push('mark_reconciliation_needed');
      calls.reconciliationNeeded.push(input);
    },
    attachRunPayoutId: async (input) => {
      calls.sequence.push('attach_payout');
      calls.payoutAttachments.push(input);
    },
    getSellerStripeAccountId: async (sellerId) => {
      calls.sequence.push('seller_account');
      calls.sellerAccountLookups.push(sellerId);
      return 'acct_seller_1';
    },
    resolveAuthoritativePayout: async (input) => {
      calls.sequence.push('authority');
      calls.authorityRetrievals.push(input);
      return {
        status: 'failed',
        failureCode: 'account_closed',
        failureMessage: 'from stripe',
        failureBalanceTransaction: 'txn_authority',
      };
    },
    ...overrides,
  };

  return deps;
}

function payoutEvent(
  overrides: Partial<Parameters<typeof reconcileConnectPayoutEvent>[0]> = {},
): Parameters<typeof reconcileConnectPayoutEvent>[0] {
  return {
    eventId: 'evt_1',
    eventType: 'payout.paid',
    payoutId: 'po_123',
    metadataRunId: 'run-1',
    occurredAt: '2026-06-21T20:00:00.000Z',
    observedStatus: 'paid',
    ...overrides,
  };
}

describe('reconcileConnectPayoutEvent', () => {
  it('appends after a concurrent same-payout attach and rejects a conflicting attach before evidence', async () => {
    for (const attachedId of ['po_123', 'po_other'] as const) {
      const deps = createDeps({
        findRunForPayout: async () => ({
          id: 'run-1', status: 'pending_reconciliation', stripe_payout_id: null,
          seller_id: 'seller-1', paid_at: null,
        }),
        attachRunPayoutId: async () => {
          deps.calls.sequence.push('attach_payout');
          if (attachedId !== 'po_123') throw new Error('PAYOUT_RUN_ATTACH_CONFLICT');
        },
      });
      if (attachedId === 'po_123') {
        await expect(reconcileConnectPayoutEvent(payoutEvent(), deps)).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });
        expect(deps.calls.sequence).toEqual(['attach_payout', 'append_event', 'project_outcome']);
      } else {
        await expect(reconcileConnectPayoutEvent(payoutEvent(), deps)).rejects.toThrow('PAYOUT_RUN_ATTACH_CONFLICT');
        expect(deps.calls.eventAppends).toHaveLength(0);
      }
    }
  });

  it('appends evidence before the single atomic projection of a paid outcome', async () => {
    const deps = createDeps();

    await expect(
      reconcileConnectPayoutEvent(payoutEvent(), deps),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

    expect(deps.calls.eventAppends).toEqual([
      {
        eventId: 'evt_1',
        eventType: 'payout.paid',
        payoutId: 'po_123',
        runId: 'run-1',
        stripeCreatedAt: '2026-06-21T20:00:00.000Z',
        observedStatus: 'paid',
        failureCode: null,
        failureMessage: null,
        failureBalanceTransaction: null,
      },
    ]);
    // The atomic projection is the ONLY outcome write: no separate mapping or
    // shipment write may follow it.
    expect(deps.calls.sequence).toEqual(['append_event', 'project_outcome']);
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        payoutId: 'po_123',
        status: 'paid',
        occurredAt: '2026-06-21T20:00:00.000Z',
      },
    ]);
  });

  it('stores one evidence record and applies projection at most once for a duplicate event identity', async () => {
    const deps = createDeps({
      appendEventEvidence: async (input) => {
        deps.calls.sequence.push('append_event');
        deps.calls.eventAppends.push(input);
        return false;
      },
    });

    await expect(
      reconcileConnectPayoutEvent(payoutEvent(), deps),
    ).resolves.toEqual({ status: 'duplicate_event', runId: 'run-1' });

    expect(deps.calls.sequence).toEqual(['append_event']);
    expect(deps.calls.eventAppends).toHaveLength(1);
    expect(deps.calls.runStatuses).toEqual([]);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });

  it('projects a late paid→failed downgrade through the single atomic outcome unit', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'paid',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: '2026-06-20T20:00:00.000Z',
      }),
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({
          eventType: 'payout.failed',
          observedStatus: 'failed',
          occurredAt: '2026-06-25T20:00:00.000Z',
          failureCode: 'account_closed',
          failureMessage: 'Payout failed after arrival',
          failureReason: 'Payout failed after arrival',
          failureBalanceTransaction: 'txn_return',
        }),
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

    // One atomic unit carries the run projection, the mapping projection, and
    // the guarded clear of the failing payout's own release marking.
    expect(deps.calls.sequence).toEqual(['append_event', 'project_outcome']);
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        payoutId: 'po_123',
        status: 'failed',
        occurredAt: '2026-06-25T20:00:00.000Z',
        failureReason: 'Payout failed after arrival',
        failureBalanceTransaction: 'txn_return',
      },
    ]);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });

  it('downgrades a late paid→failed event carrying only the balance transaction evidence', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'paid',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: '2026-06-20T20:00:00.000Z',
      }),
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({
          eventType: 'payout.failed',
          observedStatus: 'failed',
          occurredAt: '2026-06-25T20:00:00.000Z',
          failureBalanceTransaction: 'txn_return',
        }),
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        payoutId: 'po_123',
        status: 'failed',
        occurredAt: '2026-06-25T20:00:00.000Z',
        failureBalanceTransaction: 'txn_return',
      },
    ]);
  });

  it('resolves an out-of-order failed event against authoritative Stripe state before downgrading', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'paid',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: '2026-06-24T20:00:00.000Z',
      }),
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({
          eventType: 'payout.failed',
          observedStatus: 'failed',
          occurredAt: '2026-06-22T20:00:00.000Z',
          failureBalanceTransaction: 'txn_return',
        }),
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

    expect(deps.calls.sellerAccountLookups).toEqual(['seller-1']);
    expect(deps.calls.authorityRetrievals).toEqual([
      { payoutId: 'po_123', stripeAccountId: 'acct_seller_1' },
    ]);
    expect(deps.calls.sequence).toEqual([
      'append_event',
      'seller_account',
      'authority',
      'project_outcome',
    ]);
  });

  it('keeps an observed paid outcome when older failed evidence is not confirmed by Stripe', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'paid',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: '2026-06-24T20:00:00.000Z',
      }),
      resolveAuthoritativePayout: async (input) => {
        deps.calls.sequence.push('authority');
        deps.calls.authorityRetrievals.push(input);
        return {
          status: 'paid',
          failureCode: null,
          failureMessage: null,
          failureBalanceTransaction: null,
        };
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({
          eventType: 'payout.failed',
          observedStatus: 'failed',
          occurredAt: '2026-06-22T20:00:00.000Z',
        }),
        deps,
      ),
    ).resolves.toEqual({ status: 'already_reconciled', runId: 'run-1' });

    expect(deps.calls.runStatuses).toEqual([]);
    expect(deps.calls.eventAppends).toHaveLength(1);
  });

  it('never re-releases shipments when an older paid event arrives after a recorded failure', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'failed',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: null,
      }),
    });

    await expect(
      reconcileConnectPayoutEvent(payoutEvent(), deps),
    ).resolves.toEqual({ status: 'already_reconciled', runId: 'run-1' });

    expect(deps.calls.sellerAccountLookups).toEqual(['seller-1']);
    expect(deps.calls.authorityRetrievals).toEqual([
      { payoutId: 'po_123', stripeAccountId: 'acct_seller_1' },
    ]);
    expect(deps.calls.runStatuses).toEqual([]);
    expect(deps.calls.eventAppends).toHaveLength(1);
  });

  it('enters reconciliation when older paid evidence conflicts with authoritative failure', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'failed',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: null,
      }),
      resolveAuthoritativePayout: async (input) => {
        deps.calls.sequence.push('authority');
        deps.calls.authorityRetrievals.push(input);
        return {
          status: 'paid',
          failureCode: null,
          failureMessage: null,
          failureBalanceTransaction: null,
        };
      },
    });

    await expect(
      reconcileConnectPayoutEvent(payoutEvent(), deps),
    ).resolves.toEqual({
      status: 'reconciliation_needed',
      runId: 'run-1',
    });

    expect(deps.calls.reconciliationNeeded).toEqual([
      {
        runId: 'run-1',
        failureReason: 'PAYOUT_AUTHORITY_CONFLICT: authoritative state paid conflicts with recorded failed',
      },
    ]);
    expect(deps.calls.runStatuses).toEqual([]);
  });

  it('downgrades an observed paid outcome to canceled only when Stripe confirms cancellation', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'paid',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: '2026-06-20T20:00:00.000Z',
      }),
      resolveAuthoritativePayout: async (input) => {
        deps.calls.sequence.push('authority');
        deps.calls.authorityRetrievals.push(input);
        return {
          status: 'canceled',
          failureCode: null,
          failureMessage: null,
          failureBalanceTransaction: null,
        };
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({
          eventType: 'payout.canceled',
          observedStatus: 'canceled',
          occurredAt: '2026-06-25T20:00:00.000Z',
        }),
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

    expect(deps.calls.sequence).toEqual([
      'append_event',
      'seller_account',
      'authority',
      'project_outcome',
    ]);
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        payoutId: 'po_123',
        status: 'canceled',
        occurredAt: '2026-06-25T20:00:00.000Z',
      },
    ]);
  });

  it('records evidence for lifecycle events without aggregate projection', async () => {
    for (const [eventType, observedStatus] of [
      ['payout.created', 'pending'],
      ['payout.updated', 'in_transit'],
    ] as const) {
      const deps = createDeps();

      await expect(
        reconcileConnectPayoutEvent(
          payoutEvent({ eventType, observedStatus }),
          deps,
        ),
      ).resolves.toEqual({ status: 'evidence_recorded', runId: 'run-1' });

      expect(deps.calls.sequence).toEqual(['append_event']);
      expect(deps.calls.eventAppends).toEqual([
        {
          eventId: 'evt_1',
          eventType,
          payoutId: 'po_123',
          runId: 'run-1',
          stripeCreatedAt: '2026-06-21T20:00:00.000Z',
          observedStatus,
          failureCode: null,
          failureMessage: null,
          failureBalanceTransaction: null,
        },
      ]);
      expect(deps.calls.runStatuses).toEqual([]);
    }
  });

  it('projects an updated payout observed state forward for pre-outcome runs', async () => {
    const deps = createDeps();

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({
          eventType: 'payout.updated',
          observedStatus: 'failed',
          failureReason: 'failed by Stripe',
        }),
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        payoutId: 'po_123',
        status: 'failed',
        occurredAt: '2026-06-21T20:00:00.000Z',
        failureReason: 'failed by Stripe',
      },
    ]);
  });

  it('rebuilds the downgrade from the same event after an atomic projection failure retained the evidence', async () => {
    const runState = {
      id: 'run-1',
      status: 'paid' as string,
      stripe_payout_id: 'po_123',
      seller_id: 'seller-1',
      paid_at: '2026-06-20T20:00:00.000Z',
    };
    let projectionAttempts = 0;
    const deps = createDeps({
      findRunForPayout: async () => ({ ...runState }),
      // Total atomic-unit failure: the whole RPC (run + mapping + shipment
      // effects) threw, so the run was never projected.
      markRunStatus: async (input) => {
        deps.calls.sequence.push('project_outcome');
        projectionAttempts += 1;
        if (projectionAttempts === 1) {
          throw new Error('payout projection failed');
        }
        deps.calls.runStatuses.push(input);
        runState.status = input.status;
        return true;
      },
      markRunReconciliationNeeded: async (input) => {
        deps.calls.sequence.push('mark_reconciliation_needed');
        deps.calls.reconciliationNeeded.push(input);
        runState.status = 'reconciliation_needed';
      },
    });

    const event = payoutEvent({
      eventType: 'payout.failed',
      observedStatus: 'failed',
      occurredAt: '2026-06-25T20:00:00.000Z',
      failureReason: 'Payout failed after arrival',
      failureBalanceTransaction: 'txn_return',
    });

    await expect(
      reconcileConnectPayoutEvent(event, deps),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });
    expect(deps.calls.eventAppends).toHaveLength(1);
    expect(deps.calls.runStatuses).toEqual([]);

    // The retained evidence lets the same signed event replay the whole
    // atomic projection idempotently, without a second evidence insert.
    await expect(
      reconcileConnectPayoutEvent(event, deps),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

    expect(
      new Set(deps.calls.eventAppends.map((append) => append.eventId)).size,
    ).toBe(1);
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        payoutId: 'po_123',
        status: 'failed',
        occurredAt: '2026-06-25T20:00:00.000Z',
        failureReason: 'Payout failed after arrival',
        failureBalanceTransaction: 'txn_return',
      },
    ]);
  });

  it('re-consults Stripe authority when replaying an out-of-order downgrade whose first attempt failed', async () => {
    const runState = {
      id: 'run-1',
      status: 'paid' as string,
      stripe_payout_id: 'po_123',
      seller_id: 'seller-1',
      paid_at: '2026-06-24T20:00:00.000Z',
    };
    let authorityAttempts = 0;
    const deps = createDeps({
      findRunForPayout: async () => ({ ...runState }),
      resolveAuthoritativePayout: async (input) => {
        deps.calls.sequence.push('authority');
        authorityAttempts += 1;
        if (authorityAttempts === 1) {
          throw new Error('stripe unavailable');
        }
        deps.calls.authorityRetrievals.push(input);
        return {
          status: 'failed',
          failureCode: null,
          failureMessage: null,
          failureBalanceTransaction: null,
        };
      },
      markRunReconciliationNeeded: async (input) => {
        deps.calls.sequence.push('mark_reconciliation_needed');
        deps.calls.reconciliationNeeded.push(input);
        runState.status = 'reconciliation_needed';
      },
      markRunStatus: async (input) => {
        deps.calls.sequence.push('project_outcome');
        deps.calls.runStatuses.push(input);
        runState.status = input.status;
        return true;
      },
    });

    const event = payoutEvent({
      eventType: 'payout.failed',
      observedStatus: 'failed',
      occurredAt: '2026-06-22T20:00:00.000Z',
    });

    await expect(
      reconcileConnectPayoutEvent(event, deps),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });

    await expect(
      reconcileConnectPayoutEvent(event, deps),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

    expect(deps.calls.authorityRetrievals).toEqual([
      { payoutId: 'po_123', stripeAccountId: 'acct_seller_1' },
    ]);
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        payoutId: 'po_123',
        status: 'failed',
        occurredAt: '2026-06-22T20:00:00.000Z',
      },
    ]);
  });

  it('does not report a parked run reconciled merely because paid_at survived a later failure', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'reconciliation_needed',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: '2026-06-20T20:00:00.000Z',
      }),
      appendEventEvidence: async (input) => {
        deps.calls.sequence.push('append_event');
        deps.calls.eventAppends.push(input);
        return false;
      },
    });

    await expect(
      reconcileConnectPayoutEvent(payoutEvent(), deps),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });

    expect(deps.calls.runStatuses).toEqual([]);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });

  it('keeps operator reconciliation when a duplicate paid event replays against a possible recorded failure', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'reconciliation_needed',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: null,
      }),
      appendEventEvidence: async (input) => {
        deps.calls.sequence.push('append_event');
        deps.calls.eventAppends.push(input);
        return false;
      },
    });

    await expect(
      reconcileConnectPayoutEvent(payoutEvent(), deps),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });

    expect(deps.calls.runStatuses).toEqual([]);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });

  it('retains appended evidence and marks reconciliation-needed when the atomic paid projection throws', async () => {
    const deps = createDeps({
      markRunStatus: async (input) => {
        deps.calls.sequence.push('project_outcome');
        deps.calls.runStatuses.push(input);
        throw new Error('payout projection failed');
      },
    });

    await expect(
      reconcileConnectPayoutEvent(payoutEvent(), deps),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });

    expect(deps.calls.sequence).toEqual([
      'append_event',
      'project_outcome',
      'mark_reconciliation_needed',
    ]);
    expect(deps.calls.reconciliationNeeded).toEqual([
      {
        runId: 'run-1',
        failureReason: 'payout projection failed',
      },
    ]);
    // The atomic unit failed as a whole; the retained evidence is what lets a
    // replay recover the projection, and nothing else was written.
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        payoutId: 'po_123',
        status: 'paid',
        occurredAt: '2026-06-21T20:00:00.000Z',
      },
    ]);
  });

  it('retains evidence and marks reconciliation-needed when the atomic downgrade projection throws', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'paid',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: '2026-06-20T20:00:00.000Z',
      }),
      markRunStatus: async (input) => {
        deps.calls.sequence.push('project_outcome');
        deps.calls.runStatuses.push(input);
        throw new Error('payout downgrade failed');
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({
          eventType: 'payout.failed',
          observedStatus: 'failed',
          occurredAt: '2026-06-25T20:00:00.000Z',
        }),
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });

    expect(deps.calls.sequence).toEqual([
      'append_event',
      'project_outcome',
      'mark_reconciliation_needed',
    ]);
    expect(deps.calls.reconciliationNeeded).toEqual([
      {
        runId: 'run-1',
        failureReason: 'payout downgrade failed',
      },
    ]);
    // The atomic unit failed as a whole: nothing was projected.
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-1',
        payoutId: 'po_123',
        status: 'failed',
        occurredAt: '2026-06-25T20:00:00.000Z',
      },
    ]);
  });

  it('retains evidence and marks reconciliation-needed when Stripe authority cannot be retrieved', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'paid',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: '2026-06-24T20:00:00.000Z',
      }),
      resolveAuthoritativePayout: async () => {
        throw new Error('stripe unavailable');
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({
          eventType: 'payout.failed',
          observedStatus: 'failed',
          occurredAt: '2026-06-22T20:00:00.000Z',
        }),
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });

    expect(deps.calls.reconciliationNeeded).toEqual([
      {
        runId: 'run-1',
        failureReason: 'stripe unavailable',
      },
    ]);
    expect(deps.calls.runStatuses).toEqual([]);
  });

  it('keeps an already-terminal failure-family run reconciled when the other failure event arrives', async () => {
    for (const [localStatus, eventType, observedStatus] of [
      ['failed', 'payout.canceled', 'canceled'],
      ['canceled', 'payout.failed', 'failed'],
    ] as const) {
      const deps = createDeps({
        findRunForPayout: async () => ({
          id: 'run-1',
          status: localStatus,
          stripe_payout_id: 'po_123',
          seller_id: 'seller-1',
          paid_at: null,
        }),
      });

      await expect(
        reconcileConnectPayoutEvent(
          payoutEvent({ eventType, observedStatus }),
          deps,
        ),
      ).resolves.toEqual({ status: 'already_reconciled', runId: 'run-1' });

      expect(deps.calls.runStatuses).toEqual([]);
      expect(deps.calls.reconciliationNeeded).toEqual([]);
    }
  });

  it('reconciles by Stripe payout id when metadata run id is missing', async () => {
    const deps = createDeps({
      findRunForPayout: async (input) => {
        expect(input).toEqual({ payoutId: 'po_123', metadataRunId: null });
        return {
          id: 'run-by-payout-id',
          status: 'pending_reconciliation',
          stripe_payout_id: 'po_123',
          seller_id: 'seller-1',
          paid_at: null,
        };
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({ metadataRunId: null }),
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-by-payout-id' });

    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-by-payout-id',
        payoutId: 'po_123',
        status: 'paid',
        occurredAt: '2026-06-21T20:00:00.000Z',
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
          seller_id: 'seller-1',
          paid_at: null,
        };
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({ payoutId: 'po_recovered', metadataRunId: 'run-recoverable' }),
        deps,
      ),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-recoverable' });

    expect(deps.calls.payoutAttachments).toEqual([
      { runId: 'run-recoverable', stripePayoutId: 'po_recovered', sellerId: 'seller-1' },
    ]);
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-recoverable',
        payoutId: 'po_recovered',
        status: 'paid',
        occurredAt: '2026-06-21T20:00:00.000Z',
      },
    ]);
  });

  it('rejects when attaching the recovered payout id fails before evidence exists, even after safe parking', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-recoverable',
        status: 'reconciliation_needed',
        stripe_payout_id: null,
        seller_id: 'seller-1',
        paid_at: null,
      }),
      attachRunPayoutId: async (input) => {
        deps.calls.sequence.push('attach_payout');
        deps.calls.payoutAttachments.push(input);
        throw new Error('attach failed');
      },
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({ payoutId: 'po_recovered', metadataRunId: 'run-recoverable' }),
        deps,
      ),
    ).rejects.toThrow('attach failed');

    expect(deps.calls.sequence).toEqual(['attach_payout', 'mark_reconciliation_needed']);
    expect(deps.calls.payoutAttachments).toEqual([
      { runId: 'run-recoverable', stripePayoutId: 'po_recovered', sellerId: 'seller-1' },
    ]);
    expect(deps.calls.reconciliationNeeded).toEqual([
      { runId: 'run-recoverable', failureReason: 'attach failed' },
    ]);
    expect(deps.calls.eventAppends).toEqual([]);
    expect(deps.calls.runStatuses).toEqual([]);
  });

  it('rejects a failed evidence append before ledger insertion even after safe parking', async () => {
    const deps = createDeps({
      appendEventEvidence: async () => {
        deps.calls.sequence.push('append_event');
        throw new Error('evidence append failed');
      },
    });

    await expect(reconcileConnectPayoutEvent(payoutEvent(), deps))
      .rejects.toThrow('evidence append failed');
    expect(deps.calls.sequence).toEqual(['append_event', 'mark_reconciliation_needed']);
    expect(deps.calls.eventAppends).toEqual([]);
    expect(deps.calls.reconciliationNeeded).toEqual([
      { runId: 'run-1', failureReason: 'evidence append failed' },
    ]);
    expect(deps.calls.runStatuses).toEqual([]);
  });

  it('preserves the attachment error when the attempted park also fails', async () => {
    const original = new Error('attach failed');
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-recoverable', status: 'reconciliation_needed',
        stripe_payout_id: null, seller_id: 'seller-1', paid_at: null,
      }),
      attachRunPayoutId: async () => { throw original; },
      markRunReconciliationNeeded: async (input) => {
        deps.calls.sequence.push('mark_reconciliation_needed');
        deps.calls.reconciliationNeeded.push(input);
        throw new Error('park failed');
      },
    });

    await expect(reconcileConnectPayoutEvent(
      payoutEvent({ payoutId: 'po_recovered', metadataRunId: 'run-recoverable' }), deps,
    )).rejects.toBe(original);
    expect(deps.calls.reconciliationNeeded).toEqual([
      { runId: 'run-recoverable', failureReason: 'attach failed' },
    ]);
    expect(deps.calls.eventAppends).toEqual([]);
  });

  it('preserves the append error when the attempted park also fails', async () => {
    const original = new Error('evidence append failed');
    const deps = createDeps({
      appendEventEvidence: async () => { throw original; },
      markRunReconciliationNeeded: async (input) => {
        deps.calls.sequence.push('mark_reconciliation_needed');
        deps.calls.reconciliationNeeded.push(input);
        throw new Error('park failed');
      },
    });

    await expect(reconcileConnectPayoutEvent(payoutEvent(), deps)).rejects.toBe(original);
    expect(deps.calls.reconciliationNeeded).toEqual([
      { runId: 'run-1', failureReason: 'evidence append failed' },
    ]);
    expect(deps.calls.runStatuses).toEqual([]);
  });

  it('ignores a metadata run match when the stored Stripe payout id differs from the incoming payout', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-stale-metadata',
        status: 'pending_reconciliation',
        stripe_payout_id: 'po_stale',
        seller_id: 'seller-1',
        paid_at: null,
      }),
    });

    await expect(
      reconcileConnectPayoutEvent(
        payoutEvent({ payoutId: 'po_incoming' }),
        deps,
      ),
    ).resolves.toEqual({ status: 'ignored', reason: 'payout_id_mismatch' });

    expect(deps.calls.runStatuses).toEqual([]);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
    expect(deps.calls.eventAppends).toEqual([]);
  });

  it('refuses to call a paid run reconciled when SQL rejects incomplete mapping or shipment equivalence', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1', status: 'paid', stripe_payout_id: 'po_123',
        seller_id: 'seller-1', paid_at: '2026-06-20T20:00:00.000Z',
      }),
      markRunStatus: async (input) => {
        deps.calls.sequence.push('project_outcome');
        deps.calls.runStatuses.push(input);
        return false; // SQL refuses incomplete paid mapping/shipment equivalence.
      },
    });

    expect(await reconcileConnectPayoutEvent(payoutEvent(), deps)).toEqual({
      status: 'reconciliation_needed', runId: 'run-1',
    });
    expect(deps.calls.sequence).toEqual([
      'append_event', 'project_outcome', 'mark_reconciliation_needed',
    ]);
    expect(deps.calls.eventAppends).toHaveLength(1);
    expect(deps.calls.reconciliationNeeded).toEqual([{
      runId: 'run-1', failureReason: 'PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT',
    }]);
  });

  it('does not release shipments again when the payout run is already paid', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'paid',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: '2026-06-20T20:00:00.000Z',
      }),
    });

    await expect(
      reconcileConnectPayoutEvent(payoutEvent(), deps),
    ).resolves.toEqual({ status: 'already_reconciled', runId: 'run-1' });

    expect(deps.calls.runStatuses).toEqual([{
      runId: 'run-1', payoutId: 'po_123', status: 'paid',
      occurredAt: '2026-06-21T20:00:00.000Z',
    }]);
    expect(deps.calls.sequence).toEqual(['append_event', 'project_outcome']);
    expect(deps.calls.eventAppends).toHaveLength(1);
  });

  it('marks failed and canceled payouts through the single atomic projection', async () => {
    for (const [eventType, status] of [
      ['payout.failed', 'failed'],
      ['payout.canceled', 'canceled'],
    ] as const) {
      const deps = createDeps();

      await expect(
        reconcileConnectPayoutEvent(
          payoutEvent({
            eventType,
            observedStatus: status,
            failureReason: `${status} by Stripe`,
          }),
          deps,
        ),
      ).resolves.toEqual({ status: 'reconciled', runId: 'run-1' });

      // No shipment release rides along: the atomic unit's failure-family
      // branch only advances the mappings and clears the payout's own marks.
      expect(deps.calls.runStatuses).toEqual([
        {
          runId: 'run-1',
          payoutId: 'po_123',
          status,
          occurredAt: '2026-06-21T20:00:00.000Z',
          failureReason: `${status} by Stripe`,
        },
      ]);
    }
  });

  it('releases a retry child exactly once while late parent events remain isolated', async () => {
    const runsByPayoutId = new Map([
      [
        'po_parent',
        {
          id: 'run-parent',
          status: 'failed',
          stripe_payout_id: 'po_parent',
          seller_id: 'seller-1',
          paid_at: null,
        },
      ],
      [
        'po_child',
        {
          id: 'run-child',
          status: 'pending_reconciliation',
          stripe_payout_id: 'po_child',
          seller_id: 'seller-1',
          paid_at: null,
        },
      ],
    ]);
    const deps = createDeps({
      findRunForPayout: async ({ payoutId }) =>
        runsByPayoutId.get(payoutId) ?? null,
      markRunStatus: async (input) => {
        deps.calls.sequence.push('project_outcome');
        deps.calls.runStatuses.push(input);
        const payoutId =
          input.runId === 'run-child' ? 'po_child' : 'po_parent';
        const run = runsByPayoutId.get(payoutId);
        if (run) run.status = input.status;
        return true;
      },
    });

    const childEvent = payoutEvent({
      eventId: 'evt_child',
      payoutId: 'po_child',
      metadataRunId: 'run-child',
      occurredAt: '2026-06-24T20:00:00.000Z',
    });
    await expect(
      reconcileConnectPayoutEvent(childEvent, deps),
    ).resolves.toEqual({ status: 'reconciled', runId: 'run-child' });
    await expect(
      reconcileConnectPayoutEvent(childEvent, deps),
    ).resolves.toEqual({ status: 'duplicate_event', runId: 'run-child' });

    for (const eventType of ['payout.paid', 'payout.canceled'] as const) {
      await expect(
        reconcileConnectPayoutEvent(
          payoutEvent({
            eventId: `evt_parent_${eventType}`,
            eventType,
            payoutId: 'po_parent',
            metadataRunId: 'run-parent',
            observedStatus: eventType === 'payout.paid' ? 'paid' : 'canceled',
            occurredAt: '2026-06-25T20:00:00.000Z',
          }),
          deps,
        ),
      ).resolves.toEqual({
        status: 'already_reconciled',
        runId: 'run-parent',
      });
    }

    // The child's paid outcome was applied exactly once through the atomic
    // unit; the failed parent's late events never touch it again.
    expect(deps.calls.runStatuses).toEqual([
      {
        runId: 'run-child',
        payoutId: 'po_child',
        status: 'paid',
        occurredAt: '2026-06-24T20:00:00.000Z',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2B: external-account actionability and stage projection.
// ---------------------------------------------------------------------------

describe('resolveAccountActionability', () => {
  const blockedStatuses = [
    'errored',
    'verification_failed',
    'tokenized_account_number_deactivated',
  ] as const;

  for (const status of blockedStatuses) {
    it(`treats a non-actionable external-account status (${status}) as blocked`, () => {
      const resolution = resolveAccountActionability({
        kind: 'external_account_updated',
        accountId: 'acct_1',
        externalAccountId: null,
        payoutsEnabled: true,
        externalAccountStatus: status,
      });

      expect(resolution.actionable).toBe(false);
      expect(resolution.blockedReason).toBe(status);
    });
  }

  it('treats a healthy external account as actionable', () => {
    const resolution = resolveAccountActionability({
      kind: 'external_account_updated',
      accountId: 'acct_1',
      externalAccountId: null,
      payoutsEnabled: true,
      externalAccountStatus: 'verified',
    });

    expect(resolution.actionable).toBe(true);
    expect(resolution.blockedReason).toBeNull();
  });

  it('treats a disabled payouts flag as blocked regardless of account health', () => {
    const resolution = resolveAccountActionability({
      kind: 'account_updated',
      accountId: 'acct_1',
      externalAccountId: null,
      payoutsEnabled: false,
      externalAccountStatus: 'verified',
    });

    expect(resolution.actionable).toBe(false);
    expect(resolution.blockedReason).toBe('payouts_disabled');
  });

  it('never blocks on undocumented or missing fields', () => {
    const resolution = resolveAccountActionability({
      kind: 'external_account_updated',
      accountId: 'acct_1',
      externalAccountId: null,
      payoutsEnabled: null,
      externalAccountStatus: null,
    });

    // Evidence-only: the account state is undetermined, so the caller records
    // evidence but does not block or resume any run.
    expect(resolution.undetermined).toBe(true);
    expect(resolution.actionable).toBe(false);
    expect(resolution.blockedReason).toBeNull();
  });
});

describe('applyConnectAccountActionability (required current-state dependencies)', () => {
  type Input = Parameters<typeof applyConnectAccountActionability>[0];
  function signedEvent(overrides: Partial<Input> = {}): Input {
    return { eventId: 'evt_acct_1', eventType: 'account.external_account.updated', accountId: 'acct_1',
      occurredAt: '2026-09-20T00:00:00.000Z', externalAccountId: 'ba_1',
      payoutsEnabled: null, externalAccountStatus: 'errored',
      resolution: { actionable: false, blockedReason: 'errored', undetermined: false }, ...overrides };
  }
  function createActionabilityDeps(options: { alreadyRecorded?: boolean; status?: string } = {}) {
    const calls = { recordedEvents: [] as Input[], acquisitions: [] as unknown[],
      projections: [] as Parameters<ConnectAccountActionabilityDeps['commitAccountRefresh']>[0][] };
    const deps: ConnectAccountActionabilityDeps & { calls: typeof calls } = {
      calls,
      recordAccountEvent: async (input) => { calls.recordedEvents.push(input); return !options.alreadyRecorded; },
      acquireAccountRefresh: async (input) => { calls.acquisitions.push(input); return calls.acquisitions.length; },
      retrieveCurrentAccount: async () => ({ id: 'acct_1', payouts_enabled: true }),
      listCurrentBankAccounts: async () => ({ data: [{ id: 'ba_current', object: 'bank_account', account: 'acct_1',
        currency: 'mxn', default_for_currency: true, status: options.status ?? 'errored' }], has_more: false }),
      commitAccountRefresh: async (input) => { calls.projections.push(input); return true; },
    };
    return deps;
  }
  it('records signed evidence once and commits the current blocked default', async () => {
    const deps = createActionabilityDeps();
    const input = signedEvent();
    await applyConnectAccountActionability(input, deps);
    expect(deps.calls.recordedEvents).toEqual([input]);
    expect(deps.calls.projections).toEqual([{ accountId: 'acct_1', generation: 1, sourceEventId: input.eventId,
      actionable: false, blockedReason: 'errored', payoutsEnabled: true, externalAccountId: 'ba_current',
      externalAccountStatus: 'errored', currency: 'mxn', defaultForCurrency: true, mxnDefaultCount: 1 }]);
  });
  it('undetermined signed fields still reconcile independently against current healthy authority', async () => {
    const deps = createActionabilityDeps({ status: 'verified' });
    await applyConnectAccountActionability(signedEvent({ eventId: 'evt_acct_2', externalAccountStatus: null,
      resolution: { actionable: false, blockedReason: null, undetermined: true } }), deps);
    expect(deps.calls.recordedEvents[0].externalAccountStatus).toBeNull();
    expect(deps.calls.projections[0]).toMatchObject({ actionable: true, generation: 1 });
  });
  it('duplicate evidence still acquires and rechecks after a prior projection failure', async () => {
    const deps = createActionabilityDeps({ alreadyRecorded: true });
    await applyConnectAccountActionability(signedEvent(), deps);
    expect(deps.calls.recordedEvents).toHaveLength(1);
    expect(deps.calls.acquisitions).toEqual([{ accountId: 'acct_1', sourceEventId: 'evt_acct_1' }]);
    expect(deps.calls.projections[0]).toMatchObject({ actionable: false, blockedReason: 'errored', generation: 1 });
  });
  it('out-of-order stripe_created stays evidence, never the current-state commit gate', async () => {
    const deps = createActionabilityDeps({ status: 'verified' });
    await applyConnectAccountActionability(signedEvent({ eventId: 'evt_acct_older', occurredAt: '2026-09-19T00:00:00.000Z' }), deps);
    expect(deps.calls.recordedEvents[0].occurredAt).toBe('2026-09-19T00:00:00.000Z');
    expect(deps.calls.projections[0]).toMatchObject({ actionable: true, sourceEventId: 'evt_acct_older' });
    expect(deps.calls.projections[0]).not.toHaveProperty('stripeCreated');
  });
  it('current healthy snapshot reaches only the guarded commit, not a legacy event-time restore', async () => {
    // SQL structural tests separately protect the exact account_not_actionable
    // resume boundary. This unit exercises orchestration, not PG run writes.
    const deps = createActionabilityDeps({ status: 'verified' });
    await applyConnectAccountActionability(signedEvent({ eventId: 'evt_acct_3', eventType: 'account.updated' }), deps);
    expect(deps.calls.projections[0]).toMatchObject({ actionable: true, blockedReason: null, sourceEventId: 'evt_acct_3' });
    expect(deps.calls.projections).toHaveLength(1);
  });
});

describe('stage projection for payout lifecycle events', () => {
  it('keeps healthy in-transit progress and one created receipt after the same signed created event replays', async () => {
    const durable = {
      runId: 'run-1', payoutId: 'po_123', status: 'pending_reconciliation',
      stage: 'payout_create_in_progress', version: 1,
      claimToken: null as string | null, claimExpiresAt: null as string | null,
    };
    const deps = createDeps({
      projectPayoutStage: async ({ runId, targetStage }) => {
        deps.calls.sequence.push('project_stage');
        expect({ runId, payoutId: durable.payoutId }).toEqual({ runId: durable.runId, payoutId: 'po_123' });
        if (durable.status !== 'pending_reconciliation') return false;
        if (durable.stage === targetStage) return true;
        // Model the final SQL override's locked, identity-bound no-op.
        if (durable.stage === 'payout_in_transit' && targetStage === 'payout_pending'
          && durable.claimToken === null && durable.claimExpiresAt === null) return true;
        if (durable.stage === 'payout_create_in_progress' ||
          (durable.stage === 'payout_pending' && targetStage === 'payout_in_transit')) {
          durable.stage = targetStage;
          durable.version += 1;
          return true;
        }
        return false;
      },
      decideRejectedPayoutStagePark: async () => {
        throw new Error('healthy progress must not enter guarded parking');
      },
    });
    const created = payoutEvent({ eventId: 'evt_created', eventType: 'payout.created', observedStatus: 'pending' });
    const transit = payoutEvent({ eventId: 'evt_transit', eventType: 'payout.updated', observedStatus: 'in_transit' });
    expect(await reconcileConnectPayoutEvent(created, deps)).toEqual({ status: 'evidence_recorded', runId: 'run-1' });
    expect(await reconcileConnectPayoutEvent(transit, deps)).toEqual({ status: 'evidence_recorded', runId: 'run-1' });
    const beforeReplay = { ...durable };
    expect(await reconcileConnectPayoutEvent(created, deps)).toEqual({ status: 'evidence_recorded', runId: 'run-1' });
    expect(durable).toEqual(beforeReplay);
    expect(durable.stage).toBe('payout_in_transit');
    expect(durable.version).toBe(3);
    expect(deps.calls.eventAppends.map(({ eventId }) => eventId)).toEqual(['evt_created', 'evt_transit']);
    expect(deps.calls.eventAppends.filter(({ eventId }) => eventId === 'evt_created')).toHaveLength(1);
    expect(deps.calls.sequence).toEqual(['append_event', 'project_stage', 'append_event', 'project_stage', 'append_event', 'project_stage']);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });

  it.each(['claimed', 'action_required'] as const)('routes %s in-transit replay refusal to guarded parking', async (state) => {
    const durable = { status: state === 'claimed' ? 'pending_reconciliation' : 'reconciliation_needed',
      stage: state === 'claimed' ? 'payout_in_transit' : 'action_required',
      payoutId: 'po_123', claimToken: state === 'claimed' ? 'claim-1' : null, version: 3 };
    const deps = createDeps({
      projectPayoutStage: async ({ targetStage }) => {
        deps.calls.sequence.push('project_stage');
        expect(targetStage).toBe('payout_pending');
        return durable.status === 'pending_reconciliation' && durable.stage === 'payout_in_transit'
          && durable.payoutId === 'po_123' && durable.claimToken === null;
      },
      decideRejectedPayoutStagePark: async (input) => {
        deps.calls.sequence.push('decide_stage_park');
        expect(input).toMatchObject({ runId: 'run-1', payoutId: 'po_123', targetStage: 'payout_pending' });
        return 'parked';
      },
    });
    const created = payoutEvent({ eventId: 'evt_created', eventType: 'payout.created', observedStatus: 'pending' });
    expect(await reconcileConnectPayoutEvent(created, deps)).toEqual({ status: 'reconciliation_needed', runId: 'run-1' });
    expect(durable.version).toBe(3);
    expect(deps.calls.sequence).toEqual(['append_event', 'project_stage', 'decide_stage_park']);
  });
  it('wires production adapter to the stage-specific RPC with bounded decision logging', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/decideRejectedPayoutStagePark:\s*\(input\)\s*=>\s*decideRejectedPayoutStagePark\(supabaseAdmin, input\)/);
    expect(source).toMatch(/'fn_decide_rejected_payout_stage_park' as never/);
    for (const argument of ['p_run_id', 'p_payout_id', 'p_target_stage', 'p_failure_reason']) {
      expect(source).toContain(argument);
    }
    expect(source).toMatch(/Payout stage conflict decision', \{ eventId: input\.eventId, category: data \}/);
  });

  it('routes only the named stage conflict through the decision after an adapter refusal', async () => {
    const deps = createDeps({
      projectPayoutStage: async () => { throw new Error('PAYOUT_STAGE_PROJECTION_CONFLICT'); },
      decideRejectedPayoutStagePark: async () => 'superseded_paid',
    } as Partial<ConnectPayoutReconciliationDeps>);
    expect(await reconcileConnectPayoutEvent(payoutEvent({ eventType: 'payout.created', observedStatus: 'pending' }), deps))
      .toEqual({ status: 'evidence_recorded', runId: 'run-1' });
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });
  it('does not park a complete same-payout paid projection arriving between stage refusal and park decision', async () => {
    const durable = { status: 'pending_reconciliation', stage: 'payout_pending', payoutId: 'po_123', paidAt: null as string | null, mapping: 'pending_reconciliation', shipmentPayoutId: null as string | null };
    const deps = createDeps({
      projectPayoutStage: async (input) => {
        deps.calls.sequence.push('project_stage');
        deps.calls.stageProjections.push(input);
        // Another webhook commits its complete atomic paid projection here.
        Object.assign(durable, { status: 'paid', stage: 'paid_observed', paidAt: '2026-06-21T20:00:00.000Z', mapping: 'paid', shipmentPayoutId: 'po_123' });
        return false;
      },
      markRunReconciliationNeeded: async (input) => {
        deps.calls.sequence.push('legacy_park');
        deps.calls.reconciliationNeeded.push(input);
        durable.status = 'reconciliation_needed';
      },
      // The new stage-specific RPC must decide under a row lock after the
      // refused projection, not trust the stale snapshot read above.
      decideRejectedPayoutStagePark: async (input: unknown) => {
        deps.calls.sequence.push('decide_stage_park');
        expect(input).toMatchObject({ runId: 'run-1', payoutId: 'po_123', targetStage: 'payout_pending' });
        return 'superseded_paid';
      },
    } as Partial<ConnectPayoutReconciliationDeps>);
    expect(await reconcileConnectPayoutEvent(payoutEvent({ eventType: 'payout.created', observedStatus: 'pending' }), deps))
      .toEqual({ status: 'evidence_recorded', runId: 'run-1' });
    expect(deps.calls.sequence).toEqual(['append_event', 'project_stage', 'decide_stage_park']);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
    expect(durable).toEqual({ status: 'paid', stage: 'paid_observed', payoutId: 'po_123', paidAt: '2026-06-21T20:00:00.000Z', mapping: 'paid', shipmentPayoutId: 'po_123' });
  });

  for (const [name, payoutId, mapping, shipmentPayoutId] of [
    ['incomplete paid mapping', 'po_123', 'pending_reconciliation', 'po_123'],
    ['different payout identity', 'po_other', 'paid', 'po_other'],
  ] as const) {
    it(`does not silently accept ${name} after a progress refusal`, async () => {
      const deps = createDeps({
        projectPayoutStage: async () => false,
        decideRejectedPayoutStagePark: async (input: unknown) => {
          expect(input).toMatchObject({ runId: 'run-1', payoutId: 'po_123', targetStage: 'payout_in_transit' });
          expect({ payoutId, mapping, shipmentPayoutId }).not.toEqual({ payoutId: 'po_123', mapping: 'paid', shipmentPayoutId: 'po_123' });
          return 'parked';
        },
      } as Partial<ConnectPayoutReconciliationDeps>);
      expect(await reconcileConnectPayoutEvent(payoutEvent({ eventType: 'payout.updated', observedStatus: 'in_transit' }), deps))
        .toEqual({ status: 'reconciliation_needed', runId: 'run-1' });
    });
  }

  it('retries a duplicate progress event after a decision RPC error without generic parking', async () => {
    let attempts = 0;
    const deps = createDeps({
      projectPayoutStage: async () => { deps.calls.sequence.push('project_stage'); return false; },
      decideRejectedPayoutStagePark: async () => {
        deps.calls.sequence.push('decide_stage_park');
        if (++attempts === 1) throw new Error('decision database unavailable');
        return 'superseded_paid';
      },
    });
    const event = payoutEvent({ eventType: 'payout.created', observedStatus: 'pending' });
    await expect(reconcileConnectPayoutEvent(event, deps)).rejects.toThrow('decision database unavailable');
    expect(await reconcileConnectPayoutEvent(event, deps)).toEqual({ status: 'evidence_recorded', runId: 'run-1' });
    expect(deps.calls.sequence).toEqual(['append_event', 'project_stage', 'decide_stage_park', 'append_event', 'project_stage', 'decide_stage_park']);
    expect(deps.calls.eventAppends).toHaveLength(1);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });

  it('reports a genuine identity conflict without a generic park', async () => {
    const deps = createDeps({
      projectPayoutStage: async () => false,
      decideRejectedPayoutStagePark: async () => 'identity_conflict',
    });
    expect(await reconcileConnectPayoutEvent(payoutEvent({ eventType: 'payout.created', observedStatus: 'pending' }), deps))
      .toEqual({ status: 'reconciliation_needed', runId: 'run-1' });
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });

  it('escalates a genuine stage projection database error rather than treating it as paid supersession', async () => {
    const deps = createDeps({
      projectPayoutStage: async () => { throw new Error('database unavailable'); },
      decideRejectedPayoutStagePark: async () => { throw new Error('must not decide on DB error'); },
    } as Partial<ConnectPayoutReconciliationDeps>);
    expect(await reconcileConnectPayoutEvent(payoutEvent({ eventType: 'payout.created', observedStatus: 'pending' }), deps))
      .toEqual({ status: 'reconciliation_needed', runId: 'run-1' });
    expect(deps.calls.reconciliationNeeded).toEqual([{ runId: 'run-1', failureReason: 'database unavailable' }]);
  });
  it('retains distinct late progress evidence without parking a fully paid same-payout run when SQL accepts the no-op', async () => {
    const durable = { status: 'paid', stage: 'paid_observed', payoutId: 'po_123', paidAt: '2026-06-21T20:00:00.000Z' };
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1', status: durable.status, stripe_payout_id: durable.payoutId,
        seller_id: 'seller-1', paid_at: durable.paidAt,
      }),
      // This is the proposed SQL acceptance result, not the deployed adapter:
      // the SQL-text test separately fails until the locked guard exists.
      projectPayoutStage: async (input) => {
        deps.calls.stageProjections.push(input);
        return true;
      },
    });
    for (const [eventId, eventType, observedStatus, targetStage] of [
      ['evt_late_created', 'payout.created', 'pending', 'payout_pending'],
      ['evt_late_transit', 'payout.updated', 'in_transit', 'payout_in_transit'],
    ] as const) {
      expect(await reconcileConnectPayoutEvent(payoutEvent({ eventId, eventType, observedStatus }), deps))
        .toEqual({ status: 'evidence_recorded', runId: 'run-1' });
      expect(deps.calls.stageProjections.at(-1)).toEqual({ runId: 'run-1', targetStage });
    }
    expect(deps.calls.eventAppends.map(({ eventId }) => eventId)).toEqual(['evt_late_created', 'evt_late_transit']);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
    expect(durable).toEqual({ status: 'paid', stage: 'paid_observed', payoutId: 'po_123', paidAt: '2026-06-21T20:00:00.000Z' });
  });

  it('retains evidence but never claims a rejected progress projection changed the run', async () => {
    const deps = createDeps({
      findRunForPayout: async () => ({ id: 'run-1', status: 'paid', stripe_payout_id: 'po_123', seller_id: 'seller-1', paid_at: null }),
      projectPayoutStage: async (input) => {
        deps.calls.stageProjections.push(input);
        return false; // Incomplete terminal state: SQL must refuse it.
      },
    });
    expect(await reconcileConnectPayoutEvent(payoutEvent({ eventType: 'payout.created', observedStatus: 'pending' }), deps))
      .toEqual({ status: 'evidence_recorded', runId: 'run-1' });
    expect(deps.calls.eventAppends).toHaveLength(1);
    expect(deps.calls.stageProjections).toHaveLength(1);
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });
  it('projects payout.created to payout_pending without a Stripe payout state before creation', async () => {
    const calls: unknown[] = [];
    const deps = createDeps({
      projectPayoutStage: async (input) => {
        calls.push(input);
      },
    });

    await reconcileConnectPayoutEvent(
      payoutEvent({
        eventId: 'evt_created',
        eventType: 'payout.created',
        observedStatus: 'pending',
      }),
      deps,
    );

    expect(calls).toEqual([
      { runId: 'run-1', targetStage: 'payout_pending' },
    ]);
  });

  it('projects payout.updated in_transit to payout_in_transit', async () => {
    const calls: unknown[] = [];
    const deps = createDeps({
      projectPayoutStage: async (input) => {
        calls.push(input);
      },
    });

    await reconcileConnectPayoutEvent(
      payoutEvent({
        eventId: 'evt_updated',
        eventType: 'payout.updated',
        observedStatus: 'in_transit',
      }),
      deps,
    );

    expect(calls).toEqual([
      { runId: 'run-1', targetStage: 'payout_in_transit' },
    ]);
  });

  it('a refused atomic projection applies no dependent write and parks into reconciliation_needed', async () => {
    // Terminal interleaving: another writer (webhook projection) consumed the
    // run while this delivery applied its outcome; the atomic RPC returns
    // FALSE and the refused unit must never grow dependent mapping or
    // shipment writes on top — there are none left for the webhook to apply.
    const deps = createDeps({
      markRunStatus: async (input) => {
        deps.calls.sequence.push('project_outcome');
        deps.calls.runStatuses.push(input);
        return false;
      },
    });

    const result = await reconcileConnectPayoutEvent(
      payoutEvent({
        eventType: 'payout.paid',
        observedStatus: 'paid',
      }),
      deps,
    );

    expect(result).toEqual({ status: 'reconciliation_needed', runId: 'run-1' });
    // Evidence is appended before the projection (append-only evidence
    // ordering), and exactly one atomic projection call is made: refusal
    // applies nothing else and parks the run through the guarded RPC.
    expect(deps.calls.sequence).toEqual([
      'append_event',
      'project_outcome',
      'mark_reconciliation_needed',
    ]);
    expect(deps.calls.runStatuses).toHaveLength(1);
  });

  it('keeps distinct same-payout paid evidence from parking an already-paid terminal projection', async () => {
    // Deterministic sequential SQL-gate model, NOT a live database concurrency
    // proof. Both deliveries read the same pre-terminal snapshot before either
    // projection. The second event has a distinct signed event identity.
    const snapshot = {
      id: 'run-1',
      status: 'pending_reconciliation',
      stripe_payout_id: 'po_123',
      seller_id: 'seller-1',
      paid_at: null,
    };
    const durable = {
      status: 'pending_reconciliation',
      paidAt: null as string | null,
      mapping: 'pending_reconciliation',
      shipmentPayoutId: null as string | null,
    };
    const deps = createDeps({
      findRunForPayout: async () => ({ ...snapshot }),
      markRunStatus: async (input) => {
        deps.calls.sequence.push('project_outcome');
        deps.calls.runStatuses.push(input);
        // New RPC accepts only a fully consistent same-payout paid projection.
        if (durable.status === 'paid') {
          return input.status === 'paid' && durable.paidAt !== null
            && durable.mapping === 'paid'
            && durable.shipmentPayoutId === input.payoutId;
        }
        durable.status = input.status;
        durable.paidAt = input.occurredAt;
        durable.mapping = 'paid';
        durable.shipmentPayoutId = input.payoutId;
        return true;
      },
      markRunReconciliationNeeded: async (input) => {
        deps.calls.sequence.push('mark_reconciliation_needed');
        deps.calls.reconciliationNeeded.push(input);
        // Deployed park RPC permits overwriting paid while retaining paid_at.
        durable.status = 'reconciliation_needed';
      },
    });

    const first = payoutEvent({ eventId: 'evt_paid_a' });
    const second = payoutEvent({ eventId: 'evt_paid_b' });
    expect(await reconcileConnectPayoutEvent(first, deps)).toEqual({
      status: 'reconciled', runId: 'run-1',
    });
    expect(await reconcileConnectPayoutEvent(second, deps)).toEqual({
      status: 'reconciled', runId: 'run-1',
    });
    expect(deps.calls.eventAppends.map((event) => event.eventId)).toEqual([
      'evt_paid_a', 'evt_paid_b',
    ]);
    expect(durable).toEqual({
      status: 'paid',
      paidAt: first.occurredAt,
      mapping: 'paid',
      shipmentPayoutId: 'po_123',
    });
    expect(deps.calls.reconciliationNeeded).toEqual([]);
  });

  it('a resumed paid handler after a failed handler cannot restore the shipment payout id', async () => {
    // paid/failed interleaving: the failed handler already won — its atomic
    // unit projected the run terminal-failed and cleared the shipment payout
    // id. A resumed paid delivery re-reads a stale pre-failure snapshot
    // (pending_reconciliation); the atomic RPC's terminal gate refuses the
    // paid projection, so the webhook applies no dependent write at all and
    // the delivery parks through the guarded RPC.
    let projectionCalls = 0;
    const deps = createDeps({
      findRunForPayout: async () => ({
        id: 'run-1',
        status: 'pending_reconciliation',
        stripe_payout_id: 'po_123',
        seller_id: 'seller-1',
        paid_at: null,
      }),
      markRunStatus: async (input) => {
        deps.calls.sequence.push('project_outcome');
        deps.calls.runStatuses.push(input);
        projectionCalls += 1;
        // The durable run was already projected terminal-failed by the
        // failed handler (whose atomic unit also cleared the shipment payout
        // id): the guarded RPC refuses this paid projection, so the shipment
        // payout id can never be restored behind the failed run.
        return false;
      },
    });

    await expect(
      reconcileConnectPayoutEvent(payoutEvent(), deps),
    ).resolves.toEqual({ status: 'reconciliation_needed', runId: 'run-1' });

    expect(projectionCalls).toBe(1);
    expect(deps.calls.reconciliationNeeded).toEqual([
      {
        runId: 'run-1',
        failureReason: 'PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT',
      },
    ]);
  });
});

describe('defensive signed account event extraction', () => {
  it('never casts the signed payload to Stripe.Account: it extracts documented fields only', () => {
    // The real signed event shape for an external-account update carries the
    // bank account object, whose `account` field holds the connected account.
    const extraction = extractSignedAccountEventData({
      eventType: 'account.external_account.updated',
      dataObject: {
        id: 'ba_1',
        account: 'acct_1',
        status: 'errored',
      },
    });

    expect(extraction).not.toBeNull();
    expect(extraction).toMatchObject({
      kind: 'external_account_updated',
      accountId: 'acct_1',
      externalAccountStatus: 'errored',
    });
  });

  it('parses Stripe list-shaped external_accounts (object with data), not a raw array', () => {
    const extraction = extractSignedAccountEventData({
      eventType: 'account.updated',
      dataObject: {
        id: 'acct_1',
        payouts_enabled: true,
        default_currency: 'mxn',
        external_accounts: {
          object: 'list',
          data: [
            {
              id: 'ba_1',
              object: 'bank_account',
              status: 'verification_failed',
              currency: 'mxn',
              default_for_currency: true,
            },
          ],
        },
      },
    });

    expect(extraction).toMatchObject({
      kind: 'account_updated',
      accountId: 'acct_1',
      externalAccountId: 'ba_1',
      payoutsEnabled: true,
      externalAccountStatus: 'verification_failed',
    });
  });

  it('selects the default-for-currency MXN payout destination instead of the first listed bank account', () => {
    // A non-default ERRORED bank account listed first must never gate payout
    // actionability: Stripe pays out to the default external account for the
    // account's currency (MXN for Selene sellers), not to an arbitrary list
    // entry.
    const extraction = extractSignedAccountEventData({
      eventType: 'account.updated',
      dataObject: {
        id: 'acct_1',
        payouts_enabled: null,
        default_currency: 'mxn',
        external_accounts: {
          object: 'list',
          data: [
            { id: 'ba_bad', object: 'bank_account', status: 'errored' },
            {
              id: 'ba_mxn',
              object: 'bank_account',
              status: 'verified',
              currency: 'mxn',
              default_for_currency: true,
            },
          ],
        },
      },
    });

    expect(extraction).toMatchObject({
      kind: 'account_updated',
      accountId: 'acct_1',
      externalAccountId: 'ba_mxn',
      externalAccountStatus: 'verified',
    });
  });

  it('without any default payout destination a non-default errored bank account contributes no status evidence', () => {
    // When no default_for_currency destination can be established, an
    // arbitrary non-default errored entry must never falsely mark the seller
    // non-actionable: the status evidence stays undetermined.
    const extraction = extractSignedAccountEventData({
      eventType: 'account.updated',
      dataObject: {
        id: 'acct_1',
        payouts_enabled: null,
        external_accounts: {
          object: 'list',
          data: [
            { id: 'ba_bad', object: 'bank_account', status: 'errored' },
            { id: 'ba_2', object: 'bank_account', status: 'verified' },
          ],
        },
      },
    });

    expect(extraction).toEqual({
      kind: 'account_updated',
      accountId: 'acct_1',
      externalAccountId: null,
      payoutsEnabled: null,
      externalAccountStatus: null,
    });
  });

  it('with multiple per-currency defaults, prefers the default matching the account default_currency', () => {
    const extraction = extractSignedAccountEventData({
      eventType: 'account.updated',
      dataObject: {
        id: 'acct_1',
        payouts_enabled: null,
        default_currency: 'mxn',
        external_accounts: {
          object: 'list',
          data: [
            {
              id: 'ba_usd',
              object: 'bank_account',
              status: 'errored',
              currency: 'usd',
              default_for_currency: true,
            },
            {
              id: 'ba_mxn',
              object: 'bank_account',
              status: 'verified',
              currency: 'mxn',
              default_for_currency: true,
            },
          ],
        },
      },
    });

    expect(extraction).toMatchObject({
      externalAccountId: 'ba_mxn',
      externalAccountStatus: 'verified',
    });
  });

  it('with multiple per-currency defaults and no documented account default_currency, status evidence stays undetermined', () => {
    const extraction = extractSignedAccountEventData({
      eventType: 'account.updated',
      dataObject: {
        id: 'acct_1',
        payouts_enabled: null,
        external_accounts: {
          object: 'list',
          data: [
            {
              id: 'ba_usd',
              object: 'bank_account',
              status: 'errored',
              currency: 'usd',
              default_for_currency: true,
            },
            {
              id: 'ba_mxn',
              object: 'bank_account',
              status: 'verified',
              currency: 'mxn',
              default_for_currency: true,
            },
          ],
        },
      },
    });

    expect(extraction).toEqual({
      kind: 'account_updated',
      accountId: 'acct_1',
      externalAccountId: null,
      payoutsEnabled: null,
      externalAccountStatus: null,
    });
  });

  it('ignores external-account list entries that are not bank accounts', () => {
    const extraction = extractSignedAccountEventData({
      eventType: 'account.updated',
      dataObject: {
        id: 'acct_1',
        payouts_enabled: true,
        external_accounts: {
          object: 'list',
          data: [
            { id: 'card_1', object: 'card', status: 'errored' },
            {
              id: 'ba_1',
              object: 'bank_account',
              status: 'verified',
              currency: 'mxn',
              default_for_currency: true,
            },
          ],
        },
      },
    });

    expect(extraction).toMatchObject({
      kind: 'account_updated',
      accountId: 'acct_1',
      externalAccountId: 'ba_1',
      payoutsEnabled: true,
      // A card status never blocks payout actionability.
      externalAccountStatus: 'verified',
    });
  });

  it('extracts the external bank account id from an external-account event', () => {
    const extraction = extractSignedAccountEventData({
      eventType: 'account.external_account.updated',
      dataObject: {
        id: 'ba_9',
        account: 'acct_1',
        status: 'errored',
      },
    });

    expect(extraction).toMatchObject({
      kind: 'external_account_updated',
      accountId: 'acct_1',
      externalAccountId: 'ba_9',
      externalAccountStatus: 'errored',
    });
  });

  it('falls back to the signed event envelope account only as the account identity', () => {
    // A malformed account object that carries no documented id: the signed
    // event envelope `account` field still identifies the connected account,
    // but every actionability field stays undetermined (evidence-only).
    expect(
      extractSignedAccountEventData({
        eventType: 'account.updated',
        dataObject: { object: 'account' },
        eventAccount: 'acct_1',
      }),
    ).toEqual({
      kind: 'account_updated',
      accountId: 'acct_1',
      externalAccountId: null,
      payoutsEnabled: null,
      externalAccountStatus: null,
    });

    expect(
      extractSignedAccountEventData({
        eventType: 'account.external_account.updated',
        dataObject: { id: 'ba_1', status: 'verified' },
        eventAccount: 'acct_1',
      }),
    ).toEqual({
      kind: 'external_account_updated',
      accountId: 'acct_1',
      externalAccountId: 'ba_1',
      payoutsEnabled: null,
      externalAccountStatus: 'verified',
    });

    // Without a data-object identity or an envelope fallback there is no
    // evidence at all.
    expect(
      extractSignedAccountEventData({
        eventType: 'account.updated',
        dataObject: { object: 'account' },
      }),
    ).toBeNull();
  });

  it('an undocumented event shape resolves to null and can never mark the account healthy', () => {
    expect(
      extractSignedAccountEventData({
        eventType: 'account.updated',
        dataObject: { object: 'account' },
      }),
    ).toBeNull();

    expect(
      extractSignedAccountEventData({
        eventType: 'account.external_account.updated',
        dataObject: { id: 'ba_1' },
      }),
    ).toBeNull();

    expect(
      extractSignedAccountEventData({
        eventType: 'account.updated',
        dataObject: null,
      }),
    ).toBeNull();
  });

  it('an unknown external-account status with no documented payouts flag is undetermined', () => {
    const resolution = resolveAccountActionability({
      kind: 'external_account_updated',
      accountId: 'acct_1',
      externalAccountId: null,
      payoutsEnabled: null,
      externalAccountStatus: 'undocumented_future_status',
    });

    expect(resolution).toEqual({
      actionable: false,
      blockedReason: null,
      undetermined: true,
    });
  });

  it('only explicit payouts_enabled=true observed data can restore actionability', () => {
    // A healthy-looking bank status alone is not account-level healthy
    // evidence: without the documented payouts flag it stays undetermined.
    expect(
      resolveAccountActionability({
        kind: 'account_updated',
        accountId: 'acct_1',
        externalAccountId: null,
        payoutsEnabled: null,
        externalAccountStatus: 'verified',
      }),
    ).toEqual({ actionable: false, blockedReason: null, undetermined: true });

    expect(
      resolveAccountActionability({
        kind: 'account_updated',
        accountId: 'acct_1',
        externalAccountId: null,
        payoutsEnabled: false,
        externalAccountStatus: 'verified',
      }),
    ).toEqual({
      actionable: false,
      blockedReason: 'payouts_disabled',
      undetermined: false,
    });
  });
});

describe('phase 2B slice 2 webhook account surface is RPC-only', () => {
  const readIndexSource = (): string =>
    readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('never reads or writes the revoked account tables directly', () => {
    const source = readIndexSource();

    expect(source).not.toMatch(
      /\.from\(\s*['"]connect_account_events['"]/,
    );
    expect(source).not.toMatch(
      /\.from\(\s*['"]connect_account_actionability['"]/,
    );
  });

  it('records timestamped evidence and commits actionability through acquire/CAS RPCs only', () => {
    const source = readIndexSource();

    expect(source).toMatch(/fn_record_connect_account_event/);
    expect(source).toMatch(/fn_acquire_connect_account_refresh/);
    expect(source).toMatch(/fn_commit_connect_account_refresh/);
    expect(source).not.toMatch(/fn_apply_connect_account_actionability/);
    // stripe_created is signed evidence only; current-state ordering is generation.
    expect(source).toMatch(/p_stripe_created\s*:/);
    expect(source).toMatch(/p_expected_generation\s*:/);
    // The evidence append carries the extracted external bank account id.
    expect(source).toMatch(/p_external_account_id\s*:/);
  });
});

describe('phase 2B slice 5 webhook park and stage-projection surface is guarded', () => {
  const readIndexSource = (): string =>
    readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('parks reconciliation-needed only through the guarded park RPC, never a direct run update', () => {
    const source = readIndexSource();

    // The reconciliation-needed park must be a guarded, version-bumping,
    // claim-clearing RPC — not a direct UPDATE that could regress a terminal
    // status or a newer stage behind an in-flight writer.
    expect(source).toMatch(/fn_mark_payout_run_reconciliation_needed/);
    expect(source).not.toMatch(
      /\.from\(\s*'connect_payout_runs'\s*\)[\s\S]{0,300}\.update\(\s*\{[\s\S]{0,400}?status:\s*'reconciliation_needed'/,
    );
  });

  it('never ignores a rejected intermediate stage projection', () => {
    const source = readIndexSource();

    // fn_project_payout_run_stage returns FALSE when the monotonic gate
    // refuses the progression: the webhook must observe that result, never
    // treat the projection as applied.
    expect(source).toMatch(/PAYOUT_STAGE_PROJECTION_CONFLICT/);
  });
});

describe('phase 2B final slice webhook terminal surface is atomic', () => {
  const readIndexSource = (): string =>
    readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('projects terminal outcomes only through the single atomic RPC, never separate shipment writes', () => {
    const source = readIndexSource();

    // The terminal projection unit (run + mappings + shipment payout-id
    // set/clear) is one SECURITY DEFINER RPC; the webhook wiring keeps no
    // separate mapping-projection, release, or clear write the handler could
    // apply after a refusal.
    expect(source).toMatch(/fn_project_payout_run_terminal/);
    expect(source).not.toMatch(
      /markConnectPayoutRunShipmentsStatus|markConnectShipmentsReleased|clearConnectShipmentsReleased|listConnectPayoutRunShipmentIds/,
    );
    expect(source).not.toMatch(
      /\.from\(\s*'connect_payout_run_shipments'\s*\)[\s\S]{0,300}\.update\(/,
    );
    expect(source).not.toMatch(
      /\.from\(\s*'shipments'\s*\)[\s\S]{0,300}\.update\(\s*\{[\s\S]{0,200}?stripe_payout_id/,
    );
  });

  it('never treats a refused atomic projection as applied', () => {
    const source = readIndexSource();

    // The atomic RPC's FALSE result must raise the terminal projection
    // conflict (which parks the run), never be swallowed as success.
    expect(source).toMatch(/PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT/);
  });
});
