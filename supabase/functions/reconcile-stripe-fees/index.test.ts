import { describe, expect, it } from 'bun:test';

import * as reconciliationModule from './index.ts';
import { parseClaimedFeeJobs, reconcileStripeFeeJobs, requireMutationResult } from './index.ts';


type ClaimedStripeFeeJob = {
  id: string;
  orderId: string;
  stripePaymentIntentId: string;
  attemptCount: number;
  claimToken: string;
};

type StripeFeeReconciliationAdapterDependencies = {
  workerServiceRoleJwt: string | undefined;
  now: () => string;
  policy: {
    batchSize: number;
    maxAttempts: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
  };
  claimDueJobsAtomically: (selection: {
    status: 'pending';
    dueAtOrBefore: string;
    limit: number;
  }) => Promise<ClaimedStripeFeeJob[]>;
  loadOrderStripeChargeId: (input: {
    orderId: string;
  }) => Promise<string | null>;
  retrieveCharge: (chargeId: string) => Promise<{
    id: string;
    balanceTransactionId: string | null;
  }>;
  retrieveBalanceTransaction: (balanceTransactionId: string) => Promise<{
    id: string;
    fee: unknown;
  }>;
  persistFeeAndMarkSucceededAtomically: (completion: unknown) => Promise<boolean>;
  scheduleRetryAtomically: (retry: unknown) => Promise<boolean>;
  markFailedAtomically: (failure: unknown) => Promise<boolean>;
};

type ReconciliationRunner = typeof reconcileStripeFeeJobs;

type ReconcileStripeFeesHandlerFactory = (
  dependencies: StripeFeeReconciliationAdapterDependencies,
  runReconciliation?: ReconciliationRunner,
) => (request: Request) => Promise<Response>;

const createReconcileStripeFeesHandler = (
  reconciliationModule as unknown as {
    createReconcileStripeFeesHandler?: ReconcileStripeFeesHandlerFactory;
  }
).createReconcileStripeFeesHandler;

const requireProductionAdapter = (): ReconcileStripeFeesHandlerFactory => {
  expect(createReconcileStripeFeesHandler).toBeFunction();
  return createReconcileStripeFeesHandler as ReconcileStripeFeesHandlerFactory;
};

const NOW = '2026-09-18T12:00:00.000Z';
const JOB = {
  id: '11111111-1111-4111-8111-111111111111',
  orderId: '22222222-2222-4222-8222-222222222222',
  stripePaymentIntentId: 'pi_fee_reconciliation',
  stripeChargeId: 'ch_stored_on_order',
  attemptCount: 0,
  claimToken: '33333333-3333-4333-8333-333333333333',
};

const POLICY = {
  batchSize: 25,
  maxAttempts: 3,
  baseBackoffMs: 60_000,
  maxBackoffMs: 300_000,
};

