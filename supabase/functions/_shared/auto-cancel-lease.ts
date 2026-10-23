/**
 * Expiring run lease for the auto-cancel crons (B3.1, odd/tasks/shipment-cancellations-b3.md).
 * Replaces the global `*_running` booleans, which stayed true forever after a killed run.
 * The lease expires in the database after 600 seconds; the run budget below stops starting
 * new shipments well before any Edge Function wall clock, so the run can release cleanly and
 * the remaining shipments wait for the next hourly run.
 */

export type AutoCancelJob = 'orders' | 'preparing';

/** Time after which a run starts no new shipment cancellation. */
export const AUTO_CANCEL_RUN_BUDGET_MS = 100_000;

type RpcResult = { data: unknown; error: unknown };

export interface AutoCancelLeaseClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
}

export type AutoCancelLeaseLog = (
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  msg: string,
  data?: Record<string, unknown>,
) => void;

export type AutoCancelLease =
  | { acquired: true; leaseId: string; budgetExceeded: () => boolean }
  | { acquired: false; response: Response };

const errorField = (error: unknown, field: 'code' | 'message'): string | undefined => {
  if (error && typeof error === 'object' && field in error) {
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
};

/**
 * Acquires the job lease. Returns the ready-made 200 `Already running` response when another
 * run holds it, and throws `AUTO_CANCEL_LEASE_UNAVAILABLE` (no work done) when the lease
 * cannot be read.
 */
export async function acquireAutoCancelLease(
  client: AutoCancelLeaseClient,
  job: AutoCancelJob,
  log: AutoCancelLeaseLog,
  now: () => number = Date.now,
): Promise<AutoCancelLease> {
  const { data, error } = await client.rpc('fn_acquire_auto_cancel_lease', { p_job: job });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { acquired?: unknown; lease_id?: unknown }
    | null
    | undefined;

  if (error || !row || (row.acquired === true && typeof row.lease_id !== 'string')) {
    log('ERROR', 'Auto-cancel lease could not be acquired', {
      job,
      code: errorField(error, 'code') ?? 'INVALID_LEASE_RESPONSE',
      error: errorField(error, 'message') ?? 'INVALID_LEASE_RESPONSE',
    });
    throw new Error('AUTO_CANCEL_LEASE_UNAVAILABLE');
  }

  if (row.acquired !== true) {
    log('WARN', 'Auto-cancel lease held by another run; skipping', { job });
    return {
      acquired: false,
      response: new Response(JSON.stringify({ message: 'Already running' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  const startedAt = now();
  return {
    acquired: true,
    leaseId: row.lease_id as string,
    budgetExceeded: () => now() - startedAt >= AUTO_CANCEL_RUN_BUDGET_MS,
  };
}

/** Releases the lease held by this run. Never throws: an unreleased lease expires on its own. */
export async function releaseAutoCancelLease(
  client: AutoCancelLeaseClient,
  job: AutoCancelJob,
  leaseId: string | undefined,
  log: AutoCancelLeaseLog,
): Promise<void> {
  if (!leaseId) return;
  let reason: string | undefined;
  try {
    const { data, error } = await client.rpc('fn_release_auto_cancel_lease', {
      p_job: job,
      p_lease_id: leaseId,
    });
    if (error) reason = errorField(error, 'code') ?? errorField(error, 'message') ?? 'RELEASE_FAILED';
    else if (data !== true) reason = 'NOT_HOLDER';
  } catch (error) {
    reason = error instanceof Error ? error.message : 'RELEASE_FAILED';
  }
  if (reason) {
    log('WARN', 'Auto-cancel lease not released; it expires on its own', { job, leaseId, reason });
  }
}
