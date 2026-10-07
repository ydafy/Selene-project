import type { Database } from '../../../packages/types/src/database.types.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';
const WORKER_BEARER_SECRET_ENV = 'STRIPE_FEE_RECONCILIATION_WORKER_SECRET';
const PRODUCTION_POLICY = {
  batchSize: 25,
  maxAttempts: 3,
  baseBackoffMs: 60_000,
  maxBackoffMs: 300_000,
} as const;

// Intended future RPC contract from 20261007000000, NOT deployed generated types.
// Replace this bridge only after maintainer SQL confirmation and type regeneration.
type ClaimedJobRow = Database['public']['Tables']['stripe_fee_reconciliation_jobs']['Row'] & {
  claim_token: string;
  claim_expires_at: string;
};
type CompleteJobArgs = {
  p_job_id: string;
  p_claim_token: string;
  p_actual_stripe_fee_cents: number;
  p_reconciled_at: string;
};
type TransitionJobArgs = {
  p_job_id: string;
  p_claim_token: string;
  p_outcome: 'retry' | 'failed';
  p_next_retry_at?: string;
  p_last_error: string;
};
type FeeWorkerDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & {
      fn_claim_stripe_fee_reconciliation_jobs_leased: {
        Args: { p_limit: number; p_max_attempts: number };
        Returns: ClaimedJobRow[];
      };
      fn_complete_stripe_fee_reconciliation_job_leased: {
        Args: CompleteJobArgs;
        Returns: boolean;
      };
      fn_transition_stripe_fee_reconciliation_job_leased: {
        Args: TransitionJobArgs;
        Returns: boolean;
      };
    };
  };
};

type JobError = {
  jobId: string;
  code: 'STRIPE_FEE_CLAIM_LOST' | 'STRIPE_FEE_JOB_IO_FAILED';
};

type ReconciliationPolicy = {
  now: string;
  batchSize: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
};

type StripeFeeJob = {
  id: string;
  orderId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  attemptCount: number;
  claimToken: string;
};

type ClaimedStripeFeeJob = Omit<StripeFeeJob, 'stripeChargeId'>;

type DueJobSelection = {
  status: 'pending';
  dueAtOrBefore: string;
  limit: number;
};

type RetrievedCharge = {
  id: string;
  balanceTransactionId: string | null;
};

type RetrievedBalanceTransaction = {
  id: string;
  fee: unknown;
};

type SuccessfulReconciliation = {
  jobId: string;
  claimToken: string;
  orderId: string;
  actualStripeFeeCents: number;
  reconciledAt: string;
  status: 'succeeded';
};

type PendingRetry = {
  jobId: string;
  claimToken: string;
  attemptCount: number;
  nextRetryAt: string;
  lastError: 'STRIPE_FEE_UNAVAILABLE';
  status: 'pending';
};

type FailedReconciliation = {
  jobId: string;
  claimToken: string;
  attemptCount: number;
  nextRetryAt: null;
  lastError: 'STRIPE_FEE_UNAVAILABLE';
  status: 'failed';
};

type ReconciliationDependencies = {
  selectDuePendingJobs: (selection: DueJobSelection) => Promise<StripeFeeJob[]>;
  retrieveCharge: (chargeId: string) => Promise<RetrievedCharge>;
  retrieveBalanceTransaction: (
    balanceTransactionId: string,
  ) => Promise<RetrievedBalanceTransaction>;
  persistFeeAndMarkSucceeded: (
    completion: SuccessfulReconciliation,
  ) => Promise<boolean>;
  scheduleRetry: (retry: PendingRetry) => Promise<boolean>;
  markFailed: (failure: FailedReconciliation) => Promise<boolean>;
  loadOrderStripeChargeId?: (input: { orderId: string }) => Promise<string | null>;
  reportJobError?: (error: JobError) => void;
};

type ReconciliationResult = {
  selected: number;
  succeeded: number;
  retryScheduled: number;
  failed: number;
  errors: number;
};

