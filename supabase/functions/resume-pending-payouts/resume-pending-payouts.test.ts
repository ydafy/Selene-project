import { describe, expect, test } from 'bun:test';

import type { ReleaseQueueRow } from '../release-connect-payout/release-connect-payout';

import {
  MAX_RESUME_RUNS_PER_TICK,
  RESUME_LEASE_SECONDS,
  resumePendingPayoutRuns,
  validateResumeRequest,
  type ClaimedRun,
  type ResumePendingPayoutsDeps,
} from './resume-pending-payouts';

const claimedRun = (overrides: Partial<ClaimedRun> = {}): ClaimedRun => ({
  run_id: 'run-awaiting-1',
  actor_id: 'admin-1',
  seller_id: 'seller-1',
  amount_cents: 12_500,
  idempotency_key: 'release-key-original',
  shipment_ids: ['shipment-1'],
  claim_token: 'claim-token-1',
  stage_version: 3,
  claim_expires_at: '2026-09-20T00:05:00.000Z',
  ...overrides,
});

test('undetermined account actionability does not park an otherwise valid run', async () => {
  const deps = createWorkerDeps({ createClaimQueue: [claimedRun()], actionability: null });
  const summary = await resumePendingPayoutRuns(deps);
  expect(summary.results[0]?.status).toBe('resumed');
  expect(deps.calls.blockedMarks).toHaveLength(0);
  expect(deps.calls.stripePayoutCreates).toHaveLength(1);
});

const completedShipment = (
  overrides: Partial<ReleaseQueueRow> = {},
): ReleaseQueueRow => ({
  shipment_id: 'shipment-1',
  seller_id: 'seller-1',
  status: 'completed',
  completed_at: '2026-06-21T12:00:00.000Z',
  is_eligible: false,
  ineligible_reason: 'already_released',
  order_id: 'order-1',
  release_amount_cents: 12_500,
  stripe_account_id: 'acct_seller_1',
  stripe_onboarding_status: 'complete',
  stripe_transfer_id: 'tr_existing',
  ...overrides,
});

interface WorkerCalls {
  createClaims: number[];
  reconcileClaims: number[];
  actorLookups: string[];
  actionabilityLookups: string[];
  claimVerifications: unknown[];
  blockedMarks: unknown[];
  deferrals: unknown[];
  fenceBegins: unknown[];
  fenceCompletions: unknown[];
  fenceFailures: unknown[];
  fenceAborts: unknown[];
  parkedTransitions: unknown[];
  claimReleases: unknown[];
  stripePayoutCreates: unknown[];
  stripePayoutLists: unknown[];
  balanceRetrievals: unknown[];
}

