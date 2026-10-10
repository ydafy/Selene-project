import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ConnectPayoutReleaseError,
  isDefinitiveStripePayoutCreateFailure,
  parseReleaseRequestBody,
  getStripeBalanceInsufficientLogMeta,
  releaseConnectPayout,
  sumAvailableBalanceForCurrency,
  type ConnectPayoutReleaseDependencies,
  type ReleaseQueueRow,
} from './release-connect-payout';

const completedShipment = (
  overrides: Partial<ReleaseQueueRow> = {},
): ReleaseQueueRow => ({
  shipment_id: 'shipment-1',
  seller_id: 'seller-1',
  status: 'completed',
  completed_at: '2026-06-21T12:00:00.000Z',
  is_eligible: true,
  ineligible_reason: null,
  order_id: 'order-1',
  release_amount_cents: 12_500,
  stripe_account_id: 'acct_seller_1',
  stripe_onboarding_status: 'complete',
  stripe_transfer_id: null,
  ...overrides,
});

type RetryRunRecord = {
  id: string;
  seller_id: string;
  shipment_ids: string[];
  amount: number;
  status:
    | 'pending_reconciliation'
    | 'paid'
    | 'failed'
    | 'canceled'
    | 'reconciliation_needed';
  stripe_payout_id: string | null;
  retry_of_run_id: string | null;
  release_stage_version?: number;
};

type RetryReleaseDependencies = ConnectPayoutReleaseDependencies & {
  findRunById: (runId: string) => Promise<RetryRunRecord | null>;
  findRetryChildByParentRunId: (
    parentRunId: string,
  ) => Promise<RetryRunRecord | null>;
};

type RetryReleaseExecutor = (
  input: { actorId: string; retryRunId: string },
  deps: RetryReleaseDependencies,
) => ReturnType<typeof releaseConnectPayout>;

const retryFailedConnectPayout =
  releaseConnectPayout as unknown as RetryReleaseExecutor;

const failedParentRun = (
  overrides: Partial<RetryRunRecord> = {},
): RetryRunRecord => ({
  id: 'run-failed',
  seller_id: 'seller-1',
  shipment_ids: ['shipment-1'],
  amount: 12_500,
  status: 'failed',
  stripe_payout_id: 'po_failed_parent',
  retry_of_run_id: null,
  release_stage_version: 1,
  ...overrides,
});

function createDeps(overrides: Partial<RetryReleaseDependencies> = {}) {
  const calls = {
    createdRuns: [] as unknown[],
    mappings: [] as unknown[],
    transfers: [] as unknown[],
    transferUpdates: [] as unknown[],
    payouts: [] as unknown[],
    retries: [] as unknown[],
    fenceBegins: [] as unknown[],
    fenceCompletions: [] as unknown[],
    fenceFailures: [] as unknown[],
    fenceAborts: [] as unknown[],
    balanceRetrievals: [] as unknown[],
    actionabilityLookups: [] as unknown[],
    updates: [] as unknown[],
    syncFailures: [] as unknown[],
    parentRunLookups: [] as string[],
    retryChildLookups: [] as string[],
    payoutRetrievals: [] as unknown[],
    sequence: [] as string[],
  };

  const deps: RetryReleaseDependencies & { calls: typeof calls } = {
    calls,
    getActorProfile: async () => ({ role: 'admin' }),
    findRunByIdempotencyKey: async () => null,
    findRunById: async (runId) => {
      calls.parentRunLookups.push(runId);
      return failedParentRun({ id: runId });
    },
    findRetryChildByParentRunId: async (parentRunId) => {
      calls.retryChildLookups.push(parentRunId);
      return null;
    },
    retrieveStripePayout: async (input) => {
      calls.payoutRetrievals.push(input);
      return { id: input.payoutId, status: 'failed', failure_balance_transaction: 'txn_returned_1', amount: 12_500, currency: 'mxn' };
    },
    findActiveShipmentMappings: async () => [],
    loadReleaseRows: async () => [completedShipment()],
    createRun: async (input) => {
      calls.sequence.push('createRun');
      calls.createdRuns.push(input);
      return { id: 'run-1', status: 'pending_reconciliation', release_stage: 'release_accepted', release_stage_version: 1, ...input };
    },
    createRunShipments: async (input) => {
      calls.sequence.push('createRunShipments');
      calls.mappings.push(input);
    },
    loadReleaseOrders: async () => [
      {
        id: 'order-1',
        stripe_charge_id: null,
        stripe_transfer_group: null,
      },
    ],
    createStripeTransfer: async (input) => {
      calls.sequence.push('createStripeTransfer');
      calls.transfers.push(input);
      return { id: 'tr_123' };
    },
    markShipmentStripeTransferId: async (input) => {
      calls.transferUpdates.push(input);
    },
    retrieveConnectedBalance: async (input) => {
      calls.sequence.push('retrieveConnectedBalance');
      calls.balanceRetrievals.push(input);
      return { available: [{ amount: 99_999, currency: 'mxn' }] };
    },
    getConnectAccountActionability: async (input) => {
      calls.actionabilityLookups.push(input);
      return { isActionable: true, blockedReason: null };
    },
    createStripePayout: async (input) => {
      calls.sequence.push('createStripePayout');
      calls.payouts.push(input);
      return { id: 'po_123' };
    },
    markRunRetrying: async (input) => {
      calls.retries.push(input);
      return input.expectedVersion + 1;
    },
    beginPayoutCreateFence: async (input) => {
      calls.sequence.push('beginPayoutCreateFence');
      calls.fenceBegins.push(input);
      return 2;
    },
    completePayoutCreateFence: async (input) => {
      calls.sequence.push('completePayoutCreateFence');
      calls.fenceCompletions.push(input);
      return true;
    },
    failPayoutCreateFromFence: async (input) => {
      calls.fenceFailures.push(input);
      return true;
    },
    abortPayoutCreateToActionRequired: async (input) => {
      calls.fenceAborts.push(input);
      return true;
    },
    markRunPendingReconciliation: async (input) => {
      calls.updates.push(input);
      return input.expectedVersion + 1;
    },
    markRunPayoutSyncFailed: async (input) => {
      calls.syncFailures.push(input);
      return true;
    },
    ...overrides,
  };

  // Existing fixtures predate the version column; model its deployed default.
  const lookup = deps.findRunByIdempotencyKey;
  deps.findRunByIdempotencyKey = async (key) => {
    const row = await lookup(key);
    return row ? { release_stage_version: 1, ...row } : null;
  };
  return deps;
}

