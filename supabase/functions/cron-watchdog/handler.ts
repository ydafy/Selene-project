/**
 * Testable core of the cron-watchdog Edge Function (dependencies injected).
 * See odd/tasks/sentry-observability.md (L12).
 */
import { evaluateCronHealth, type CronHealthRow } from './health.ts';

export interface CronWatchdogDeps {
  getCronSecret: () => string | undefined;
  now: () => Date;
  fetchCronHealth: () => Promise<{
    data: CronHealthRow[] | null;
    error: { message: string } | null;
  }>;
  reportMessage: (
    message: string,
    options: { fingerprint: string[]; tags: Record<string, string> },
  ) => Promise<void>;
  /** Runs the authenticated check inside the Sentry Cron Monitor. */
  runMonitored: <T>(fn: () => Promise<T>) => Promise<T>;
  log: (message: string) => void;
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function createCronWatchdogHandler(deps: CronWatchdogDeps) {
  const check = async (): Promise<Response> => {
    const { data, error } = await deps.fetchCronHealth();
    if (error || !data) {
      // The database error text is not forwarded to the caller.
      throw new Error('CRON_HEALTH_RPC_FAILED');
    }

    const unhealthy = evaluateCronHealth(data, deps.now());
    for (const { jobname, reason } of unhealthy) {
      await deps.reportMessage(`cron ${jobname} ${reason}`, {
        fingerprint: ['cron-unhealthy', jobname, reason],
        tags: { 'cron.job': jobname, 'cron.reason': reason },
      });
    }
    return json({ checked: data.length, unhealthy }, 200);
  };

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
      return await deps.runMonitored(check);
    } catch (error) {
      deps.log(`cron-watchdog failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