describe('reconcile Stripe fees worker', () => {
  it('selects only pending jobs whose retry time is due', async () => {
    const selections: unknown[] = [];

    const result = await reconcileStripeFeeJobs(
      { now: NOW, ...POLICY },
      {
        selectDuePendingJobs: async (selection: unknown) => {
          selections.push(selection);
          return [];
        },
        retrieveCharge: async () => {
          throw new Error('Stripe must not be called without a due job');
        },
        retrieveBalanceTransaction: async () => {
          throw new Error('Stripe must not be called without a due job');
        },
        persistFeeAndMarkSucceeded: async () => {
          throw new Error('No mutation is allowed without a due job');
        },
        scheduleRetry: async () => {
          throw new Error('No mutation is allowed without a due job');
        },
        markFailed: async () => {
          throw new Error('No mutation is allowed without a due job');
        },
      },
    );

    expect(selections).toEqual([
      { status: 'pending', dueAtOrBefore: NOW, limit: POLICY.batchSize },
    ]);
    expect(result).toEqual({
      selected: 0,
      succeeded: 0,
      retryScheduled: 0,
      failed: 0,
      errors: 0,
    });
  });

  it('retrieves the stored charge and its authoritative balance transaction, then persists the fee exactly once and succeeds the job', async () => {
    const effects: string[] = [];
    const completions: unknown[] = [];

    const result = await reconcileStripeFeeJobs(
      { now: NOW, ...POLICY },
      {
        selectDuePendingJobs: async () => {
          effects.push('jobs.select_due_pending');
          return [JOB];
        },
        retrieveCharge: async (chargeId: string) => {
          effects.push(`stripe.charges.retrieve:${chargeId}`);
          return {
            id: chargeId,
            balanceTransactionId: 'txn_authoritative_fee',
          };
        },
        retrieveBalanceTransaction: async (balanceTransactionId: string) => {
          effects.push(
            `stripe.balanceTransactions.retrieve:${balanceTransactionId}`,
          );
          return { id: balanceTransactionId, fee: 21_992 };
        },
        persistFeeAndMarkSucceeded: async (completion: unknown) => {
          effects.push('fee_reconciliation.complete');
          completions.push(completion);
          return true;
        },
        scheduleRetry: async () => {
          effects.push('fee_reconciliation.retry');
          return true;
        },
        markFailed: async () => {
          effects.push('fee_reconciliation.fail');
          return true;
        },
      },
    );

    expect(effects).toEqual([
      'jobs.select_due_pending',
      'stripe.charges.retrieve:ch_stored_on_order',
      'stripe.balanceTransactions.retrieve:txn_authoritative_fee',
      'fee_reconciliation.complete',
    ]);
    expect(completions).toEqual([
      {
        jobId: JOB.id,
        claimToken: JOB.claimToken,
        orderId: JOB.orderId,
        actualStripeFeeCents: 21_992,
        reconciledAt: NOW,
        status: 'succeeded',
      },
    ]);
    expect(completions).toHaveLength(1);
    expect(result).toEqual({
      selected: 1,
      succeeded: 1,
      retryScheduled: 0,
      failed: 0,
      errors: 0,
    });
  });

  it('increments attempts and caps backoff when the authoritative fee remains unavailable', async () => {
    const retries: unknown[] = [];
    const job = { ...JOB, attemptCount: 4 };

    const result = await reconcileStripeFeeJobs(
      { now: NOW, ...POLICY, maxAttempts: 8 },
      {
        selectDuePendingJobs: async () => [job],
        retrieveCharge: async () => ({
          id: job.stripeChargeId,
          balanceTransactionId: 'txn_fee_not_ready',
        }),
        retrieveBalanceTransaction: async () => ({
          id: 'txn_fee_not_ready',
          fee: null,
        }),
        persistFeeAndMarkSucceeded: async () => {
          throw new Error('An unavailable fee must not be persisted');
        },
        scheduleRetry: async (retry: unknown) => {
          retries.push(retry);
          return true;
        },
        markFailed: async () => {
          throw new Error('The retry budget is not exhausted');
        },
      },
    );

    expect(retries).toEqual([
      {
        jobId: job.id,
        claimToken: job.claimToken,
        attemptCount: 5,
        nextRetryAt: '2026-09-18T12:05:00.000Z',
        lastError: 'STRIPE_FEE_UNAVAILABLE',
        status: 'pending',
      },
    ]);
    expect(result).toEqual({
      selected: 1,
      succeeded: 0,
      retryScheduled: 1,
      failed: 0,
      errors: 0,
    });
  });

  it('marks the job failed after the maximum attempt instead of scheduling another retry', async () => {
    const failures: unknown[] = [];
    const job = { ...JOB, attemptCount: POLICY.maxAttempts - 1 };

    const result = await reconcileStripeFeeJobs(
      { now: NOW, ...POLICY },
      {
        selectDuePendingJobs: async () => [job],
        retrieveCharge: async () => ({
          id: job.stripeChargeId,
          balanceTransactionId: null,
        }),
        retrieveBalanceTransaction: async () => {
          throw new Error('A missing balance transaction cannot be retrieved');
        },
        persistFeeAndMarkSucceeded: async () => {
          throw new Error('An unavailable fee must not be persisted');
        },
        scheduleRetry: async () => {
          throw new Error('The retry budget is exhausted');
        },
        markFailed: async (failure: unknown) => {
          failures.push(failure);
          return true;
        },
      },
    );

    expect(failures).toEqual([
      {
        jobId: job.id,
        claimToken: job.claimToken,
        attemptCount: POLICY.maxAttempts,
        nextRetryAt: null,
        lastError: 'STRIPE_FEE_UNAVAILABLE',
        status: 'failed',
      },
    ]);
    expect(result).toEqual({
      selected: 1,
      succeeded: 0,
      retryScheduled: 0,
      failed: 1,
      errors: 0,
    });
  });

  it('performs no commerce lifecycle mutations while reconciling a fee', async () => {
    const forbiddenEffects: string[] = [];
    const forbiddenMutations = {
      createOrModifyOrder: async () => forbiddenEffects.push('orders'),
      createOrModifyShipment: async () => forbiddenEffects.push('shipments'),
      createOrModifyPayment: async () => forbiddenEffects.push('payments'),
      createOrModifyPayout: async () => forbiddenEffects.push('payouts'),
      createOrModifyTransfer: async () => forbiddenEffects.push('transfers'),
      createOrModifyCancellation: async () => forbiddenEffects.push('cancellations'),
      createOrModifyRefund: async () => forbiddenEffects.push('refunds'),
    };

    await reconcileStripeFeeJobs(
      { now: NOW, ...POLICY },
      {
        selectDuePendingJobs: async () => [JOB],
        retrieveCharge: async () => ({
          id: JOB.stripeChargeId,
          balanceTransactionId: 'txn_read_only',
        }),
        retrieveBalanceTransaction: async () => ({
          id: 'txn_read_only',
          fee: 21_992,
        }),
        persistFeeAndMarkSucceeded: async () => true,
        scheduleRetry: async () => true,
        markFailed: async () => true,
        ...forbiddenMutations,
      },
    );

    expect(forbiddenEffects).toEqual([]);
  });
});