describe('atomic pre-payout transition refusal', () => {
  const request = { actorId: 'admin-1', sellerId: 'seller-1', shipmentIds: ['shipment-1'], idempotencyKey: 'cas-key' };
  it('stops on an explicit retry refusal without transfers, fence, or cleanup', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({ ...failedParentRun(), stripe_payout_id: null, release_stage: 'payout_failed', release_stage_version: 7 }),
      markRunRetrying: async () => null,
    });
    await expect(releaseConnectPayout(request, deps)).rejects.toThrow('PAYOUT_RESUME_MAPPING_CONFLICT');
    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.fenceBegins).toEqual([]);
    expect(deps.calls.updates).toEqual([]);
    expect(deps.calls.fenceFailures).toEqual([]);
    expect(deps.calls.syncFailures).toEqual([]);
  });
  for (const newer of ['paid', 'failed', 'canceled', 'payout', 'claim', 'fence', 'same-stage-new-version', 'mapping-paid']) {
    it(`preserves ${newer} authority after a delayed balance response`, async () => {
      const state = { status: 'pending_reconciliation', stage: 'release_accepted', version: 11, payout: null as string | null, token: null as string | null, mapping: 'pending_reconciliation' };
      let intentSeen: unknown;
      const deps = createDeps({
        createRun: async () => ({ id: 'run-1', status: 'pending_reconciliation', release_stage: state.stage, release_stage_version: state.version }),
        loadReleaseOrders: async () => [{ id: 'order-1', stripe_charge_id: 'ch_1', stripe_transfer_group: 'group_1' }],
        retrieveConnectedBalance: async () => {
          state.version += 1;
          if (['paid', 'failed', 'canceled'].includes(newer)) state.status = newer;
          if (newer === 'payout') state.payout = 'po_newer';
          if (newer === 'claim') state.token = 'claim_newer';
          if (newer === 'fence') state.stage = 'payout_create_in_progress';
          if (newer === 'mapping-paid') state.mapping = 'paid';
          return { available: [] };
        },
        // Model the RPC's version CAS, not a PostgreSQL runtime assertion.
        markRunPendingReconciliation: async (intent) => {
          intentSeen = intent;
          return intent.expectedVersion === state.version ? state.version + 1 : null;
        },
      });
      await expect(releaseConnectPayout(request, deps)).rejects.toThrow('PAYOUT_RESUME_MAPPING_CONFLICT');
      expect(intentSeen).toEqual({ runId: 'run-1', expectedStatus: 'pending_reconciliation', expectedStage: 'release_accepted', expectedVersion: 11, shipmentIds: ['shipment-1'], parent: null });
      expect(state.version).toBe(12);
      expect(state.payout).toBe(newer === 'payout' ? 'po_newer' : null);
      expect(state.token).toBe(newer === 'claim' ? 'claim_newer' : null);
      expect(state.mapping).toBe(newer === 'mapping-paid' ? 'paid' : 'pending_reconciliation');
      expect(deps.calls.parentRunLookups).toEqual([]);
      expect(deps.calls.fenceBegins).toEqual([]);
      expect(deps.calls.fenceFailures).toEqual([]);
      expect(deps.calls.fenceAborts).toEqual([]);
      expect(deps.calls.syncFailures).toEqual([]);
    });
  }
  it('uses the original resumed snapshot after asynchronous balance work', async () => {
    const run = { ...failedParentRun(), stripe_payout_id: null, release_stage: null, release_stage_version: 7 };
    const deps = createDeps({
      findRunByIdempotencyKey: async () => run,
      retrieveConnectedBalance: async () => { run.release_stage_version = 8; return { available: [{ amount: 99_999, currency: 'mxn' }] }; },
      markRunRetrying: async (intent) => {
        expect(intent.expectedVersion).toBe(7);
        return intent.expectedVersion === run.release_stage_version ? 9 : null;
      },
    });
    await expect(releaseConnectPayout(request, deps)).rejects.toThrow('PAYOUT_RESUME_MAPPING_CONFLICT');
    expect(run.release_stage_version).toBe(8);
    expect(deps.calls.fenceBegins).toEqual([]);
  });
  it('carries the successful retry epoch into an insufficient-balance park', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({ ...failedParentRun(), stripe_payout_id: null, release_stage: 'payout_failed', release_stage_version: 7 }),
      loadReleaseOrders: async () => [{ id: 'order-1', stripe_charge_id: 'ch_1', stripe_transfer_group: 'group_1' }],
      retrieveConnectedBalance: async () => ({ available: [] }),
    });
    expect(await releaseConnectPayout(request, deps)).toMatchObject({ success: true, runId: 'run-failed' });
    expect(deps.calls.updates).toEqual([{ runId: 'run-failed', expectedStatus: 'pending_reconciliation', expectedStage: 'awaiting_connected_balance', expectedVersion: 8, shipmentIds: ['shipment-1'], parent: null }]);
  });
  it('parks a new retry child using original parent authority without mutating parent history', async () => {
    const parent = failedParentRun({ release_stage_version: 19 });
    const before = structuredClone(parent);
    const deps = createDeps({
      findRunById: async () => parent,
      loadReleaseRows: async () => [completedShipment({ is_eligible: false, ineligible_reason: 'payout_failed_retry_required', stripe_transfer_id: 'tr_original' })],
      loadReleaseOrders: async () => [{ id: 'order-1', stripe_charge_id: 'ch_1', stripe_transfer_group: 'group_1' }],
      retrieveConnectedBalance: async () => ({ available: [] }),
    });
    expect(await releaseConnectPayout({ actorId: 'admin-1', retryRunId: parent.id }, deps)).toMatchObject({ success: true, runId: 'run-1' });
    expect(deps.calls.updates).toEqual([{ runId: 'run-1', expectedStatus: 'pending_reconciliation', expectedStage: 'release_accepted', expectedVersion: 1, shipmentIds: ['shipment-1'], parent: { runId: parent.id, stageVersion: 19, stripePayoutId: 'po_failed_parent' } }]);
    expect(parent).toEqual(before);
    expect(deps.calls.transfers).toEqual([]);
  });
  it('stops an insufficient-balance park refusal without a later fence or rollback', async () => {
    const deps = createDeps({
      loadReleaseOrders: async () => [{ id: 'order-1', stripe_charge_id: 'ch_1', stripe_transfer_group: 'group_1' }],
      retrieveConnectedBalance: async () => ({ available: [] }),
      markRunPendingReconciliation: async () => null,
    });
    await expect(releaseConnectPayout(request, deps)).rejects.toThrow('PAYOUT_RESUME_MAPPING_CONFLICT');
    expect(deps.calls.fenceBegins).toEqual([]);
    expect(deps.calls.fenceFailures).toEqual([]);
    expect(deps.calls.syncFailures).toEqual([]);
  });
});