type StripeFeeReconciliationAdapterDependencies = {
  workerServiceRoleJwt: string | undefined;
  now: () => string;
  policy: Omit<ReconciliationPolicy, 'now'>;
  claimDueJobsAtomically: (
    selection: DueJobSelection,
  ) => Promise<ClaimedStripeFeeJob[]>;
  loadOrderStripeChargeId: (input: {
    orderId: string;
  }) => Promise<string | null>;
  retrieveCharge: (chargeId: string) => Promise<RetrievedCharge>;
  retrieveBalanceTransaction: (
    balanceTransactionId: string,
  ) => Promise<RetrievedBalanceTransaction>;
  persistFeeAndMarkSucceededAtomically: (
    completion: SuccessfulReconciliation,
  ) => Promise<boolean>;
  scheduleRetryAtomically: (retry: PendingRetry) => Promise<boolean>;
  markFailedAtomically: (failure: FailedReconciliation) => Promise<boolean>;
  reportJobError?: (error: JobError) => void;
};

type ReconciliationRunner = (
  policy: ReconciliationPolicy,
  dependencies: ReconciliationDependencies,
) => Promise<ReconciliationResult>;

const FEE_UNAVAILABLE = 'STRIPE_FEE_UNAVAILABLE' as const;

const retryAt = (
  now: string,
  attemptCount: number,
  policy: Pick<ReconciliationPolicy, 'baseBackoffMs' | 'maxBackoffMs'>,
): string => {
  const exponentialDelay =
    policy.baseBackoffMs * 2 ** Math.max(0, attemptCount - 1);
  const delayMs = Math.min(exponentialDelay, policy.maxBackoffMs);

  return new Date(new Date(now).getTime() + delayMs).toISOString();
};

/**
 * Reconciles authoritative Stripe processing fees without invoking any commerce
 * lifecycle mutation. Persistence and job transitions stay behind injected,
 * narrowly scoped dependencies so the successful write can be atomic.
 */
export const reconcileStripeFeeJobs = async (
  policy: ReconciliationPolicy,
  dependencies: ReconciliationDependencies,
): Promise<ReconciliationResult> => {
  const jobs = await dependencies.selectDuePendingJobs({
    status: 'pending',
    dueAtOrBefore: policy.now,
    limit: policy.batchSize,
  });
  const result: ReconciliationResult = {
    selected: jobs.length,
    succeeded: 0,
    retryScheduled: 0,
    failed: 0,
    errors: 0,
  };
  const report = (job: StripeFeeJob, code: JobError['code']): void => {
    result.errors += 1;
    // Only allowlisted codes and ledger IDs leave this boundary, never provider details.
    try { dependencies.reportJobError?.({ jobId: job.id, code }); } catch {
      // A failed observer must not abort the remaining claimed batch.
    }
  };

  for (const job of jobs) {
    if (!isUuid(job.claimToken)) {
      report(job, 'STRIPE_FEE_CLAIM_LOST');
      continue;
    }
    let authoritativeFee: number | null = null;
    try {
      const chargeId = dependencies.loadOrderStripeChargeId
        ? await dependencies.loadOrderStripeChargeId({ orderId: job.orderId })
        : job.stripeChargeId;
      if (chargeId) {
        const charge = await dependencies.retrieveCharge(chargeId);
        if (charge.balanceTransactionId) {
          const transaction = await dependencies.retrieveBalanceTransaction(charge.balanceTransactionId);
          if (typeof transaction.fee === 'number' && Number.isSafeInteger(transaction.fee) && transaction.fee >= 0) {
            authoritativeFee = transaction.fee;
          }
        }
      }
    } catch {
      report(job, 'STRIPE_FEE_JOB_IO_FAILED');
    }

    if (authoritativeFee !== null) {
      try {
        const completed = await dependencies.persistFeeAndMarkSucceeded({
          jobId: job.id, claimToken: job.claimToken, orderId: job.orderId,
          actualStripeFeeCents: authoritativeFee, reconciledAt: policy.now, status: 'succeeded',
        });
        if (requireMutationResult(completed)) result.succeeded += 1;
        else report(job, 'STRIPE_FEE_CLAIM_LOST');
      } catch {
        // Completion may have committed before an IO failure. Leave ownership intact
        // for same-token replay or expiry/reclaim; never follow ambiguous success with retry.
        report(job, 'STRIPE_FEE_JOB_IO_FAILED');
      }
      continue;
    }

    const attemptCount = Math.min(job.attemptCount + 1, policy.maxAttempts);
    try {
      const exhausted = attemptCount >= policy.maxAttempts;
      const transitioned = exhausted
        ? await dependencies.markFailed({
            jobId: job.id, claimToken: job.claimToken, attemptCount,
            nextRetryAt: null, lastError: FEE_UNAVAILABLE, status: 'failed',
          })
        : await dependencies.scheduleRetry({
            jobId: job.id, claimToken: job.claimToken, attemptCount,
            nextRetryAt: retryAt(policy.now, attemptCount, policy),
            lastError: FEE_UNAVAILABLE, status: 'pending',
          });
      if (!requireMutationResult(transitioned)) report(job, 'STRIPE_FEE_CLAIM_LOST');
      else if (exhausted) result.failed += 1;
      else result.retryScheduled += 1;
    } catch {
      report(job, 'STRIPE_FEE_JOB_IO_FAILED');
    }
  }

  return result;
};