describe('reconcile Stripe fees production adapter', () => {
  const requestFor = (authorization: string | null) =>
    new Request('https://example.com/functions/v1/reconcile-stripe-fees', {
      method: 'POST',
      headers: authorization ? { authorization } : undefined,
    });

  const dependencies = (
    overrides: Partial<StripeFeeReconciliationAdapterDependencies> = {},
  ): StripeFeeReconciliationAdapterDependencies => ({
    workerServiceRoleJwt: 'fee-worker.jwt',
    now: () => NOW,
    policy: POLICY,
    claimDueJobsAtomically: async () => [],
    loadOrderStripeChargeId: async () => null,
    retrieveCharge: async () => {
      throw new Error('Stripe must not be called without a claimed job');
    },
    retrieveBalanceTransaction: async () => {
      throw new Error('Stripe must not be called without a claimed job');
    },
    persistFeeAndMarkSucceededAtomically: async () => true,
    scheduleRetryAtomically: async () => true,
    markFailedAtomically: async () => true,
    ...overrides,
  });

  it('rejects missing, invalid, and unconfigured worker authorization before claiming jobs', async () => {
    const createHandler = requireProductionAdapter();
    let claimed = false;
    const runReconciliation: ReconciliationRunner = async () => {
      throw new Error('Unauthorized invocation must not reach reconciliation');
    };

    for (const [authorization, workerServiceRoleJwt] of [
      [null, 'fee-worker.jwt'],
      ['Bearer wrong.jwt', 'fee-worker.jwt'],
      ['Bearer ', ''],
      ['Bearer anything', undefined],
    ] as const) {
      const handler = createHandler(
        dependencies({
          workerServiceRoleJwt,
          claimDueJobsAtomically: async () => {
            claimed = true;
            return [];
          },
        }),
        runReconciliation,
      );

      const response = await handler(requestFor(authorization));

      expect(response.status).toBe(401);
    }

    expect(claimed).toBe(false);
  });

  it('claims due jobs atomically, loads charge evidence from orders, delegates to the pure routine, and completes atomically', async () => {
    const createHandler = requireProductionAdapter();
    const effects: string[] = [];
    const claims: unknown[] = [];
    const completions: unknown[] = [];
    const claimedJob: ClaimedStripeFeeJob = {
      id: JOB.id,
      orderId: JOB.orderId,
      stripePaymentIntentId: JOB.stripePaymentIntentId,
      attemptCount: JOB.attemptCount,
      claimToken: JOB.claimToken,
    };

    const handler = createHandler(
      dependencies({
        claimDueJobsAtomically: async (selection) => {
          effects.push('jobs.claim_due_atomically');
          claims.push(selection);
          return [claimedJob];
        },
        loadOrderStripeChargeId: async ({ orderId }) => {
          effects.push(`orders.load_stripe_charge_id:${orderId}`);
          return JOB.stripeChargeId;
        },
        retrieveCharge: async (chargeId) => {
          effects.push(`stripe.charges.retrieve:${chargeId}`);
          return {
            id: chargeId,
            balanceTransactionId: 'txn_authoritative_fee',
          };
        },
        retrieveBalanceTransaction: async (balanceTransactionId) => {
          effects.push(
            `stripe.balanceTransactions.retrieve:${balanceTransactionId}`,
          );
          return { id: balanceTransactionId, fee: 21_992 };
        },
        persistFeeAndMarkSucceededAtomically: async (completion) => {
          effects.push('fee_and_job.persist_atomically');
          completions.push(completion);
          return true;
        },
      }),
      async (policy, adapter) => {
        effects.push('reconciliation.run');
        return reconcileStripeFeeJobs(policy, adapter);
      },
    );

    const response = await handler(requestFor('Bearer fee-worker.jwt'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      selected: 1,
      succeeded: 1,
      retryScheduled: 0,
      failed: 0,
      errors: 0,
    });
    expect(claims).toEqual([
      { status: 'pending', dueAtOrBefore: NOW, limit: POLICY.batchSize },
    ]);
    expect(effects).toEqual([
      'reconciliation.run',
      'jobs.claim_due_atomically',
      `orders.load_stripe_charge_id:${JOB.orderId}`,
      `stripe.charges.retrieve:${JOB.stripeChargeId}`,
      'stripe.balanceTransactions.retrieve:txn_authoritative_fee',
      'fee_and_job.persist_atomically',
    ]);
    expect(completions).toEqual([
      {
        jobId: JOB.id,
        claimToken: JOB.claimToken,
        orderId: JOB.orderId,
        actualStripeFeeCents: 21_992,
        reconciledAt: NOW,
        status: 'succeeded',
      },
    ]);
  });
});