function createWorkerDeps(
  options: {
    createClaimQueue?: Array<ClaimedRun | null>;
    reconcileClaimQueue?: Array<ClaimedRun | null>;
    actorRole?: string | null;
    actionability?: { isActionable: boolean; blockedReason: string | null } | null;
    balanceAvailable?: number;
    createStripePayout?: ResumePendingPayoutsDeps['createStripePayout'];
    completePayoutCreate?: ResumePendingPayoutsDeps['completePayoutCreate'];
    beginPayoutCreate?: ResumePendingPayoutsDeps['beginPayoutCreate'];
    verifyPayoutClaim?: ResumePendingPayoutsDeps['verifyPayoutClaim'];
    markRunBlockedByAccount?: ResumePendingPayoutsDeps['markRunBlockedByAccount'];
    transitionRunToActionRequired?: ResumePendingPayoutsDeps['transitionRunToActionRequired'];
    deferAwaitingBalanceRun?: ResumePendingPayoutsDeps['deferAwaitingBalanceRun'];
    listStripePayoutsForReconciliation?: ResumePendingPayoutsDeps['listStripePayoutsForReconciliation'];
  } = {},
): ResumePendingPayoutsDeps & { calls: WorkerCalls } {
  const calls: WorkerCalls = {
    createClaims: [],
    reconcileClaims: [],
    actorLookups: [],
    actionabilityLookups: [],
    claimVerifications: [],
    blockedMarks: [],
    deferrals: [],
    fenceBegins: [],
    fenceCompletions: [],
    fenceFailures: [],
    fenceAborts: [],
    parkedTransitions: [],
    claimReleases: [],
    stripePayoutCreates: [],
    stripePayoutLists: [],
    balanceRetrievals: [],
  };

  const deps: ResumePendingPayoutsDeps & { calls: WorkerCalls } = {
    calls,
    claimAwaitingBalanceRun: async ({ leaseSeconds }) => {
      calls.createClaims.push(leaseSeconds);
      return options.createClaimQueue?.shift() ?? null;
    },
    claimPayoutCreateReconciliation: async ({ graceSeconds }) => {
      calls.reconcileClaims.push(graceSeconds);
      const fixture = options.reconcileClaimQueue?.shift();
      if (!fixture) return null;
      const { shipment_ids: _, ...row } = fixture;
      return { ...row, stripe_account_id: row.stripe_account_id ?? null, payout_create_attempted_at: row.payout_create_attempted_at ?? '2026-09-20T00:00:00.000Z' };
    },
    loadReconciliationMappings: async (runId) => ({
      rows: [{ id: 'mapping-1', run_id: runId, shipment_id: 'shipment-1', net_payout: 12_500, status: 'pending_reconciliation' }], total: 1,
    }),
    getActorProfile: async (actorId) => {
      calls.actorLookups.push(actorId);
      return { role: options.actorRole ?? 'admin' };
    },
    loadReleaseRows: async () => {
      return [completedShipment()];
    },
    getAccountActionability: async (sellerId) => {
      calls.actionabilityLookups.push(sellerId);
      return options.actionability === undefined
        ? { isActionable: true, blockedReason: null }
        : options.actionability;
    },
    verifyPayoutClaim: async (input) => {
      calls.claimVerifications.push(input);
      if (options.verifyPayoutClaim) return options.verifyPayoutClaim(input);
      return true;
    },
    markRunBlockedByAccount: async (input) => {
      calls.blockedMarks.push(input);
      if (options.markRunBlockedByAccount) {
        return options.markRunBlockedByAccount(input);
      }
      return true;
    },
    transitionRunToActionRequired: async (input) => {
      calls.parkedTransitions.push(input);
      if (options.transitionRunToActionRequired) {
        return options.transitionRunToActionRequired(input);
      }
      return true;
    },
    deferAwaitingBalanceRun: async (input) => {
      calls.deferrals.push(input);
      if (options.deferAwaitingBalanceRun) {
        return options.deferAwaitingBalanceRun(input);
      }
      return true;
    },
    beginPayoutCreate: async (input) => {
      calls.fenceBegins.push(input);
      return (options.beginPayoutCreate ? await options.beginPayoutCreate(input) : input.stageVersion + 1) as number;
    },
    completePayoutCreate: async (input) => {
      calls.fenceCompletions.push(input);
      if (options.completePayoutCreate) return options.completePayoutCreate(input);
      return true;
    },
    failPayoutCreate: async (input) => {
      calls.fenceFailures.push(input);
      return true;
    },
    abortPayoutCreateToActionRequired: async (input) => {
      calls.fenceAborts.push(input);
      return true;
    },
    releasePayoutClaim: async (input) => {
      calls.claimReleases.push(input);
    },
    createStripePayout: async (input) => {
      calls.stripePayoutCreates.push(input);
      if (options.createStripePayout) return options.createStripePayout(input);
      return { id: 'po_new' };
    },
    listStripePayoutsForReconciliation: async (input) => {
      calls.stripePayoutLists.push(input);
      if (options.listStripePayoutsForReconciliation)
        return options.listStripePayoutsForReconciliation(input);
      return [];
    },
    retrieveConnectedBalance: async (input) => {
      calls.balanceRetrievals.push(input);
      return {
        available: [
          {
            amount: options.balanceAvailable ?? 99_999,
            currency: 'mxn',
          },
        ],
      };
    },
  };

  return deps;
}