/**
 * Creates the authenticated HTTP adapter for the fee reconciliation worker.
 * Claimed jobs intentionally obtain charge evidence from their orders rather
 * than accepting a charge identifier from the caller or the job row.
 */
export const createReconcileStripeFeesHandler =
  (
    dependencies: StripeFeeReconciliationAdapterDependencies,
    runReconciliation: ReconciliationRunner = reconcileStripeFeeJobs,
  ) =>
  async (request: Request): Promise<Response> => {
    const workerServiceRoleJwt = dependencies.workerServiceRoleJwt;
    if (
      !workerServiceRoleJwt ||
      workerServiceRoleJwt.trim().length === 0 ||
      request.headers.get('authorization') !== `Bearer ${workerServiceRoleJwt}`
    ) {
      return new Response('Unauthorized', { status: 401 });
    }

    const now = dependencies.now();
    const result = await runReconciliation(
      { now, ...dependencies.policy },
      {
        selectDuePendingJobs: async (selection) => {
          const claimedJobs =
            await dependencies.claimDueJobsAtomically(selection);
          return claimedJobs.map((job) => ({ ...job, stripeChargeId: null }));
        },
        loadOrderStripeChargeId: dependencies.loadOrderStripeChargeId,
        reportJobError: dependencies.reportJobError,
        retrieveCharge: dependencies.retrieveCharge,
        retrieveBalanceTransaction: dependencies.retrieveBalanceTransaction,
        persistFeeAndMarkSucceeded:
          dependencies.persistFeeAndMarkSucceededAtomically,
        scheduleRetry: dependencies.scheduleRetryAtomically,
        markFailed: dependencies.markFailedAtomically,
      },
    );

    return Response.json(result);
  };

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Validates the intended future scalar RPC response; malformed data is never success. */
export const requireMutationResult = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('INVALID_FEE_MUTATION_RESPONSE');
  return value;
};

/** Rejects malformed claimed rows before invoking Stripe or any mutation. */
export const parseClaimedFeeJobs = (value: unknown): ClaimedStripeFeeJob[] => {
  if (!Array.isArray(value)) throw new Error('INVALID_FEE_CLAIM_RESPONSE');
  return value.map((row: unknown) => {
    if (typeof row !== 'object' || row === null || !('id' in row) || !isUuid(row.id)
      || !('order_id' in row) || !isUuid(row.order_id)
      || !('stripe_payment_intent_id' in row) || typeof row.stripe_payment_intent_id !== 'string'
      || row.stripe_payment_intent_id.length < 1 || row.stripe_payment_intent_id.length > 255
      || !('claim_token' in row) || !isUuid(row.claim_token)
      || !('claim_expires_at' in row) || typeof row.claim_expires_at !== 'string'
      || !Number.isFinite(Date.parse(row.claim_expires_at))
      || !('status' in row) || row.status !== 'processing'
      || !('attempt_count' in row) || typeof row.attempt_count !== 'number'
      || !Number.isInteger(row.attempt_count) || row.attempt_count < 1 || row.attempt_count > 100) {
      throw new Error('INVALID_FEE_CLAIM_RESPONSE');
    }
    return {
      id: row.id, orderId: row.order_id, stripePaymentIntentId: row.stripe_payment_intent_id,
      claimToken: row.claim_token, attemptCount: row.attempt_count - 1,
    };
  });
};

type EdgeRuntime = {
  env: {
    get: (name: string) => string | undefined;
  };
};

const denoRuntime = (globalThis as typeof globalThis & { Deno?: EdgeRuntime })
  .Deno;

