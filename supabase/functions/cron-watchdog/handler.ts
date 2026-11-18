/**
 * Testable core of the cron-watchdog Edge Function (dependencies injected).
 * See odd/tasks/sentry-observability.md (L12).
 */
import {
  type CronMismatchReporter,
  isAuthorizedCronRequest,
  reportCronSecretMismatch,
} from '../_shared/auth/cron-auth.ts';
import {
  evaluateCronHealth,
  type CronHealthRow,
  type CronUnhealthyJob,
} from './health.ts';

/** One `internal.ops_failures` row, as `fn_list_ops_failures` returns it. */
export interface OpsFailureRow {
  id: number;
  source: string;
  code: string;
  context: unknown;
  occurred_at: string;
}

/** One Sentry error event for one ops failure. */
export interface OpsFailureEvent {
  message: string;
  fingerprint: string[];
  tags: Record<string, string>;
  extra: Record<string, unknown>;
}

type OpsFailuresOutcome =
  | { reported: number; deleted: number; kept: number }
  | {
      error:
        | 'OPS_FAILURES_LIST_FAILED'
        | 'OPS_FAILURES_NOT_DELIVERED'
        | 'OPS_FAILURES_DELETE_FAILED';
    };

/**
 * At most this many failures per run; the rest wait for the next run (every
 * 15 minutes). The reporter sends them in chunks of 10 and waits up to 2 s for
 * each chunk, so a run stays well inside the job's 30 s pg_net timeout.
 */
export const OPS_FAILURES_BATCH = 25;

export interface CronWatchdogDeps {
  getCronSecret: () => string | undefined;
  now: () => Date;
  fetchCronHealth: () => Promise<{
    data: CronHealthRow[] | null;
    error: { message: string } | null;
  }>;
  // Sentry message reporter (`reportMessage` from `_shared/sentry.ts`).
  reportMessage: CronMismatchReporter;
  /** The oldest `internal.ops_failures` rows (`fn_list_ops_failures`). */
  listOpsFailures: (limit: number) => Promise<{
    data: OpsFailureRow[] | null;
    error: { message: string } | null;
  }>;
  /**
   * Sends the events to Sentry and resolves one flag per event: true only when
   * Sentry acknowledged it with a 2xx (`reportMessagesDelivered`).
   */
  reportOpsFailures: (events: OpsFailureEvent[]) => Promise<boolean[]>;
  /** Deletes exactly these ids (`fn_delete_ops_failures`); data is the count. */
  deleteOpsFailures: (ids: number[]) => Promise<{
    data: number | null;
    error: { message: string } | null;
  }>;
  /** Runs the authenticated check inside the Sentry Cron Monitor. */
  runMonitored: <T>(fn: () => Promise<T>) => Promise<T>;
  log: (message: string) => void;
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// pg_net error text is external; never forward a URL (it may carry a host or a query secret).
const withoutUrls = (text: string): string =>
  text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]');

const sentryMessage = (job: CronUnhealthyJob): string =>
  job.reason === 'http-failed'
    ? `cron ${job.jobname} http-failed: ${withoutUrls(job.httpError ?? 'unknown error')} at ${job.httpFailedAt}`
    : `cron ${job.jobname} ${job.reason}`;

const opsFailureEvent = (row: OpsFailureRow): OpsFailureEvent => ({
  message: `ops failure: ${row.source} ${row.code}`,
  // One Sentry issue per source and code, however often it repeats.
  fingerprint: ['ops-failure', row.source, row.code],
  tags: { 'ops.source': row.source, 'ops.code': row.code },
  extra: {
    ops_failure_id: row.id,
    context: row.context,
    occurred_at: row.occurred_at,
  },
});

const WATCHDOG_TAGS = { edge_function: 'cron-watchdog' };

export function createCronWatchdogHandler(deps: CronWatchdogDeps) {
  /**
   * Reports the oldest ops failures to Sentry and deletes only the rows whose
   * events Sentry acknowledged. Never throws: a failure here must not fail the health report.
   * A crash between the report and the delete reports those rows again on the
   * next run, into the same Sentry issue (fingerprint).
   */
  const reportWatchdogProblem = async (
    message: string,
    fingerprint: string,
  ): Promise<void> => {
    try {
      await deps.reportMessage(message, {
        fingerprint: [fingerprint],
        tags: WATCHDOG_TAGS,
      });
    } catch {
      // Reporting must not fail the health report.
    }
  };

  const drainOpsFailures = async (): Promise<OpsFailuresOutcome> => {
    let rows: OpsFailureRow[];
    try {
      const { data, error } = await deps.listOpsFailures(OPS_FAILURES_BATCH);
      if (error || !data) throw new Error('OPS_FAILURES_LIST_FAILED');
      rows = data;
    } catch {
      // The database error text is not forwarded.
      await reportWatchdogProblem(
        'cron-watchdog could not list ops failures',
        'ops-failures-list-failed',
      );
      return { error: 'OPS_FAILURES_LIST_FAILED' };
    }
    if (rows.length === 0) return { reported: 0, deleted: 0, kept: 0 };

    let delivered: boolean[] = [];
    try {
      delivered = await deps.reportOpsFailures(rows.map(opsFailureEvent));
    } catch {
      delivered = [];
    }
    // Only an explicit true counts; a missing flag keeps the row.
    const acknowledged = rows.filter((_, i) => delivered[i] === true);
    const kept = rows.length - acknowledged.length;
    if (kept > 0) {
      // Sentry did not take these, so this goes to the function log only.
      deps.log(
        `cron-watchdog: Sentry did not acknowledge ${kept} of ${rows.length} ops failures; kept for the next run`,
      );
    }
    if (acknowledged.length === 0)
      return { error: 'OPS_FAILURES_NOT_DELIVERED' };

    try {
      const { data, error } = await deps.deleteOpsFailures(
        acknowledged.map((row) => row.id),
      );
      if (error || data === null) throw new Error('OPS_FAILURES_DELETE_FAILED');
      return { reported: acknowledged.length, deleted: data, kept };
    } catch {
      await reportWatchdogProblem(
        'cron-watchdog could not delete reported ops failures',
        'ops-failures-delete-failed',
      );
      return { error: 'OPS_FAILURES_DELETE_FAILED' };
    }
  };

  const check = async (): Promise<Response> => {
    const { data, error } = await deps.fetchCronHealth();
    if (error || !data) {
      // The database error text is not forwarded to the caller.
      throw new Error('CRON_HEALTH_RPC_FAILED');
    }

    const unhealthy = evaluateCronHealth(data, deps.now());
    for (const job of unhealthy) {
      const { jobname, reason } = job;
      await deps.reportMessage(sentryMessage(job), {
        fingerprint: ['cron-unhealthy', jobname, reason],
        tags: { 'cron.job': jobname, 'cron.reason': reason },
      });
    }
    const opsFailures = await drainOpsFailures();
    // The response lists only names, reasons, counts and codes, never error text.
    return json(
      {
        checked: data.length,
        unhealthy: unhealthy.map(({ jobname, reason }) => ({
          jobname,
          reason,
        })),
        opsFailures,
      },
      200,
    );
  };

  return async (req: Request): Promise<Response> => {
    if (!isAuthorizedCronRequest(req, deps.getCronSecret())) {
      await reportCronSecretMismatch(req, 'cron-watchdog', deps.reportMessage);
      return json({ error: 'CRON_UNAUTHORIZED' }, 401);
    }
    if (req.method !== 'POST') {
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }

    try {
      return await deps.runMonitored(check);
    } catch (error) {
      deps.log(
        `cron-watchdog failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