describe('reconciliation RPC mapping reconstruction', () => {
  const actualRpcRow = () => {
    const { shipment_ids: _, stripe_account_id: _account, payout_create_attempted_at: _attempt, ...row } = claimedRun();
    return { ...row, stripe_account_id: 'acct_seller_1', payout_create_attempted_at: '2026-09-20T00:00:00.000Z' };
  };
  const mapping = (overrides = {}) => ({
    id: 'mapping-1', run_id: 'run-awaiting-1', shipment_id: 'shipment-1',
    net_payout: 12_500, status: 'pending_reconciliation', ...overrides,
  });
  test('reconciles a faithful RPC row without shipment_ids using persisted mappings', async () => {
    const deps = createWorkerDeps();
    let claimed = false;
    deps.claimPayoutCreateReconciliation = async () => claimed ? null : (claimed = true, actualRpcRow());
    expect(actualRpcRow()).not.toHaveProperty('shipment_ids');
    Object.assign(deps, { loadReconciliationMappings: async () => ({ rows: [mapping()], total: 1 }) });
    deps.listStripePayoutsForReconciliation = async () => [{ id: 'po_existing', metadata: { run_id: 'run-awaiting-1' } }];
    const summary = await resumePendingPayoutRuns(deps);
    expect(summary.resumed).toBe(1);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
  });
  for (const [name, rows, total] of [
    ['missing', [], 0],
    ['incomplete', [mapping()], 2],
    ['duplicate', [mapping(), mapping()], 2],
    ['foreign run', [mapping({ run_id: 'foreign' })], 1],
    ['amount mismatch', [mapping({ net_payout: 1 })], 1],
    ['terminal mapping', [mapping({ status: 'paid' })], 1],
  ] as const) {
    test(`refuses ${name} mappings before provider listing or state mutation`, async () => {
      const deps = createWorkerDeps();
      let claimed = false;
      deps.claimPayoutCreateReconciliation = async () => claimed ? null : (claimed = true, actualRpcRow());
      Object.assign(deps, { loadReconciliationMappings: async () => ({ rows, total }) });
      const summary = await resumePendingPayoutRuns(deps);
      expect(summary.errors).toBe(1);
      expect(deps.calls.stripePayoutLists).toEqual([]);
      expect(deps.calls.fenceCompletions).toEqual([]);
      expect(deps.calls.fenceAborts).toEqual([]);
    });
  }
});

describe('reconciliation persisted identity checks', () => {
  for (const [name, rows] of [
    ['foreign seller', [completedShipment({ seller_id: 'foreign' })]],
    ['foreign account', [completedShipment({ stripe_account_id: 'acct_foreign' })]],
    ['foreign shipment', [completedShipment({ shipment_id: 'foreign' })]],
    ['missing release row', []],
    ['duplicate release rows', [completedShipment(), completedShipment()]],
  ] as const) {
    test(`refuses ${name} before provider action`, async () => {
      const deps = createWorkerDeps({ reconcileClaimQueue: [claimedRun({ stripe_account_id: 'acct_seller_1', payout_create_attempted_at: '2026-09-20T00:00:00.000Z' })] });
      deps.loadReleaseRows = async () => [...rows];
      const summary = await resumePendingPayoutRuns(deps);
      expect(summary.errors).toBe(1);
      expect(deps.calls.stripePayoutLists).toEqual([]);
      expect(deps.calls.fenceCompletions).toEqual([]);
      expect(deps.calls.fenceAborts).toEqual([]);
    });
  }
});

