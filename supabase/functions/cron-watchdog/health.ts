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
}

export type CronUnhealthyReason = 'failed' | 'overdue' | 'unsupported-schedule';

export interface CronUnhealthyJob {
  jobname: string;
  reason: CronUnhealthyReason;
}

const MINUTE_MS = 60_000;
const GRACE_MINUTES = 5;

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

const classify = (row: CronHealthRow, now: Date): CronUnhealthyReason | null => {
  if (row.last_status === 'failed') return 'failed';

  const interval = intervalMinutes(row.schedule);
  if (interval === null) return 'unsupported-schedule';

  if (!row.last_start) return 'overdue';
  const thresholdMs = (2 * interval + GRACE_MINUTES) * MINUTE_MS;
  return now.getTime() - new Date(row.last_start).getTime() > thresholdMs ? 'overdue' : null;
};

/**
 * Lists the active jobs whose latest run failed, that did not run within
 * 2x their schedule interval + 5 minutes (or never ran), or whose schedule the
 * watchdog cannot interpret. One reason per job, ordered by jobname.
 */
export function evaluateCronHealth(rows: CronHealthRow[], now: Date): CronUnhealthyJob[] {
  return rows
    .filter((row) => row.active)
    .flatMap((row) => {
      const reason = classify(row, now);
      return reason ? [{ jobname: row.jobname, reason }] : [];
    })
    .sort((a, b) => (a.jobname < b.jobname ? -1 : a.jobname > b.jobname ? 1 : 0));
}
