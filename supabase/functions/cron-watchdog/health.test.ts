import { describe, expect, it } from 'bun:test';

import {
  evaluateCronHealth,
  isSupportedSchedule,
  type CronHealthRow,
} from './health';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const minutesAgo = (minutes: number): string =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

const row = (overrides: Partial<CronHealthRow> = {}): CronHealthRow => ({
  jobname: 'job',
  schedule: '*/5 * * * *',
  active: true,
  last_start: minutesAgo(1),
  last_status: 'succeeded',
  last_http_failed_at: null,
  last_http_error: null,
  ...overrides,
});

// threshold = 2 x interval + 5 minutes
const THRESHOLDS: Array<[string, string, number]> = [
  ['every 5 minutes', '*/5 * * * *', 15],
  ['hourly', '0 * * * *', 125],
  ['every 6 hours', '0 */6 * * *', 725],
  ['daily', '0 0 * * *', 2885],
];

describe('evaluateCronHealth', () => {
  it('returns nothing for healthy rows', () => {
    expect(
      evaluateCronHealth(
        [row(), row({ jobname: 'b', schedule: '0 0 * * *' })],
        NOW,
      ),
    ).toEqual([]);
  });

  it('flags a job whose latest run failed', () => {
    expect(
      evaluateCronHealth([row({ jobname: 'a', last_status: 'failed' })], NOW),
    ).toEqual([{ jobname: 'a', reason: 'failed' }]);
  });

  it('does not treat running or starting runs as failures', () => {
    expect(
      evaluateCronHealth(
        [row({ last_status: 'running' }), row({ last_status: 'starting' })],
        NOW,
      ),
    ).toEqual([]);
  });

  describe.each(THRESHOLDS)('%s (%s)', (_, schedule, thresholdMinutes) => {
    it('is healthy exactly at the threshold', () => {
      const rows = [
        row({ schedule, last_start: minutesAgo(thresholdMinutes) }),
      ];
      expect(evaluateCronHealth(rows, NOW)).toEqual([]);
    });

    it('is overdue one minute after the threshold', () => {
      const rows = [
        row({
          jobname: 'late',
          schedule,
          last_start: minutesAgo(thresholdMinutes + 1),
        }),
      ];
      expect(evaluateCronHealth(rows, NOW)).toEqual([
        { jobname: 'late', reason: 'overdue' },
      ]);
    });
  });

  it('flags a job that never ran as overdue', () => {
    const rows = [row({ jobname: 'new', last_start: null, last_status: null })];
    expect(evaluateCronHealth(rows, NOW)).toEqual([
      { jobname: 'new', reason: 'overdue' },
    ]);
  });

  it('skips inactive jobs even when failed, overdue or never run', () => {
    const rows = [
      row({ jobname: 'a', active: false, last_status: 'failed' }),
      row({ jobname: 'b', active: false, last_start: minutesAgo(10_000) }),
      row({ jobname: 'c', active: false, last_start: null, last_status: null }),
      row({ jobname: 'd', active: false, schedule: '0 9 * * 1' }),
      row({
        jobname: 'e',
        active: false,
        last_http_failed_at: minutesAgo(1),
        last_http_error: 'HTTP 500',
      }),
    ];
    expect(evaluateCronHealth(rows, NOW)).toEqual([]);
  });

  it('flags unsupported schedules', () => {
    expect(
      evaluateCronHealth(
        [row({ jobname: 'weekly', schedule: '0 9 * * 1' })],
        NOW,
      ),
    ).toEqual([{ jobname: 'weekly', reason: 'unsupported-schedule' }]);
  });

  it('reports a single reason per job, failed first', () => {
    const rows = [
      row({
        jobname: 'a',
        last_status: 'failed',
        last_start: minutesAgo(10_000),
      }),
    ];
    expect(evaluateCronHealth(rows, NOW)).toEqual([
      { jobname: 'a', reason: 'failed' },
    ]);
  });

  describe('http-failed', () => {
    // Window = watchdog interval (15 min) + 5 min grace.
    it('flags a job whose latest HTTP failure happened within the window', () => {
      const rows = [
        row({
          jobname: 'web',
          last_http_failed_at: minutesAgo(3),
          last_http_error: 'HTTP 503',
        }),
      ];
      expect(evaluateCronHealth(rows, NOW)).toEqual([
        {
          jobname: 'web',
          reason: 'http-failed',
          httpError: 'HTTP 503',
          httpFailedAt: minutesAgo(3),
        },
      ]);
    });

    it('still flags the failure exactly at the window edge', () => {
      const rows = [
        row({
          jobname: 'edge',
          last_http_failed_at: minutesAgo(20),
          last_http_error: 'timed out',
        }),
      ];
      expect(evaluateCronHealth(rows, NOW)).toEqual([
        {
          jobname: 'edge',
          reason: 'http-failed',
          httpError: 'timed out',
          httpFailedAt: minutesAgo(20),
        },
      ]);
    });

    it('does not alarm again for a failure older than the window', () => {
      const rows = [
        row({
          last_http_failed_at: minutesAgo(21),
          last_http_error: 'HTTP 500',
        }),
      ];
      expect(evaluateCronHealth(rows, NOW)).toEqual([]);
    });

    it('reports failed instead of http-failed when the latest run failed too', () => {
      const rows = [
        row({
          jobname: 'a',
          last_status: 'failed',
          last_http_failed_at: minutesAgo(1),
          last_http_error: 'HTTP 500',
        }),
      ];
      expect(evaluateCronHealth(rows, NOW)).toEqual([
        { jobname: 'a', reason: 'failed' },
      ]);
    });
  });

  it.each([
    ['failed', { last_status: 'failed' }],
    ['overdue', { last_start: minutesAgo(16) }],
    ['unsupported-schedule', { schedule: '0 9 * * 1' }],
  ] as const)(
    'keeps reporting %s when the job also has an old HTTP failure',
    (reason, overrides) => {
      const rows = [
        row({
          jobname: 'old-http',
          last_http_failed_at: minutesAgo(60),
          last_http_error: 'HTTP 500',
          ...overrides,
        }),
      ];
      expect(evaluateCronHealth(rows, NOW)).toEqual([
        { jobname: 'old-http', reason },
      ]);
    },
  );

  it('orders the output by jobname regardless of input order', () => {
    const rows = [
      row({ jobname: 'zeta', last_status: 'failed' }),
      row({ jobname: 'alpha', last_status: 'failed' }),
      row({ jobname: 'mid', schedule: '0 9 * * 1' }),
    ];
    expect(evaluateCronHealth(rows, NOW).map((entry) => entry.jobname)).toEqual(
      ['alpha', 'mid', 'zeta'],
    );
  });

  it('does not mutate its input', () => {
    const rows = [row({ jobname: 'b' }), row({ jobname: 'a' })];
    evaluateCronHealth(rows, NOW);
    expect(rows.map((r) => r.jobname)).toEqual(['b', 'a']);
  });
});

describe('isSupportedSchedule', () => {
  it('accepts every-N-minutes, hourly, every-N-hours and daily schedules', () => {
    for (const schedule of [
      '*/1 * * * *',
      '*/15 * * * *',
      '30 * * * *',
      '0 */6 * * *',
      '0 3 * * *',
    ]) {
      expect(isSupportedSchedule(schedule)).toBe(true);
    }
  });

  it('rejects schedules the watchdog cannot interpret', () => {
    for (const schedule of [
      '0 9 * * 1',
      '0 0 1 * *',
      '*/0 * * * *',
      '*/5 */2 * * *',
      '60 * * * *',
      '0 * * *',
      '1 minute',
    ]) {
      expect(isSupportedSchedule(schedule)).toBe(false);
    }
  });
});