if (denoRuntime) {
  const [{ serve }, { createClient }, { default: Stripe }] = await Promise.all([
    import('https://deno.land/std@0.168.0/http/server.ts'),
    import('https://esm.sh/@supabase/supabase-js@2.39.3'),
    import('https://esm.sh/stripe@17.0.0'),
  ]);

  const workerBearerSecret = denoRuntime.env
    .get(WORKER_BEARER_SECRET_ENV)
    ?.trim();
  const supabaseUrl = denoRuntime.env.get('SUPABASE_URL')?.trim();
  const serviceRoleKey = denoRuntime.env
    .get('SUPABASE_SERVICE_ROLE_KEY')
    ?.trim();
  const stripeSecret = denoRuntime.env.get('STRIPE_SECRET_KEY')?.trim();

  const productionHandler =
    supabaseUrl && serviceRoleKey && stripeSecret
      ? (() => {
          const supabase = createClient<FeeWorkerDatabase>(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          });
          const stripe = new Stripe(stripeSecret, {
            apiVersion: STRIPE_API_VERSION,
            httpClient: Stripe.createFetchHttpClient(),
          });

          const transitionJob = async (
            args: TransitionJobArgs,
          ): Promise<boolean> => {
            const { data, error } = await supabase.rpc(
              'fn_transition_stripe_fee_reconciliation_job_leased',
              args,
            );
            if (error) {
              throw new Error(
                'STRIPE_FEE_RECONCILIATION_TRANSITION_FAILED',
              );
            }
            return requireMutationResult(data);
          };

          return createReconcileStripeFeesHandler({
            workerServiceRoleJwt: workerBearerSecret,
            now: () => new Date().toISOString(),
            policy: PRODUCTION_POLICY,
            reportJobError: (error) => console.error('stripe_fee_job_error', error),
            claimDueJobsAtomically: async (selection) => {
              const args = {
                p_limit: selection.limit,
                p_max_attempts: PRODUCTION_POLICY.maxAttempts,
              };
              const { data, error } = await supabase.rpc(
                'fn_claim_stripe_fee_reconciliation_jobs_leased',
                args,
              );
              if (error) {
                throw new Error(
                  'STRIPE_FEE_RECONCILIATION_CLAIM_FAILED',
                );
              }

              return parseClaimedFeeJobs(data);
            },
            loadOrderStripeChargeId: async ({ orderId }) => {
              const { data, error } = await supabase
                .from('orders')
                .select('stripe_charge_id')
                .eq('id', orderId)
                .maybeSingle();
              if (error) {
                throw new Error(
                  'ORDER_STRIPE_CHARGE_LOOKUP_FAILED',
                );
              }

              return data?.stripe_charge_id ?? null;
            },
            retrieveCharge: async (chargeId) => {
              const charge = await stripe.charges.retrieve(chargeId);
              const balanceTransaction = charge.balance_transaction;

              return {
                id: charge.id,
                balanceTransactionId:
                  typeof balanceTransaction === 'string'
                    ? balanceTransaction
                    : (balanceTransaction?.id ?? null),
              };
            },
            retrieveBalanceTransaction: async (balanceTransactionId) => {
              const balanceTransaction =
                await stripe.balanceTransactions.retrieve(balanceTransactionId);

              return {
                id: balanceTransaction.id,
                fee: balanceTransaction.fee,
              };
            },
            persistFeeAndMarkSucceededAtomically: async (completion) => {
              const args: CompleteJobArgs = {
                p_job_id: completion.jobId,
                p_claim_token: completion.claimToken,
                p_actual_stripe_fee_cents: completion.actualStripeFeeCents,
                p_reconciled_at: completion.reconciledAt,
              };
              const { data, error } = await supabase.rpc(
                'fn_complete_stripe_fee_reconciliation_job_leased',
                args,
              );
              if (error) {
                throw new Error(
                  'STRIPE_FEE_RECONCILIATION_COMPLETION_FAILED',
                );
              }
              return requireMutationResult(data);
            },
            scheduleRetryAtomically: async (retry) => {
              return transitionJob({
                p_job_id: retry.jobId,
                p_claim_token: retry.claimToken,
                p_outcome: 'retry',
                p_next_retry_at: retry.nextRetryAt,
                p_last_error: retry.lastError,
              });
            },
            markFailedAtomically: async (failure) => {
              return transitionJob({
                p_job_id: failure.jobId,
                p_claim_token: failure.claimToken,
                p_outcome: 'failed',
                p_last_error: failure.lastError,
              });
            },
          });
        })()
      : null;

  serve((request: Request) => {
    if (
      !workerBearerSecret ||
      request.headers.get('authorization') !== `Bearer ${workerBearerSecret}`
    ) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (!productionHandler) {
      return new Response('Server configuration unavailable', { status: 500 });
    }

    return productionHandler(request);
  });
}