// Intended future worker contract, not the deployed generated DB contract.
// All IO below is mocked; these tests do not execute PostgreSQL.
describe('fee worker crash recovery and per-job containment (mocked IO)', () => {
  const token = '33333333-3333-4333-8333-333333333333';
  const leasedJob = { ...JOB, claimToken: token };
  const secondJob = { ...leasedJob, id: '44444444-4444-4444-8444-444444444444', orderId: 'second-order' };
  const adapter = (overrides: Record<string, unknown> = {}) => ({
    workerServiceRoleJwt: 'fee-worker.jwt',
    now: () => NOW,
    policy: POLICY,
    claimDueJobsAtomically: async () => [leasedJob, secondJob],
    loadOrderStripeChargeId: async () => JOB.stripeChargeId,
    retrieveCharge: async (id: string) => ({ id, balanceTransactionId: 'txn_fee' }),
    retrieveBalanceTransaction: async () => ({ id: 'txn_fee', fee: 123 }),
    persistFeeAndMarkSucceededAtomically: async () => true,
    scheduleRetryAtomically: async () => true,
    markFailedAtomically: async () => true,
    reportJobError: () => undefined,
    ...overrides,
  });
  const invoke = async (overrides: Record<string, unknown>) => {
    const handler = requireProductionAdapter()(adapter(overrides) as unknown as StripeFeeReconciliationAdapterDependencies);
    return handler(new Request('https://example.com/reconcile-stripe-fees', {
      method: 'POST', headers: { authorization: 'Bearer fee-worker.jwt' },
    }));
  };

  it('isolates order charge lookup rejection and still completes the next claimed job', async () => {
    const completed: unknown[] = [];
    const response = await invoke({
      loadOrderStripeChargeId: async ({ orderId }: { orderId: string }) => {
        if (orderId === JOB.orderId) throw new Error('lookup rejected');
        return JOB.stripeChargeId;
      },
      persistFeeAndMarkSucceededAtomically: async (input: unknown) => { completed.push(input); return true; },
    });
    expect(response.status).toBe(200);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ jobId: secondJob.id });
  });

  for (const outcome of ['retry', 'failed'] as const) {
    it(`isolates ${outcome} RPC rejection and still completes the next job`, async () => {
      const completed: unknown[] = [];
      const errors: unknown[] = [];
      const response = await invoke({
        claimDueJobsAtomically: async () => [{ ...leasedJob, attemptCount: outcome === 'failed' ? 2 : 0 }, secondJob],
        loadOrderStripeChargeId: async ({ orderId }: { orderId: string }) => orderId === JOB.orderId ? null : JOB.stripeChargeId,
        [outcome === 'failed' ? 'markFailedAtomically' : 'scheduleRetryAtomically']: async () => { throw new Error(`${outcome} rejected`); },
        reportJobError: (error: unknown) => errors.push(error),
        persistFeeAndMarkSucceededAtomically: async (input: unknown) => { completed.push(input); return true; },
      });
      expect(response.status).toBe(200);
      expect(completed).toHaveLength(1);
      expect(await response.json()).toMatchObject({ succeeded: 1, errors: 1 });
      expect(errors).toHaveLength(1);
    });
  }

  for (const outcome of ['complete', 'retry', 'failed'] as const) {
    it(`propagates the opaque claim token to ${outcome}`, async () => {
      const mutations: unknown[] = [];
      const response = await invoke({
        claimDueJobsAtomically: async () => [{ ...leasedJob, attemptCount: outcome === 'failed' ? 2 : 0 }],
        loadOrderStripeChargeId: async () => outcome === 'complete' ? JOB.stripeChargeId : null,
        [outcome === 'complete' ? 'persistFeeAndMarkSucceededAtomically' : outcome === 'retry' ? 'scheduleRetryAtomically' : 'markFailedAtomically']:
          async (input: unknown) => { mutations.push(input); return true; },
      });
      expect(response.status).toBe(200);
      expect(mutations).toHaveLength(1);
      expect(mutations[0]).toMatchObject({ jobId: JOB.id, claimToken: token });
    });
  }

  it('reports stale completion explicitly, counts no success, and does not transition the lost claim', async () => {
    const errors: unknown[] = [];
    const transitions: unknown[] = [];
    const response = await invoke({
      claimDueJobsAtomically: async () => [leasedJob],
      persistFeeAndMarkSucceededAtomically: async () => false,
      reportJobError: (error: unknown) => errors.push(error),
      scheduleRetryAtomically: async (input: unknown) => { transitions.push(input); return true; },
      markFailedAtomically: async (input: unknown) => { transitions.push(input); return true; },
    });
    expect(await response.json()).toMatchObject({ succeeded: 0, errors: 1 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ jobId: JOB.id, code: 'STRIPE_FEE_CLAIM_LOST' });
    expect(transitions).toEqual([]);
  });

  it('rejects a pre-interruption token after mocked reclaim and completes only the current owner', async () => {
    // This models fencing at the persistence boundary, NOT SQL locking/expiry.
    const reclaimedToken = '55555555-5555-4555-8555-555555555555';
    let owner = token;
    let fee: number | null = null;
    let writes = 0;
    const persist = async (input: { claimToken?: string; actualStripeFeeCents: number }) => {
      if (input.claimToken !== owner) return false;
      if (fee === null) { fee = input.actualStripeFeeCents; writes += 1; }
      return true;
    };
    owner = reclaimedToken; // Simulated interrupted worker expiry and new DB claim.
    const stale = await invoke({ claimDueJobsAtomically: async () => [leasedJob], persistFeeAndMarkSucceededAtomically: persist });
    expect(await stale.json()).toMatchObject({ succeeded: 0, errors: 1 });
    expect(fee).toBeNull();
    const current = await invoke({ claimDueJobsAtomically: async () => [{ ...leasedJob, claimToken: reclaimedToken }], persistFeeAndMarkSucceededAtomically: persist });
    expect(await current.json()).toMatchObject({ succeeded: 1 });
    expect(fee).toBe(123);
    const duplicate = await invoke({ claimDueJobsAtomically: async () => [{ ...leasedJob, claimToken: reclaimedToken }], persistFeeAndMarkSucceededAtomically: persist });
    expect(await duplicate.json()).toMatchObject({ succeeded: 1 });
    expect(writes).toBe(1);
  });

  for (const outcome of ['complete', 'retry', 'failed'] as const) {
    for (const refused of [false, undefined, null, {}, 'true']) {
      it(`does not count ${outcome} with RPC response ${JSON.stringify(refused)}`, async () => {
        const errors: unknown[] = [];
        const response = await invoke({
          claimDueJobsAtomically: async () => [{ ...leasedJob, attemptCount: outcome === 'failed' ? 2 : 0 }, secondJob],
          loadOrderStripeChargeId: async ({ orderId }: { orderId: string }) =>
            orderId === JOB.orderId && outcome !== 'complete' ? null : JOB.stripeChargeId,
          [outcome === 'complete' ? 'persistFeeAndMarkSucceededAtomically' : outcome === 'retry' ? 'scheduleRetryAtomically' : 'markFailedAtomically']:
            async (input: { jobId: string }) => input.jobId === JOB.id ? refused : true,
          reportJobError: (error: unknown) => errors.push(error),
        });
        expect(await response.json()).toMatchObject({ succeeded: 1, retryScheduled: 0, failed: 0, errors: 1 });
        expect(errors).toEqual([{ jobId: JOB.id, code: refused === false ? 'STRIPE_FEE_CLAIM_LOST' : 'STRIPE_FEE_JOB_IO_FAILED' }]);
      });
    }
  }

  it('contains ambiguous completion rejection without retrying or leaking provider details', async () => {
    const errors: unknown[] = [];
    const transitions: unknown[] = [];
    const response = await invoke({
      persistFeeAndMarkSucceededAtomically: async (input: { jobId: string }) => {
        if (input.jobId === JOB.id) throw new Error('arbitrary provider detail must not escape');
        return true;
      },
      scheduleRetryAtomically: async (input: unknown) => { transitions.push(input); return true; },
      reportJobError: (error: unknown) => errors.push(error),
    });
    expect(await response.json()).toMatchObject({ succeeded: 1, errors: 1 });
    expect(transitions).toEqual([]);
    expect(errors).toEqual([{ jobId: JOB.id, code: 'STRIPE_FEE_JOB_IO_FAILED' }]);
  });

  it('rejects tokenless jobs before Stripe or mutation', async () => {
    let touched = false;
    const response = await invoke({
      claimDueJobsAtomically: async () => [{ ...leasedJob, claimToken: null }],
      retrieveCharge: async () => { touched = true; throw new Error('not reachable'); },
      persistFeeAndMarkSucceededAtomically: async () => { touched = true; return true; },
    });
    expect(await response.json()).toMatchObject({ succeeded: 0, errors: 1 });
    expect(touched).toBe(false);
  });
});

