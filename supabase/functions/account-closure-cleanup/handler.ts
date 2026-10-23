/**
 * @file supabase/functions/account-closure-cleanup/handler.ts
 *
 * Cron retry of the Stripe and Storage cleanup of closed accounts (auth-hardening S8).
 * `delete-account` runs the cleanup once right after the closure; this worker finishes
 * the rows where a step is still `pending` (the request died after the RPC committed) or
 * `failed`. It runs without a user session: after closure the user's token is dead.
 *
 * Authenticated by the `x-cron-secret` header, like cron-watchdog. Each run claims a
 * bounded batch through `fn_claim_account_closures`, which adds the attempt in the same
 * statement, so concurrent runs cannot double-claim or undercount.
 *
 * Responses:
 *   200 { claimed, completed, failed, invalid, capped: [{ user_id, attempts }] }
 *   401 { error: 'CRON_UNAUTHORIZED' }   missing or wrong secret
 *   405 { error: 'METHOD_NOT_ALLOWED' }
 *   500 { error: 'INTERNAL_ERROR' }      the claim failed (reported to Sentry as a 5xx)
 */
import {
  asRecord,
  parseClosureCleanup,
  runClosureCleanup,
  safeErrorCode,
  type ClosureCleanupPorts,
} from '../_shared/account-closure-cleanup.ts';

/** Rows per run. Steps run one after another, so this keeps a run far below the function time limit. */
export const BATCH_SIZE = 20;
/**
 * A row touched in the last 10 minutes is left alone: a live delete-account request
 * finishes within the function time limit (150 s) and every step it records moves `updated_at`.
 */
export const MIN_IDLE_SECONDS = 10 * 60;
/**
 * Attempts before giving up, counting the one from delete-account. With an hourly schedule
 * this is about a day of retries: it outlasts a Stripe or Storage outage, while a failure
 * that survives a day is deterministic (for example a Connect balance that needs an admin)
 * and more retries would only hit the APIs again. Capped rows are reported on every run.
 */
export const MAX_ATTEMPTS = 24;
/** Capped rows listed per run, enough for an admin to act on. */
const CAPPED_LIST_LIMIT = 50;

type DbError = { code?: string; message: string } | null;

export type CappedClosure = { user_id: string; attempts: number };

export type AccountClosureCleanupDeps = ClosureCleanupPorts & {
  getCronSecret: () => string | undefined;
  /** Atomically claims open closures and adds one attempt to each. */
  claimClosures: (
    limit: number,
    minIdleSeconds: number,
    maxAttempts: number,
  ) => Promise<{ data: Record<string, unknown>[] | null; error: DbError }>;
  /** Closures with an open step that reached the attempt cap, oldest first. */
  listCappedClosures: (
    maxAttempts: number,
    limit: number,
  ) => Promise<{ data: CappedClosure[] | null; error: DbError }>;
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function createAccountClosureCleanupHandler(deps: AccountClosureCleanupDeps) {
  async function cleanRow(
    row: Record<string, unknown>,
  ): Promise<'completed' | 'failed' | 'invalid'> {
    const userId = row.user_id;
    const closure = parseClosureCleanup(row);
    if (typeof userId !== 'string' || !closure) {
      deps.log('ERROR', 'Account closure row has an unusable shape');
      return 'invalid';
    }
    try {
      // The claim already counted this attempt.
      const { failures } = await runClosureCleanup(userId, closure, deps, { countAttempt: false });
      return failures.length === 0 ? 'completed' : 'failed';
    } catch (error: unknown) {
      deps.log('ERROR', 'Account closure cleanup crashed', { userId, code: safeErrorCode(error) });
      return 'failed';
    }
  }

  async function reportCapped(): Promise<CappedClosure[]> {
    const { data, error } = await deps.listCappedClosures(MAX_ATTEMPTS, CAPPED_LIST_LIMIT);
    if (error || !data) {
      deps.log('ERROR', 'Capped account closures could not be listed', { code: error?.code });
      return [];
    }
    const capped = data.flatMap((entry) => {
      const record = asRecord(entry);
      return typeof record?.user_id === 'string' && typeof record.attempts === 'number'
        ? [{ user_id: record.user_id, attempts: record.attempts }]
        : [];
    });
    if (capped.length > 0) {
      deps.log('ERROR', 'Account closure cleanup gave up', {
        count: capped.length,
        userIds: capped.map((entry) => entry.user_id),
      });
    }
    return capped;
  }

  return async (req: Request): Promise<Response> => {
    const expected = deps.getCronSecret();
    const supplied = req.headers.get('x-cron-secret');
    if (!expected || supplied !== expected) {
      return json({ error: 'CRON_UNAUTHORIZED' }, 401);
    }
    if (req.method !== 'POST') {
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }

    try {
      const { data, error } = await deps.claimClosures(BATCH_SIZE, MIN_IDLE_SECONDS, MAX_ATTEMPTS);
      if (error || !data) {
        // The database error text is not forwarded or logged.
        deps.log('ERROR', 'Account closure claim failed', { code: error?.code });
        return json({ error: 'INTERNAL_ERROR' }, 500);
      }

      const summary = { claimed: data.length, completed: 0, failed: 0, invalid: 0 };
      for (const row of data) summary[await cleanRow(row)] += 1;

      const capped = await reportCapped();
      deps.log('INFO', 'Account closure cleanup run finished', { ...summary, capped: capped.length });
      return json({ ...summary, capped }, 200);
    } catch (error: unknown) {
      deps.log('ERROR', 'Account closure cleanup run crashed', { code: safeErrorCode(error) });
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