describe('resumePendingPayoutRuns', () => {
  test('exposes the bounded batch, short lease, and reconciliation grace constants', () => {
    expect(RESUME_LEASE_SECONDS).toBe(300);
    expect(MAX_RESUME_RUNS_PER_TICK).toBeGreaterThan(0);
    expect(MAX_RESUME_RUNS_PER_TICK).toBeLessThanOrEqual(10);
  });

  test('defers insufficient balance with bounded backoff and never creates a payout', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      balanceAvailable: 7_500,
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.claimed).toBe(1);
    expect(summary.deferred).toBe(1);
    expect(summary.resumed).toBe(0);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
    // The deferral goes through the token-conditional backoff RPC.
    expect(deps.calls.deferrals).toEqual([
      {
        runId: 'run-awaiting-1',
        claimToken: 'claim-token-1',
        stageVersion: 3,
      },
    ]);
    // No extra claim release: the defer RPC clears the claim itself.
    expect(deps.calls.claimReleases).toEqual([]);
  });

  test('creates exactly one payout behind the durable write-ahead fence', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary).toMatchObject({
      claimed: 1,
      resumed: 1,
      deferred: 0,
      skipped: 0,
    });
    expect(deps.calls.stripePayoutCreates).toHaveLength(1);
    expect(deps.calls.stripePayoutCreates[0]).toMatchObject({
      amount: 12_500,
      currency: 'mxn',
      idempotencyKey: 'release-key-original',
      metadata: {
        app_name: 'selene',
        run_id: 'run-awaiting-1',
        seller_id: 'seller-1',
      },
    });
    // The fence is written BEFORE the Stripe create and completed after.
    expect(deps.calls.fenceBegins).toEqual([
      {
        runId: 'run-awaiting-1',
        claimToken: 'claim-token-1',
        stageVersion: 3,
      },
    ]);
    expect(deps.calls.fenceCompletions).toHaveLength(1);
  });

  test('a post-Stripe persistence failure stays create-in-progress and the next tick reconciles without re-creating', async () => {
    // Tick 1: Stripe create succeeds but the completion write fails; the run
    // stays fenced in payout_create_in_progress.
    const tick1 = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      completePayoutCreate: async () => {
        throw new Error('DB write failed after Stripe accepted the payout');
      },
    });
    const summary1 = await resumePendingPayoutRuns(tick1);
    expect(summary1.errors).toBe(1);

    // Tick 2: the fence is claimed for reconciliation; Stripe create must NOT
    // be called again; the listing finds the payout and completes the stage.
    const tick2 = createWorkerDeps({
      reconcileClaimQueue: [
        claimedRun({
          stage_version: 4,
          stripe_account_id: 'acct_seller_1',
          payout_create_attempted_at: '2026-09-20T00:00:00.000Z',
        }),
        null,
      ],
      listStripePayoutsForReconciliation: async () => [
        { id: 'po_new', metadata: { run_id: 'run-awaiting-1' } },
      ],
    });
    const summary2 = await resumePendingPayoutRuns(tick2);

    expect(summary2.resumed).toBe(1);
    expect(tick2.calls.stripePayoutCreates).toEqual([]);
    expect(tick2.calls.stripePayoutLists).toHaveLength(1);
    expect(tick2.calls.fenceCompletions).toEqual([
      {
        runId: 'run-awaiting-1',
        claimToken: 'claim-token-1',
        stageVersion: 4,
        stripePayoutId: 'po_new',
      },
    ]);
  });

  test('an uncertain create outcome with zero Stripe matches becomes action_required, never a new payout', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      createStripePayout: async () => {
        throw Object.assign(new Error('Connection reset'), {
          type: 'StripeConnectionError',
        });
      },
      listStripePayoutsForReconciliation: async () => [],
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.actionRequired).toBe(1);
    expect(deps.calls.fenceAborts).toHaveLength(1);
    expect(deps.calls.stripePayoutCreates).toHaveLength(1);
    expect(deps.calls.stripePayoutLists).toHaveLength(1);
  });

  test('a reconciliation listing with multiple matches becomes action_required, never a new payout', async () => {
    const deps = createWorkerDeps({
      reconcileClaimQueue: [claimedRun(), null],
      listStripePayoutsForReconciliation: async () => [
        { id: 'po_a', metadata: { run_id: 'run-awaiting-1' } },
        { id: 'po_b', metadata: { run_id: 'run-awaiting-1' } },
      ],
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.actionRequired).toBe(1);
    expect(deps.calls.fenceAborts).toHaveLength(1);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
  });

  test('a stale claim token blocks the fence and the Stripe create call', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      beginPayoutCreate: async () => {
        throw new Error('STALE_CLAIM');
      },
    });

    const summary = await resumePendingPayoutRuns(deps);

    // The stale worker aborts before any Stripe call.
    expect(deps.calls.stripePayoutCreates).toEqual([]);
    expect(summary.resumed).toBe(0);
  });

  test('a webhook terminal projection wins: the worker completion is rejected and never writes pending', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      // The webhook projected a terminal state and cleared the claim while the
      // worker was in flight; the token-conditional completion is rejected.
      completePayoutCreate: async () => false,
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(deps.calls.stripePayoutCreates).toHaveLength(1);
    // No pending state write happened after the terminal projection.
    expect(summary.resumed).toBe(0);
  });

  test('a definitive create failure is recorded through the fence without re-creating', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      createStripePayout: async () => {
        throw Object.assign(new Error('amount too large'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
        });
      },
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.errors).toBe(1);
    expect(deps.calls.fenceFailures).toHaveLength(1);
    expect(deps.calls.fenceFailures[0]).toMatchObject({
      runId: 'run-awaiting-1',
      claimToken: 'claim-token-1',
    });
    expect(deps.calls.stripePayoutLists).toEqual([]);
  });

  test('a blocked account moves the run to action_required without any Stripe call', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      actionability: {
        isActionable: false,
        blockedReason: 'errored',
      },
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.actionRequired).toBe(1);
    expect(deps.calls.blockedMarks).toEqual([
      {
        runId: 'run-awaiting-1',
        claimToken: 'claim-token-1',
        stageVersion: 3,
        blockedReason: 'errored',
      },
    ]);
    expect(deps.calls.balanceRetrievals).toEqual([]);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
  });

  test('skips a run whose original actor is no longer admin and releases the claim safely', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      actorRole: 'user',
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.claimed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.results).toEqual([
      {
        runId: 'run-awaiting-1',
        status: 'skipped',
        reason: 'actor_not_admin',
      },
    ]);
    expect(deps.calls.balanceRetrievals).toEqual([]);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
    expect(deps.calls.claimReleases).toEqual([
      { runId: 'run-awaiting-1', claimToken: 'claim-token-1' },
    ]);
  });

  test('processes at most the bounded batch size per tick across both queues', async () => {
    const createClaimQueue = Array.from(
      { length: MAX_RESUME_RUNS_PER_TICK },
      () => claimedRun(),
    );
    const deps = createWorkerDeps({
      createClaimQueue,
      reconcileClaimQueue: Array.from(
        { length: MAX_RESUME_RUNS_PER_TICK + 3 },
        () => claimedRun(),
      ),
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.claimed).toBe(MAX_RESUME_RUNS_PER_TICK * 2);
    expect(deps.calls.createClaims).toHaveLength(MAX_RESUME_RUNS_PER_TICK);
    expect(deps.calls.reconcileClaims).toHaveLength(MAX_RESUME_RUNS_PER_TICK);
  });

  test('reconciliation bounds the Stripe listing window to the create attempt', async () => {
    const deps = createWorkerDeps({
      reconcileClaimQueue: [
        claimedRun({
          payout_create_attempted_at: '2026-09-20T00:00:00.000Z',
          stripe_account_id: 'acct_seller_1',
        }),
        null,
      ],
    });

    await resumePendingPayoutRuns(deps);

    expect(deps.calls.stripePayoutLists).toHaveLength(1);
    expect(deps.calls.stripePayoutLists[0]).toMatchObject({
      stripeAccountId: 'acct_seller_1',
      createdGte: '2026-09-20T00:00:00.000Z',
    });
  });

  test('stops cleanly when both queues are empty', async () => {
    const deps = createWorkerDeps({});

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.claimed).toBe(0);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
    expect(deps.calls.claimReleases).toEqual([]);
  });

  test('an expired claim lease aborts before any Stripe call or state regression', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      verifyPayoutClaim: async () => {
        throw new Error('CLAIM_LEASE_EXPIRED');
      },
    });

    const summary = await resumePendingPayoutRuns(deps);

    // No Stripe balance call, no fence, no payout, no deferral state write.
    expect(deps.calls.balanceRetrievals).toEqual([]);
    expect(deps.calls.fenceBegins).toEqual([]);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
    expect(deps.calls.deferrals).toEqual([]);
    expect(summary.resumed).toBe(0);
    expect(summary.results).toEqual([
      {
        runId: 'run-awaiting-1',
        status: 'skipped',
        reason: 'claim_lease_expired',
      },
    ]);
    expect(deps.calls.claimReleases).toEqual([
      { runId: 'run-awaiting-1', claimToken: 'claim-token-1' },
    ]);
  });

  test('the worker re-proves the live claim immediately before the Stripe payout create', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      // The claim lapses between the fence write and the Stripe call: the
      // create must be aborted, leaving the durable fence for reconciliation.
      verifyPayoutClaim: async (input) => {
        const version = (input as { stageVersion: number }).stageVersion;
        return version <= 3;
      },
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(deps.calls.claimVerifications).toEqual([
      { runId: 'run-awaiting-1', claimToken: 'claim-token-1', stageVersion: 3 },
      { runId: 'run-awaiting-1', claimToken: 'claim-token-1', stageVersion: 4 },
    ]);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
    expect(summary.resumed).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  test('reconciliation proves the live claim before listing Stripe payouts', async () => {
    const deps = createWorkerDeps({
      reconcileClaimQueue: [
        claimedRun({
          stage_version: 4,
          stripe_account_id: 'acct_seller_1',
          payout_create_attempted_at: '2026-09-20T00:00:00.000Z',
        }),
        null,
      ],
      verifyPayoutClaim: async () => {
        throw new Error('CLAIM_LEASE_EXPIRED');
      },
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(deps.calls.stripePayoutLists).toEqual([]);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
    expect(deps.calls.fenceAborts).toEqual([]);
    expect(summary.results).toEqual([
      {
        runId: 'run-awaiting-1',
        status: 'skipped',
        reason: 'claim_lease_expired',
      },
    ]);
  });

  test('a lost deferral is a stale claim: the worker releases and skips without further writes', async () => {
    // The defer RPC won nothing (lease lapsed or a newer claim took over);
    // the worker must not report a deferral it did not win.
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      balanceAvailable: 7_500,
      deferAwaitingBalanceRun: async () => false,
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.skipped).toBe(1);
    expect(summary.results).toEqual([
      { runId: 'run-awaiting-1', status: 'skipped', reason: 'stale_claim' },
    ]);
    expect(deps.calls.claimReleases).toEqual([
      { runId: 'run-awaiting-1', claimToken: 'claim-token-1' },
    ]);
    expect(deps.calls.fenceBegins).toEqual([]);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
  });

  test('eligibility drift to an active dispute parks the run action_required with no Stripe call', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
    });
    deps.loadReleaseRows = async () => [
      completedShipment({
        is_eligible: false,
        ineligible_reason: 'active_dispute',
      }),
    ];

    const summary = await resumePendingPayoutRuns(deps);

    // The drift is a durable decision change: the run parks in
    // action_required through a token-, version-, and lease-gated transition;
    // Stripe is never consulted.
    expect(summary.actionRequired).toBe(1);
    expect(summary.results).toEqual([
      {
        runId: 'run-awaiting-1',
        status: 'action_required',
        reason: 'run_shape_invalid',
      },
    ]);
    expect(deps.calls.parkedTransitions).toEqual([
      {
        runId: 'run-awaiting-1',
        claimToken: 'claim-token-1',
        stageVersion: 3,
        reason: 'RUN_SHAPE_INVALID',
      },
    ]);
    expect(deps.calls.balanceRetrievals).toEqual([]);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
    expect(deps.calls.fenceBegins).toEqual([]);
  });

  test('a deferred run is not re-claimed in the same tick while a newer eligible run proceeds', async () => {
    // The SQL claim gate serves the deferred run only after its
    // next_attempt_at: the batch keeps working newer eligible runs instead
    // of starving them behind the backoff.
    const deps = createWorkerDeps({
      createClaimQueue: [
        claimedRun({ run_id: 'run-old', idempotency_key: 'key-old' }),
        claimedRun({ run_id: 'run-new', idempotency_key: 'key-new' }),
        null,
      ],
    });
    let balanceCalls = 0;
    deps.retrieveConnectedBalance = async () => {
      balanceCalls += 1;
      return {
        available: [
          { amount: balanceCalls === 1 ? 7_500 : 99_999, currency: 'mxn' },
        ],
      };
    };

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.deferred).toBe(1);
    expect(summary.resumed).toBe(1);
    expect(deps.calls.deferrals).toHaveLength(1);
    expect(deps.calls.deferrals[0]).toMatchObject({ runId: 'run-old' });
    expect(deps.calls.createClaims).toHaveLength(3);
    expect(deps.calls.stripePayoutCreates).toHaveLength(1);
    expect(
      deps.calls.stripePayoutCreates[0]).toMatchObject({
      metadata: { run_id: 'run-new' },
    });
  });

  test('reconciliation without a connected-account context parks action_required and never lists Stripe', async () => {
    const deps = createWorkerDeps({
      reconcileClaimQueue: [claimedRun(), null],
    });

    const summary = await resumePendingPayoutRuns(deps);

    expect(summary.actionRequired).toBe(1);
    expect(deps.calls.stripePayoutLists).toEqual([]);
    expect(deps.calls.stripePayoutCreates).toEqual([]);
  });

  test('verifies the claim before the connected-balance read in the reconciliation window too', async () => {
    const deps = createWorkerDeps({
      createClaimQueue: [claimedRun(), null],
      balanceAvailable: 99_999,
    });

    const summary = await resumePendingPayoutRuns(deps);

    // Verification happens before the balance call and carries the claim's
    // stage version at that point.
    expect(deps.calls.claimVerifications[0]).toEqual({
      runId: 'run-awaiting-1',
      claimToken: 'claim-token-1',
      stageVersion: 3,
    });
    expect(deps.calls.balanceRetrievals).toHaveLength(1);
    expect(summary.resumed).toBe(1);
  });
});

describe('validateResumeRequest', () => {
  const base = {
    method: 'POST',
    suppliedCronSecret: 'secret-1',
    expectedCronSecret: 'secret-1',
  };

  test('rejects non-POST invocations', () => {
    expect(() =>
      validateResumeRequest({ ...base, method: 'GET' }),
    ).toThrow('INVALID_REQUEST');
  });

  test('fails closed when no cron secret is configured', () => {
    expect(() =>
      validateResumeRequest({ ...base, expectedCronSecret: null }),
    ).toThrow('INTERNAL_ERROR');
  });

  test('rejects a wrong cron secret', () => {
    expect(() =>
      validateResumeRequest({ ...base, suppliedCronSecret: 'wrong' }),
    ).toThrow('CRON_UNAUTHORIZED');
  });

  test('accepts a valid cron invocation', () => {
    expect(() => validateResumeRequest(base)).not.toThrow();
  });
});