describe('intended leased RPC response validation', () => {
  const row = {
    id: JOB.id, order_id: JOB.orderId, stripe_payment_intent_id: JOB.stripePaymentIntentId,
    claim_token: JOB.claimToken, claim_expires_at: NOW, status: 'processing', attempt_count: 1,
  };
  it('maps the already-counted active attempt and opaque token', () => {
    expect(parseClaimedFeeJobs([row])).toEqual([{
      id: JOB.id, orderId: JOB.orderId, stripePaymentIntentId: JOB.stripePaymentIntentId,
      attemptCount: 0, claimToken: JOB.claimToken,
    }]);
    expect(parseClaimedFeeJobs([])).toEqual([]);
    expect(requireMutationResult(true)).toBe(true);
    expect(requireMutationResult(false)).toBe(false);
  });
  for (const value of [null, undefined, {}, [null], [{ ...row, claim_token: null }],
    [{ ...row, claim_expires_at: 'invalid' }], [{ ...row, status: 'succeeded' }],
    [{ ...row, attempt_count: 0 }], [{ ...row, attempt_count: 101 }], [{ ...row, order_id: 'invalid' }]]) {
    it(`refuses malformed claim data ${JSON.stringify(value)}`, () => {
      expect(() => parseClaimedFeeJobs(value)).toThrow('INVALID_FEE_CLAIM_RESPONSE');
    });
  }
  for (const value of [null, undefined, {}, 'true', 1]) {
    it(`refuses malformed mutation data ${JSON.stringify(value)}`, () => {
      expect(() => requireMutationResult(value)).toThrow('INVALID_FEE_MUTATION_RESPONSE');
    });
  }
});