describe('releaseConnectPayout', () => {
  it('sums available balance entries for the payout currency only', () => {
    expect(
      sumAvailableBalanceForCurrency(
        [
          { amount: 7_500, currency: 'mxn' },
          { amount: 2_500, currency: 'mxn' },
          { amount: 99_999, currency: 'usd' },
        ],
        'mxn',
      ),
    ).toBe(10_000);

    expect(
      sumAvailableBalanceForCurrency([{ amount: 99_999, currency: 'usd' }], 'mxn'),
    ).toBe(0);
  });

  it('classifies only Stripe 4xx non-idempotency payout create errors as definitive', () => {
    expect(
      isDefinitiveStripePayoutCreateFailure(
        Object.assign(new Error('Stripe balance insufficient'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
          code: 'balance_insufficient',
        }),
      ),
    ).toBe(true);

    expect(
      isDefinitiveStripePayoutCreateFailure(
        Object.assign(new Error('Connection timed out'), {
          type: 'StripeConnectionError',
        }),
      ),
    ).toBe(false);
    expect(
      isDefinitiveStripePayoutCreateFailure(
        Object.assign(new Error('Stripe API unavailable'), {
          type: 'StripeAPIError',
          statusCode: 500,
        }),
      ),
    ).toBe(false);
    expect(
      isDefinitiveStripePayoutCreateFailure(
        Object.assign(new Error('Idempotency conflict'), {
          type: 'StripeIdempotencyError',
          statusCode: 400,
          code: 'idempotency_error',
        }),
      ),
    ).toBe(false);
    expect(isDefinitiveStripePayoutCreateFailure(new Error('Unknown'))).toBe(
      false,
    );
  });

  it('rejects invalid request shapes before orchestration', () => {
    expect(() =>
      parseReleaseRequestBody({
        sellerId: '',
        shipmentIds: ['shipment-1'],
        idempotencyKey: 'release-key-1',
      }),
    ).toThrow('SELLER_ID_REQUIRED');
    expect(() =>
      parseReleaseRequestBody({
        sellerId: 'seller-1',
        shipmentIds: [],
        idempotencyKey: 'release-key-1',
      }),
    ).toThrow('SHIPMENTS_REQUIRED');
  });

  it('rejects an explicit malformed retry id without falling through to fresh release', async () => {
    const deps = createDeps();
    await expect(
      releaseConnectPayout(
        { actorId: 'admin-1', retryRunId: undefined, sellerId: 'seller-1', shipmentIds: ['shipment-1'], idempotencyKey: 'fresh' },
        deps,
      ),
    ).rejects.toThrow('RETRY_RUN_ID_REQUIRED');
    expect(deps.calls.createdRuns).toHaveLength(0);
  });

  it('parses a retry request from retryRunId alone', () => {
    const request = parseReleaseRequestBody({ retryRunId: 'run-failed' });

    expect(request).toEqual({ retryRunId: 'run-failed' });
    expect(Object.keys(request)).toEqual(['retryRunId']);
  });

  it('creates one child for an exact failed parent using only server-derived payout inputs', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          is_eligible: false,
          ineligible_reason: 'payout_failed_retry_required',
          stripe_transfer_id: 'tr_existing',
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: 'ch_123',
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
      createRun: async (input) => {
        deps.calls.createdRuns.push(input);
        return { id: 'run-retry-1', status: 'pending_reconciliation', release_stage: 'release_accepted', release_stage_version: 1 };
      },
    });

    await expect(
      retryFailedConnectPayout(
        { actorId: 'admin-1', retryRunId: 'run-failed' },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-retry-1',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.parentRunLookups).toEqual(['run-failed', 'run-retry-1']);
    expect(deps.calls.payoutRetrievals).toEqual([{ payoutId: 'po_failed_parent', stripeAccountId: 'acct_seller_1' }]);
    expect(deps.calls.retryChildLookups).toEqual(['run-failed']);
    expect(deps.calls.createdRuns).toHaveLength(1);
    const createdRun = deps.calls.createdRuns[0] as {
      actorId: string;
      sellerId: string;
      amount: number;
      idempotencyKey: string;
      retryOfRunId: string;
    };
    expect(createdRun).toMatchObject({
      actorId: 'admin-1',
      sellerId: 'seller-1',
      amount: 12_500,
      retryOfRunId: 'run-failed',
    });
    expect(typeof createdRun.idempotencyKey).toBe('string');
    expect(createdRun.idempotencyKey).toContain('run-failed');
    expect(deps.calls.mappings).toEqual([
      {
        runId: 'run-retry-1',
        shipments: [{ shipmentId: 'shipment-1', netPayout: 12_500 }],
      },
    ]);
    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.transferUpdates).toEqual([]);
    expect(deps.calls.payouts).toEqual([
      {
        stripeAccountId: 'acct_seller_1',
        amount: 12_500,
        currency: 'mxn',
        idempotencyKey: createdRun.idempotencyKey,
        metadata: {
          app_name: 'selene',
          run_id: 'run-retry-1',
          seller_id: 'seller-1',
          shipment_ids: 'shipment-1',
        },
        orderIds: ['order-1'],
      },
    ]);
  });

  it('denies a failed parent without a Stripe payout before child lookup or money operations', async () => {
    const deps = createDeps({ findRunById: async () => failedParentRun({ stripe_payout_id: null }) });
    await expect(retryFailedConnectPayout({ actorId: 'admin-1', retryRunId: 'run-failed' }, deps)).rejects.toThrow();
    expect(deps.calls.payoutRetrievals).toEqual([]);
    expect(deps.calls.retryChildLookups).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.mappings).toEqual([]);
    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.balanceRetrievals).toEqual([]);
  });

  for (const evidence of [
    { status: 'pending' as const, failure_balance_transaction: null },
    { status: 'paid' as const, failure_balance_transaction: null },
    { status: 'failed' as const, failure_balance_transaction: null },
  ]) {
    it(`denies retry when Stripe payout is ${evidence.status} without returned-funds evidence`, async () => {
      const deps = createDeps({
        retrieveStripePayout: async (input) => {
          deps.calls.payoutRetrievals.push(input);
          return { id: input.payoutId, ...evidence, amount: 12_500, currency: 'mxn' };
        },
      });
      await expect(retryFailedConnectPayout({ actorId: 'admin-1', retryRunId: 'run-failed' }, deps)).rejects.toThrow();
      expect(deps.calls.payoutRetrievals).toEqual([{ payoutId: 'po_failed_parent', stripeAccountId: 'acct_seller_1' }]);
      expect(deps.calls.retryChildLookups).toEqual([]);
      expect(deps.calls.createdRuns).toEqual([]);
      expect(deps.calls.mappings).toEqual([]);
      expect(deps.calls.transfers).toEqual([]);
      expect(deps.calls.balanceRetrievals).toEqual([]);
      expect(deps.calls.payouts).toEqual([]);
    });
  }

  for (const mismatch of [
    { id: 'po_other' },
    { amount: 12_499 },
    { currency: 'usd' },
    { failure_balance_transaction: '   ' },
  ]) {
    it(`rejects mismatched Stripe parent evidence ${JSON.stringify(mismatch)}`, async () => {
      const deps = createDeps({
        retrieveStripePayout: async (input) => {
          deps.calls.payoutRetrievals.push(input);
          return {
            id: input.payoutId,
            status: 'failed',
            failure_balance_transaction: 'txn_returned_1',
            amount: 12_500,
            currency: 'mxn',
            ...mismatch,
          };
        },
      });
      await expect(retryFailedConnectPayout({ actorId: 'admin-1', retryRunId: 'run-failed' }, deps)).rejects.toThrow('PAYOUT_RETRY_EVIDENCE_REQUIRED');
      expect(deps.calls.retryChildLookups).toEqual([]);
      expect(deps.calls.createdRuns).toEqual([]);
      expect(deps.calls.transfers).toEqual([]);
      expect(deps.calls.payouts).toEqual([]);
    });
  }

  it('fails closed when Stripe payout retrieval throws', async () => {
    const deps = createDeps({ retrieveStripePayout: async () => { throw new Error('Stripe retrieval unavailable'); } });
    await expect(retryFailedConnectPayout({ actorId: 'admin-1', retryRunId: 'run-failed' }, deps)).rejects.toThrow();
    expect(deps.calls.retryChildLookups).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.mappings).toEqual([]);
    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.balanceRetrievals).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('replays an existing child without creating another run or payout', async () => {
    const deps = createDeps({
      findRetryChildByParentRunId: async (parentRunId) => {
        deps.calls.retryChildLookups.push(parentRunId);
        return failedParentRun({
          id: 'run-retry-existing',
          status: 'pending_reconciliation',
          stripe_payout_id: 'po_retry_existing',
          retry_of_run_id: 'run-failed',
        });
      },
    });

    await expect(
      retryFailedConnectPayout(
        { actorId: 'admin-1', retryRunId: 'run-failed' },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-retry-existing',
      stripePayoutId: 'po_retry_existing',
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.parentRunLookups).toEqual(['run-failed']);
    expect(deps.calls.retryChildLookups).toEqual(['run-failed']);
    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.mappings).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('rejects every non-failed parent status before creating a child or calling Stripe', async () => {
    for (const status of [
      'canceled',
      'paid',
      'pending_reconciliation',
      'reconciliation_needed',
    ] as const) {
      const deps = createDeps({
        findRunById: async (runId) => {
          deps.calls.parentRunLookups.push(runId);
          return failedParentRun({ id: runId, status });
        },
      });

      await expect(
        retryFailedConnectPayout(
          { actorId: 'admin-1', retryRunId: `run-${status}` },
          deps,
        ),
      ).rejects.toEqual(
        new ConnectPayoutReleaseError('PAYOUT_RETRY_PARENT_NOT_FAILED', 409),
      );

      expect(deps.calls.retryChildLookups).toEqual([]);
      expect(deps.calls.createdRuns).toEqual([]);
      expect(deps.calls.payouts).toEqual([]);
      expect(deps.calls.transfers).toEqual([]);
    }
  });

  it('blocks retry when current shipment eligibility has drifted before calling Stripe', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          is_eligible: false,
          ineligible_reason: 'active_dispute',
          stripe_transfer_id: 'tr_existing',
        }),
      ],
    });

    await expect(
      retryFailedConnectPayout(
        { actorId: 'admin-1', retryRunId: 'run-failed' },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('active_dispute', 400));

    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('blocks retry when the server-recomputed amount differs from the failed parent', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          is_eligible: false,
          ineligible_reason: 'payout_failed_retry_required',
          release_amount_cents: 13_000,
          stripe_transfer_id: 'tr_existing',
        }),
      ],
    });

    await expect(
      retryFailedConnectPayout(
        { actorId: 'admin-1', retryRunId: 'run-failed' },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_RELEASE_AMOUNT_CHANGED', 409),
    );

    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('rejects non-admin callers before loading shipments', async () => {
    let loadedShipments = false;
    const deps = createDeps({
      getActorProfile: async () => ({ role: 'user' }),
      loadReleaseRows: async () => {
        loadedShipments = true;
        return [completedShipment()];
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'user-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-1',
        },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('ADMIN_REQUIRED', 403));
    expect(loadedShipments).toBe(false);
  });

  it('reuses an existing idempotency run without creating another Stripe payout', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-existing',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'pending_reconciliation',
        stripe_payout_id: 'po_existing',
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-1',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-existing',
      stripePayoutId: 'po_existing',
      status: 'pending_reconciliation',
      amount: 12_500,
    });
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
  });

  it('creates one transfer per shipment using the order charge and transfer group before payout', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: 'ch_123',
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
      createStripeTransfer: async (input) => {
        deps.calls.sequence.push('createStripeTransfer');
        deps.calls.transfers.push(input);
        return { id: 'tr_shipment_1' };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-transfer',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-1',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toEqual([
      {
        stripeAccountId: 'acct_seller_1',
        amount: 12_500,
        currency: 'mxn',
        sourceTransaction: 'ch_123',
        transferGroup: 'selene_order_order-1',
        idempotencyKey: 'release-key-transfer:run-1:shipment-1',
        metadata: {
          app_name: 'selene',
          run_id: 'run-1',
          shipment_id: 'shipment-1',
          seller_id: 'seller-1',
          order_id: 'order-1',
        },
      },
    ]);
    expect(deps.calls.transferUpdates).toEqual([
      { shipmentId: 'shipment-1', stripeTransferId: 'tr_shipment_1' },
    ]);
    expect(deps.calls.sequence.indexOf('createStripeTransfer')).toBeLessThan(
      deps.calls.sequence.indexOf('createStripePayout'),
    );
  });

  it('retries a single-modal release after shipment transfer persistence fails without manual DB repair', async () => {
    let firstTransferWrite = true;
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: 'ch_123',
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
      markShipmentStripeTransferId: async (input) => {
        deps.calls.transferUpdates.push(input);
        if (firstTransferWrite) {
          firstTransferWrite = false;
          throw new ConnectPayoutReleaseError('SHIPMENT_TRANSFER_UPDATE_FAILED', 500);
        }
      },
      findRunByIdempotencyKey: async (idempotencyKey) => {
        if (idempotencyKey !== 'release-key-transfer-retry') return null;

        return {
          id: 'run-1',
          seller_id: 'seller-1',
          shipment_ids: ['shipment-1'],
          amount: 12_500,
          status: 'pending_reconciliation',
          stripe_payout_id: null,
        };
      },
      findActiveShipmentMappings: async () => [
        { shipmentId: 'shipment-1', runId: 'run-1', status: 'pending_reconciliation' },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-transfer-retry',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('SHIPMENT_TRANSFER_UPDATE_FAILED', 500),
    );

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-transfer-retry',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-1',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toHaveLength(2);
    expect(deps.calls.transferUpdates).toEqual([
      { shipmentId: 'shipment-1', stripeTransferId: 'tr_123' },
      { shipmentId: 'shipment-1', stripeTransferId: 'tr_123' },
    ]);
    expect(deps.calls.retries).toEqual([
      { runId: 'run-1', expectedStatus: 'pending_reconciliation', expectedStage: null, expectedVersion: 1, shipmentIds: ['shipment-1'], parent: null },
      { runId: 'run-1', expectedStatus: 'pending_reconciliation', expectedStage: null, expectedVersion: 1, shipmentIds: ['shipment-1'], parent: null },
    ]);
  });

  it('reuses an existing shipment transfer and skips transfer creation on retry', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: 'tr_existing',
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: 'ch_123',
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-existing-transfer',
        },
        deps,
      ),
    ).resolves.toMatchObject({
      success: true,
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.transferUpdates).toEqual([]);
  });

  it('preserves the legacy payout path when transfer_group is missing', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-legacy',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-legacy',
          stripe_charge_id: null,
          stripe_transfer_group: null,
        },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-legacy',
        },
        deps,
      ),
    ).resolves.toMatchObject({
      success: true,
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.payouts).toHaveLength(1);
  });

  it('marks pending reconciliation when payout timing cannot be completed after transfer', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: 'ch_123',
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
      retrieveConnectedBalance: async (input) => {
        deps.calls.sequence.push('retrieveConnectedBalance');
        deps.calls.balanceRetrievals.push(input);
        return { available: [{ amount: 0, currency: 'mxn' }] };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-reconcile',
        },
        deps,
      ),
    ).resolves.toMatchObject({
      success: true,
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toHaveLength(1);
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.updates).toEqual([{ runId: 'run-1', expectedStatus: 'pending_reconciliation', expectedStage: 'release_accepted', expectedVersion: 1, shipmentIds: ['shipment-1'], parent: null }]);
  });

  it('rejects single-modal settlement rows without a charge id when a transfer group exists', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: null,
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-missing-charge',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('MISSING_SETTLEMENT_CONTEXT', 400),
    );

    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('rejects reused idempotency keys when the request payload differs', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-existing',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'pending_reconciliation',
        stripe_payout_id: 'po_existing',
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-2',
          shipmentIds: ['shipment-2'],
          idempotencyKey: 'release-key-1',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('IDEMPOTENCY_KEY_CONFLICT', 409),
    );
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
  });

  it('blocks shipments with active pending, reconciliation-needed, or paid release mappings before Stripe payout', async () => {
    const activeStatuses = [
      'pending_reconciliation',
      'reconciliation_needed',
      'paid',
    ] as const;

    for (const status of activeStatuses) {
      const deps = createDeps({
        findActiveShipmentMappings: async () => [
          { shipmentId: 'shipment-1', runId: `run-${status}`, status },
        ],
      });

      await expect(
        releaseConnectPayout(
          {
            actorId: 'admin-1',
            sellerId: 'seller-1',
            shipmentIds: ['shipment-1'],
            idempotencyKey: `release-key-${status}`,
          },
          deps,
        ),
      ).rejects.toEqual(
        new ConnectPayoutReleaseError('PAYOUT_RELEASE_ALREADY_ACTIVE', 409),
      );
      expect(deps.calls.payouts).toEqual([]);
      expect(deps.calls.createdRuns).toEqual([]);
    }
  });

  it('rejects mixed sellers and ineligible shipments without persisting a run', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({ shipment_id: 'shipment-1' }),
        completedShipment({
          shipment_id: 'shipment-2',
          seller_id: 'seller-2',
          is_eligible: false,
          ineligible_reason: 'active_dispute',
        }),
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1', 'shipment-2'],
          idempotencyKey: 'release-key-2',
        },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('MIXED_SELLERS', 400));
    expect(deps.calls.createdRuns).toEqual([]);
  });

  it('rejects active dispute ineligible rows without creating a Stripe payout', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          is_eligible: false,
          ineligible_reason: 'active_dispute',
        }),
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-active-dispute',
        },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('active_dispute', 400));
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
  });

  it('rejects non-completed shipments and inactive Connect accounts before Stripe', async () => {
    const notCompletedDeps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({ status: 'delivered', completed_at: null }),
      ],
    });
    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-2a',
        },
        notCompletedDeps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('SHIPMENT_NOT_COMPLETED', 400),
    );
    expect(notCompletedDeps.calls.payouts).toEqual([]);

    const inactiveConnectDeps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({ stripe_onboarding_status: 'pending' }),
      ],
    });
    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-2b',
        },
        inactiveConnectDeps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('CONNECT_ACCOUNT_NOT_READY', 400),
    );
    expect(inactiveConnectDeps.calls.payouts).toEqual([]);
  });

  it('computes batch amount from selected shipments, persists run mappings, then creates Stripe payout', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          release_amount_cents: 12_500,
        }),
        completedShipment({
          shipment_id: 'shipment-2',
          release_amount_cents: 7_500,
        }),
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1', 'shipment-2'],
          idempotencyKey: 'release-key-3',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-1',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 20_000,
    });
    expect(deps.calls.createdRuns).toEqual([
      {
        actorId: 'admin-1',
        sellerId: 'seller-1',
        amount: 20_000,
        idempotencyKey: 'release-key-3',
      },
    ]);
    expect(deps.calls.mappings).toEqual([
      {
        runId: 'run-1',
        shipments: [
          { shipmentId: 'shipment-1', netPayout: 12_500 },
          { shipmentId: 'shipment-2', netPayout: 7_500 },
        ],
      },
    ]);
    expect(deps.calls.payouts).toEqual([
      {
        stripeAccountId: 'acct_seller_1',
        amount: 20_000,
        currency: 'mxn',
        idempotencyKey: 'release-key-3',
        metadata: {
          app_name: 'selene',
          run_id: 'run-1',
          seller_id: 'seller-1',
          shipment_ids: 'shipment-1,shipment-2',
        },
        orderIds: ['order-1', 'order-1'],
      },
    ]);
    // The payout-create fence is opened before Stripe and completed after.
    expect(deps.calls.fenceBegins).toEqual([{ runId: 'run-1' }]);
    expect(deps.calls.fenceCompletions).toEqual([
      {
        runId: 'run-1',
        stageVersion: 2,
        stripePayoutId: 'po_123',
      },
    ]);
  });

  it('blocks insufficient connected-account balance before persisting run or payout writes', async () => {
    const deps = createDeps({
      retrieveConnectedBalance: async (input) => {
        deps.calls.sequence.push('retrieveConnectedBalance');
        deps.calls.balanceRetrievals.push(input);
        return { available: [{ amount: 7_500, currency: 'mxn' }] };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-insufficient-balance',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: false,
      error: 'Connected account available balance is insufficient for this payout.',
      code: 'stripe_balance_insufficient',
      retryable: true,
      required_amount_cents: 12_500,
      available_amount_cents: 7_500,
      currency: 'mxn',
    });

    expect(deps.calls.balanceRetrievals).toEqual([
      { stripeAccountId: 'acct_seller_1' },
    ]);
    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.mappings).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('formats insufficient-balance observability metadata with the response field names', () => {
    expect(
      getStripeBalanceInsufficientLogMeta({
        sellerId: 'seller-1',
        shipmentCount: 2,
        response: {
          success: false,
          error: 'Connected account available balance is insufficient for this payout.',
          code: 'stripe_balance_insufficient',
          retryable: true,
          required_amount_cents: 12_500,
          available_amount_cents: 7_500,
          currency: 'mxn',
        },
      }),
    ).toEqual({
      sellerId: 'seller-1',
      shipmentCount: 2,
      code: 'stripe_balance_insufficient',
      required_amount_cents: 12_500,
      available_amount_cents: 7_500,
      currency: 'mxn',
      retryable: true,
    });
  });

  it('treats missing payout currency as insufficient connected balance', async () => {
    const deps = createDeps({
      retrieveConnectedBalance: async (input) => {
        deps.calls.sequence.push('retrieveConnectedBalance');
        deps.calls.balanceRetrievals.push(input);
        return { available: [{ amount: 99_999, currency: 'usd' }] };
      },
    });

    const result = await releaseConnectPayout(
      {
        actorId: 'admin-1',
        sellerId: 'seller-1',
        shipmentIds: ['shipment-1'],
        idempotencyKey: 'release-key-missing-currency',
      },
      deps,
    );

    expect(result).toMatchObject({
      success: false,
      code: 'stripe_balance_insufficient',
      required_amount_cents: 12_500,
      available_amount_cents: 0,
      currency: 'mxn',
    });
    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('retrieves connected balance before creating run, mappings, and Stripe payout when funds are sufficient', async () => {
    const deps = createDeps({
      retrieveConnectedBalance: async (input) => {
        deps.calls.sequence.push('retrieveConnectedBalance');
        deps.calls.balanceRetrievals.push(input);
        return {
          available: [
            { amount: 8_000, currency: 'mxn' },
            { amount: 6_000, currency: 'mxn' },
          ],
        };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-sufficient-balance',
        },
        deps,
      ),
    ).resolves.toMatchObject({ success: true, runId: 'run-1' });

    expect(deps.calls.sequence.slice(0, 5)).toEqual([
      'retrieveConnectedBalance',
      'createRun',
      'createRunShipments',
      'beginPayoutCreateFence',
      'createStripePayout',
    ]);
    expect(deps.calls.balanceRetrievals).toEqual([
      { stripeAccountId: 'acct_seller_1' },
    ]);
  });

  it('records a recoverable reconciliation state when the post-Stripe fence completion fails', async () => {
    const deps = createDeps({
      completePayoutCreateFence: async (input) => {
        deps.calls.fenceCompletions.push(input);
        throw new ConnectPayoutReleaseError('PAYOUT_CREATE_COMPLETE_RPC_FAILED', 500);
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-sync-failure',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_CREATE_COMPLETE_RPC_FAILED', 500),
    );

    expect(deps.calls.payouts).toEqual([
      {
        stripeAccountId: 'acct_seller_1',
        amount: 12_500,
        currency: 'mxn',
        idempotencyKey: 'release-key-sync-failure',
        metadata: {
          app_name: 'selene',
          run_id: 'run-1',
          seller_id: 'seller-1',
          shipment_ids: 'shipment-1',
        },
        orderIds: ['order-1'],
      },
    ]);
    // Post-Stripe persistence loss keeps the durable create-in-progress
    // fence: the future reconciliation path (never a recreate) resolves it.
    expect(deps.calls.syncFailures).toEqual([
      {
        runId: 'run-1',
        stripePayoutId: 'po_123',
        failureReason: 'PAYOUT_CREATE_COMPLETE_RPC_FAILED',
      },
    ]);
  });

  it('records the run and mappings failed through the durable fence when Stripe definitively rejects the payout', async () => {
    const stripeError = Object.assign(
      new Error('Stripe balance insufficient'),
      {
        type: 'StripeInvalidRequestError',
        statusCode: 400,
        code: 'balance_insufficient',
      },
    );
    const deps = createDeps({
      createStripePayout: async (input) => {
        deps.calls.payouts.push(input);
        throw stripeError;
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-stripe-failure',
        },
        deps,
      ),
    ).rejects.toBe(stripeError);

    expect(deps.calls.fenceFailures).toEqual([
      {
        runId: 'run-1',
        stageVersion: 2,
        failureReason: 'Stripe balance insufficient',
      },
    ]);
  });

  it('never overwrites a consumed fence: a definitive rejection with a lost fence race keeps the durable state', async () => {
    const stripeError = Object.assign(
      new Error('Stripe balance insufficient'),
      {
        type: 'StripeInvalidRequestError',
        statusCode: 400,
      },
    );
    const deps = createDeps({
      createStripePayout: async (input) => {
        deps.calls.payouts.push(input);
        throw stripeError;
      },
      failPayoutCreateFromFence: async () => false,
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-fence-race',
        },
        deps,
      ),
    ).rejects.toBe(stripeError);

    // No direct failed-state write raced over the newer durable decision.
    expect(deps.calls.fenceFailures).toEqual([]);
  });

  it('keeps ambiguous Stripe create failures fenced so a new idempotency key cannot duplicate the payout', async () => {
    const stripeError = Object.assign(new Error('Connection timed out'), {
      type: 'StripeConnectionError',
    });
    const activeMappings: Array<{
      shipmentId: string;
      runId: string;
      status: 'pending_reconciliation' | 'paid' | 'reconciliation_needed';
    }> = [];
    const deps = createDeps({
      findActiveShipmentMappings: async (shipmentIds) =>
        activeMappings.filter((mapping) =>
          shipmentIds.includes(mapping.shipmentId),
        ),
      createRunShipments: async (input) => {
        deps.calls.mappings.push(input);
        for (const shipment of input.shipments) {
          activeMappings.push({
            shipmentId: shipment.shipmentId,
            runId: input.runId,
            status: 'pending_reconciliation',
          });
        }
      },
      createStripePayout: async (input) => {
        deps.calls.payouts.push(input);
        throw stripeError;
      },
      // The SQL fence abort RPC also re-marks the run's shipment mappings
      // reconciliation-needed inside the same conditional write.
      abortPayoutCreateToActionRequired: async (input) => {
        deps.calls.fenceAborts.push(input);
        for (const mapping of activeMappings) {
          if (mapping.runId === input.runId) {
            mapping.status = 'reconciliation_needed';
          }
        }
        return true;
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-ambiguous-original',
        },
        deps,
      ),
    ).rejects.toBe(stripeError);

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-ambiguous-new',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_RELEASE_ALREADY_ACTIVE', 409),
    );

    expect(deps.calls.payouts).toHaveLength(1);
    expect(deps.calls.fenceFailures).toEqual([]);
    expect(deps.calls.fenceAborts).toEqual([
      {
        runId: 'run-1',
        stageVersion: 2,
        reason: 'Connection timed out',
      },
    ]);
  });

  it('blocks a same-key retry after an ambiguous create failure without calling Stripe again', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-ambiguous',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'reconciliation_needed',
        stripe_payout_id: null,
      }),
      findActiveShipmentMappings: async () => [
        {
          shipmentId: 'shipment-1',
          runId: 'run-ambiguous',
          status: 'reconciliation_needed',
        },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-ambiguous-original',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
        409,
      ),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.retries).toEqual([]);
  });

  it('retries a failed pre-Stripe run with the same idempotency key without creating a new run', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-failed',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'failed',
        stripe_payout_id: null,
      }),
      findActiveShipmentMappings: async () => [],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-stripe-failure',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-failed',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.mappings).toEqual([]);
    expect(deps.calls.retries).toEqual([{ runId: 'run-failed', expectedStatus: 'failed', expectedStage: null, expectedVersion: 1, shipmentIds: ['shipment-1'], parent: null }]);
    expect(deps.calls.fenceCompletions).toEqual([
      {
        runId: 'run-failed',
        stageVersion: 2,
        stripePayoutId: 'po_123',
      },
    ]);
  });

  it('keeps a truly released run blocked when the failed status has a Stripe payout id', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-terminal-failed',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'failed',
        stripe_payout_id: 'po_failed',
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-terminal-failure',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_RELEASE_PREVIOUSLY_FAILED', 409),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
  });

  it('fences every manual Stripe payouts.create behind the durable create-in-progress transition', async () => {
    const deps = createDeps({});

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-fenced-create',
        },
        deps,
      ),
    ).resolves.toMatchObject({ success: true, stripePayoutId: 'po_123' });

    // The fence write is the immediate predecessor of the Stripe call.
    const beginIndex = deps.calls.sequence.indexOf('beginPayoutCreateFence');
    const createIndex = deps.calls.sequence.indexOf('createStripePayout');
    expect(beginIndex).toBeGreaterThan(-1);
    expect(createIndex).toBe(beginIndex + 1);
  });

  it('never calls Stripe payouts.create when the durable fence cannot be opened', async () => {
    const deps = createDeps({
      beginPayoutCreateFence: async () => {
        throw new Error('PAYOUT_CREATE_FENCE_RPC_FAILED');
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-unfenced-create',
        },
        deps,
      ),
    ).rejects.toThrow();

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceCompletions).toEqual([]);
    expect(deps.calls.fenceFailures).toEqual([]);
  });

  it('requires reconciliation instead of recreating when the run is already durably fenced', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-fenced',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'pending_reconciliation',
        stripe_payout_id: null,
        release_stage: 'payout_create_in_progress',
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-fenced-run',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
        409,
      ),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceBegins).toEqual([]);
    expect(deps.calls.retries).toEqual([]);
  });

  it('maps an open-fence conflict from the fence RPC into the reconciliation-required error without calling Stripe', async () => {
    const deps = createDeps({
      beginPayoutCreateFence: async () => {
        throw new Error('PAYOUT_CREATE_FENCE_CONFLICT');
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-fence-conflict',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
        409,
      ),
    );

    expect(deps.calls.payouts).toEqual([]);
  });

  it('parks the release when the durable fence reports a held executor claim, without calling Stripe', async () => {
    // The SQL-side atomic guard: a worker claim that landed after the
    // endpoint's lookups makes the fence RPC raise EXECUTOR_CLAIM_HELD; the
    // manual path answers with the claim-conflict semantics instead of
    // calling Stripe.
    const deps = createDeps({
      beginPayoutCreateFence: async () => {
        throw new Error('EXECUTOR_CLAIM_HELD');
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-fence-claim-conflict',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_EXECUTOR_CLAIM_CONFLICT',
        409,
      ),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceCompletions).toEqual([]);
    expect(deps.calls.fenceFailures).toEqual([]);
  });

  it('parks a resumed run claimed by a live executor claim instead of calling Stripe', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-claimed',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'pending_reconciliation',
        stripe_payout_id: null,
        release_stage: 'awaiting_connected_balance',
        payout_claim_token: 'claim-live',
        payout_claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-claimed-run',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_EXECUTOR_CLAIM_CONFLICT',
        409,
      ),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceBegins).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.retries).toEqual([]);
  });

  it('parks a resumed run holding a stale executor claim rather than recreating the payout', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-stale-claim',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'pending_reconciliation',
        stripe_payout_id: null,
        release_stage: 'awaiting_connected_balance',
        payout_claim_token: 'claim-lapsed',
        payout_claim_expires_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-stale-claim',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_EXECUTOR_CLAIM_CONFLICT',
        409,
      ),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceBegins).toEqual([]);
    expect(deps.calls.retries).toEqual([]);
  });

  it('re-reads the run at fence time and refuses to fence over a claim taken after the first lookup', async () => {
    const deps = createDeps({
      findRunById: async (runId) => {
        deps.calls.parentRunLookups.push(runId);
        return {
          id: runId,
          seller_id: 'seller-1',
          shipment_ids: ['shipment-1'],
          amount: 12_500,
          status: 'pending_reconciliation',
          stripe_payout_id: null,
          release_stage: 'awaiting_connected_balance',
          payout_claim_token: 'claim-raced',
          payout_claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-fence-claim-race',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_EXECUTOR_CLAIM_CONFLICT',
        409,
      ),
    );

    // The fence-time durable re-read observed the executor claim.
    expect(deps.calls.parentRunLookups).toEqual(['run-1']);
    expect(deps.calls.fenceBegins).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('does not regress a terminal run when the post-Stripe sync fallback is refused', async () => {
    // The manual path lost the fence exit: a webhook already projected a
    // terminal outcome for the run (guarded RPC refuses, terminal authority
    // preserved). The fallback performs no dependent write and the original
    // post-Stripe error still answers the admin request.
    const deps = createDeps({
      completePayoutCreateFence: async (input) => {
        deps.calls.fenceCompletions.push(input);
        throw new ConnectPayoutReleaseError('PAYOUT_CREATE_COMPLETE_RPC_FAILED', 500);
      },
      // The guarded fn_mark_payout_run_sync_failed RPC refused: the run sits
      // in a terminal status (paid/failed/canceled) projected by the webhook.
      markRunPayoutSyncFailed: async (input) => {
        deps.calls.syncFailures.push(input);
        return false;
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-sync-fallback-refused',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_CREATE_COMPLETE_RPC_FAILED', 500),
    );

    // The fallback reached the guarded RPC exactly once and nothing else was
    // written over the terminal authority.
    expect(deps.calls.syncFailures).toEqual([
      {
        runId: 'run-1',
        stripePayoutId: 'po_123',
        failureReason: 'PAYOUT_CREATE_COMPLETE_RPC_FAILED',
      },
    ]);
    expect(deps.calls.payouts).toHaveLength(1);
    expect(deps.calls.fenceFailures).toEqual([]);
    expect(deps.calls.fenceAborts).toEqual([]);
    expect(deps.calls.retries).toEqual([]);
  });

  it('keeps the durable fence when post-Stripe persistence is lost entirely and never recreates after Stripe idempotency expiry', async () => {
    const deps = createDeps({
      completePayoutCreateFence: async (input) => {
        deps.calls.fenceCompletions.push(input);
        throw new ConnectPayoutReleaseError('PAYOUT_CREATE_COMPLETE_RPC_FAILED', 500);
      },
      // Total persistence loss: even the reconciliation-mark write fails.
      markRunPayoutSyncFailed: async (input) => {
        deps.calls.syncFailures.push(input);
        throw new ConnectPayoutReleaseError('RUN_RECONCILIATION_MARK_FAILED', 500);
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-post-stripe-loss',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_CREATE_COMPLETE_RPC_FAILED', 500),
    );

    // Stripe was called exactly once and the durable fence exit was not
    // forced: no failed/abort write raced over the unreconciled create.
    expect(deps.calls.payouts).toHaveLength(1);
    expect(deps.calls.fenceFailures).toEqual([]);
    expect(deps.calls.fenceAborts).toEqual([]);

    // A later invocation with the same key — after the Stripe idempotency
    // window expired — must reconcile the existing payout, never recreate.
    const resumedDeps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-1',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'pending_reconciliation',
        stripe_payout_id: null,
        release_stage: 'payout_create_in_progress',
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-post-stripe-loss',
        },
        resumedDeps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
        409,
      ),
    );

    expect(resumedDeps.calls.payouts).toEqual([]);
    expect(resumedDeps.calls.fenceBegins).toEqual([]);
    expect(resumedDeps.calls.retries).toEqual([]);

    // A different idempotency key is parked by the run's active mappings.
    const activeMappings: Array<{
      shipmentId: string;
      runId: string;
      status: 'pending_reconciliation' | 'paid' | 'reconciliation_needed';
    }> = [
      { shipmentId: 'shipment-1', runId: 'run-1', status: 'pending_reconciliation' },
    ];
    const newKeyDeps = createDeps({
      findActiveShipmentMappings: async () => activeMappings,
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-second-attempt',
        },
        newKeyDeps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_RELEASE_ALREADY_ACTIVE', 409),
    );

    expect(newKeyDeps.calls.payouts).toEqual([]);
    expect(newKeyDeps.calls.createdRuns).toEqual([]);
  });

  it('revalidates current release eligibility inside the fence and fails the run instead of creating when eligibility drifted', async () => {
    let rowsRead = 0;
    const deps = createDeps({
      loadReleaseRows: async () => {
        rowsRead += 1;
        return rowsRead === 1
          ? [completedShipment()]
          : [
              completedShipment({
                is_eligible: false,
                ineligible_reason: 'active_dispute',
              }),
            ];
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-eligibility-drift',
        },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('active_dispute', 400));

    // Stripe was never called; the fence exits with definitive failed
    // semantics carrying the drifted eligibility reason.
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceFailures).toEqual([
      {
        runId: 'run-1',
        stageVersion: 2,
        failureReason: 'active_dispute',
      },
    ]);
    expect(deps.calls.fenceCompletions).toEqual([]);
  });

  it('admits only the fenced run\'s own already_released mapping at fence-time revalidation', async () => {
    // Regression: a fresh manual release creates its run mapping, then the
    // fence-time queue re-read sees that same mapping as already_released and
    // failed the run before Stripe payouts.create. The run being fenced may
    // tolerate its own marker; the payout must still go through.
    let rowsReads = 0;
    let mappingReads = 0;
    const deps = createDeps({
      loadReleaseRows: async () => {
        rowsReads += 1;
        return rowsReads === 1
          ? [completedShipment()]
          : [
              completedShipment({
                is_eligible: false,
                ineligible_reason: 'already_released',
              }),
            ];
      },
      findActiveShipmentMappings: async () => {
        mappingReads += 1;
        return mappingReads === 1
          ? []
          : [
              {
                shipmentId: 'shipment-1',
                runId: 'run-1',
                status: 'pending_reconciliation' as const,
              },
            ];
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-self-mapping',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-1',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.payouts).toHaveLength(1);
    expect(deps.calls.fenceCompletions).toEqual([
      { runId: 'run-1', stageVersion: 2, stripePayoutId: 'po_123' },
    ]);
    expect(deps.calls.fenceFailures).toEqual([]);
  });

  it('blocks fence-time revalidation when an active mapping belongs to another run', async () => {
    // The already_released tolerance is owner-scoped: a fence-time active
    // mapping owned by a different run keeps the release blocked and exits
    // the fence with definitive failed semantics, before Stripe payouts.create.
    let rowsReads = 0;
    let mappingReads = 0;
    const deps = createDeps({
      loadReleaseRows: async () => {
        rowsReads += 1;
        return rowsReads === 1
          ? [completedShipment()]
          : [
              completedShipment({
                is_eligible: false,
                ineligible_reason: 'already_released',
              }),
            ];
      },
      findActiveShipmentMappings: async () => {
        mappingReads += 1;
        return mappingReads === 1
          ? []
          : [
              {
                shipmentId: 'shipment-1',
                runId: 'run-other',
                status: 'pending_reconciliation' as const,
              },
            ];
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-foreign-mapping',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_RELEASE_ALREADY_ACTIVE', 409),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceCompletions).toEqual([]);
    expect(deps.calls.fenceFailures).toEqual([
      {
        runId: 'run-1',
        stageVersion: 2,
        failureReason: 'PAYOUT_RELEASE_ALREADY_ACTIVE',
      },
    ]);
  });

  it('tolerates already_released at fence time only per shipment with its own current-run mapping', async () => {
    // A self-mapped shipment must not authorize a different already_released
    // row in the same batch: each shipment needs its own active mapping owned
    // by the run being fenced, or its queue verdict stays authoritative.
    let rowsReads = 0;
    let mappingReads = 0;
    const deps = createDeps({
      loadReleaseRows: async () => {
        rowsReads += 1;
        return [
          completedShipment({
            shipment_id: 'shipment-1',
            order_id: 'order-1',
            ...(rowsReads === 1
              ? {}
              : { is_eligible: false, ineligible_reason: 'already_released' }),
          }),
          completedShipment({
            shipment_id: 'shipment-2',
            order_id: 'order-2',
            ...(rowsReads === 1
              ? {}
              : { is_eligible: false, ineligible_reason: 'already_released' }),
          }),
        ];
      },
      findActiveShipmentMappings: async () => {
        mappingReads += 1;
        return mappingReads === 1
          ? []
          : [
              {
                shipmentId: 'shipment-1',
                runId: 'run-1',
                status: 'pending_reconciliation' as const,
              },
            ];
      },
      loadReleaseOrders: async () => [
        { id: 'order-1', stripe_charge_id: null, stripe_transfer_group: null },
        { id: 'order-2', stripe_charge_id: null, stripe_transfer_group: null },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1', 'shipment-2'],
          idempotencyKey: 'release-key-partial-self-mapping',
        },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('already_released', 400));

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceCompletions).toEqual([]);
    expect(deps.calls.fenceFailures).toEqual([
      { runId: 'run-1', stageVersion: 2, failureReason: 'already_released' },
    ]);
  });

  it('refuses to create when the server-recomputed amount changed inside the fence', async () => {
    let rowsRead = 0;
    const deps = createDeps({
      loadReleaseRows: async () => {
        rowsRead += 1;
        return rowsRead === 1
          ? [completedShipment()]
          : [completedShipment({ release_amount_cents: 13_000 })];
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-amount-drift',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_RELEASE_AMOUNT_CHANGED', 409),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceFailures).toEqual([
      {
        runId: 'run-1',
        stageVersion: 2,
        failureReason: 'PAYOUT_RELEASE_AMOUNT_CHANGED',
      },
    ]);
  });

  it('queries account actionability only through the RPC dep and never direct-selects the revoked tables', () => {
    const source = readFileSync(
      join(import.meta.dir, 'release-connect-payout.ts'),
      'utf8',
    );

    // The projection tables' grants are revoked from every role; the manual
    // path must reach actionability only through the injected service-role
    // RPC dependency, never a direct table select.
    expect(source).not.toMatch(
      /from\(\s*['"]connect_account_actionability['"]|from\(\s*['"]connect_account_events['"]/,
    );
    expect(source).toMatch(/getConnectAccountActionability/);
  });

  it('writes the post-Stripe sync failure only through the guarded RPC, never a direct terminal-capable update', () => {
    const source = readFileSync(
      join(import.meta.dir, 'index.ts'),
      'utf8',
    );

    // Defect 2: the post-Stripe fallback must not direct-UPDATE
    // connect_payout_runs with status='reconciliation_needed' by run id (that
    // can regress a terminal result); the guarded
    // fn_mark_payout_run_sync_failed RPC owns the write and refuses
    // terminal/newer state itself.
    expect(source).toMatch(/fn_mark_payout_run_sync_failed/);
    expect(source).not.toMatch(
      /\.from\(\s*'connect_payout_runs'\s*\)[\s\S]{0,300}\.update\(\s*\{[\s\S]{0,400}?status:\s*'reconciliation_needed'/,
    );
  });

  it('refuses a manual release for a non-actionable seller destination before any run, transfer, or payout', async () => {
    const actionabilityLookups: unknown[] = [];
    const deps = createDeps({
      getConnectAccountActionability: async (input) => {
        actionabilityLookups.push(input);
        return { isActionable: false, blockedReason: 'errored' };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-account-blocked',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('CONNECT_ACCOUNT_NOT_ACTIONABLE', 409),
    );

    expect(actionabilityLookups).toEqual([
      { stripeAccountId: 'acct_seller_1' },
    ]);
    // Refused before any Stripe or durable write: no transfer, no payout,
    // not even a run creation or balance preflight.
    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.sequence).toEqual([]);
    expect(deps.calls.balanceRetrievals).toEqual([]);
  });

  it('re-checks account actionability inside the fence and fails the run when the destination became non-actionable', async () => {
    let actionabilityLookups = 0;
    const deps = createDeps({
      getConnectAccountActionability: async () => {
        actionabilityLookups += 1;
        return actionabilityLookups === 1
          ? { isActionable: true, blockedReason: null }
          : { isActionable: false, blockedReason: 'verification_failed' };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-account-drift',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('CONNECT_ACCOUNT_NOT_ACTIONABLE', 409),
    );

    // Stripe was never called; the fence exits with definitive failed
    // semantics carrying the account-not-actionable reason.
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.fenceFailures).toEqual([
      {
        runId: 'run-1',
        stageVersion: 2,
        failureReason: 'CONNECT_ACCOUNT_NOT_ACTIONABLE',
      },
    ]);
    expect(deps.calls.fenceCompletions).toEqual([]);
  });
});
