/**
 * Pure evaluation of pg_cron health for the cron-watchdog Edge Function.
 * See odd/tasks/sentry-observability.md (L12).
 */

export interface CronHealthRow {
  jobname: string;
  schedule: string;
  active: boolean;
  last_start: string | null;
  last_status: string | null;
  /** Time of the job's newest failed HTTP response (pg_net), if any. */
  last_http_failed_at: string | null;
  /** 'HTTP <code>', 'timed out', or the pg_net error message. */
  last_http_error: string | null;
}

export type CronUnhealthyReason =
  'failed' | 'http-failed' | 'overdue' | 'unsupported-schedule';

export type CronUnhealthyJob =
  | {
      jobname: string;
      reason: Exclude<CronUnhealthyReason, 'http-failed'>;
    }
  | {
      jobname: string;
      reason: 'http-failed';
      httpError: string | null;
      httpFailedAt: string;
    };

const MINUTE_MS = 60_000;
const GRACE_MINUTES = 5;
/** The watchdog's own schedule (`*\/15 * * * *`, see index.ts). */
const WATCHDOG_INTERVAL_MINUTES = 15;
/**
 * An HTTP failure is reported when it happened within the last watchdog
 * interval plus the grace, so a late watchdog run does not miss it and a single
 * old failure does not alarm forever (at most one extra report, grouped by
 * fingerprint).
 */
const HTTP_FAILURE_WINDOW_MINUTES = WATCHDOG_INTERVAL_MINUTES + GRACE_MINUTES;

/** Interval in minutes for the supported schedule shapes, or null when unsupported. */
const intervalMinutes = (schedule: string): number | null => {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') return null;

  // */N * * * *
  const everyN = minute.match(/^\*\/(\d{1,2})$/);
  if (everyN && hour === '*') {
    const n = Number(everyN[1]);
    return n >= 1 && n <= 59 ? n : null;
  }

  const fixedMinute = minute.match(/^\d{1,2}$/) && Number(minute) <= 59;
  if (!fixedMinute) return null;

  // M * * * *
  if (hour === '*') return 60;
  // M */N * * *
  const everyNHours = hour.match(/^\*\/(\d{1,2})$/);
  if (everyNHours) {
    const n = Number(everyNHours[1]);
    return n >= 1 && n <= 23 ? n * 60 : null;
  }
  // M H * * *
  if (hour.match(/^\d{1,2}$/) && Number(hour) <= 23) return 24 * 60;
  return null;
};

/** True when the watchdog can work out the interval of a pg_cron schedule. */
export const isSupportedSchedule = (schedule: string): boolean =>
  intervalMinutes(schedule) !== null;

const classify = (row: CronHealthRow, now: Date): CronUnhealthyJob | null => {
  const { jobname } = row;
  if (row.last_status === 'failed') return { jobname, reason: 'failed' };

  if (
    row.last_http_failed_at &&
    now.getTime() - new Date(row.last_http_failed_at).getTime() <=
      HTTP_FAILURE_WINDOW_MINUTES * MINUTE_MS
  ) {
    return {
      jobname,
      reason: 'http-failed',
      httpError: row.last_http_error,
      httpFailedAt: row.last_http_failed_at,
    };
  }

  const interval = intervalMinutes(row.schedule);
  if (interval === null) return { jobname, reason: 'unsupported-schedule' };

  if (!row.last_start) return { jobname, reason: 'overdue' };
  const thresholdMs = (2 * interval + GRACE_MINUTES) * MINUTE_MS;
  return now.getTime() - new Date(row.last_start).getTime() > thresholdMs
    ? { jobname, reason: 'overdue' }
    : null;
};

/**
 * Lists the active jobs whose latest run failed, whose newest HTTP failure is
 * within HTTP_FAILURE_WINDOW_MINUTES, that did not run within 2x their schedule
 * interval + 5 minutes (or never ran), or whose schedule the watchdog cannot
 * interpret. One reason per job, in that order, ordered by jobname.
 */
export function evaluateCronHealth(
  rows: CronHealthRow[],
  now: Date,
): CronUnhealthyJob[] {
  return rows
    .filter((row) => row.active)
    .flatMap((row) => {
      const job = classify(row, now);
      return job ? [job] : [];
    })
    .sort((a, b) =>
      a.jobname < b.jobname ? -1 : a.jobname > b.jobname ? 1 : 0,
    );
}
