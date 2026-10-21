import { describe, expect, it } from 'bun:test';

import { evaluateCronHealth, type CronHealthRow } from './health';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const minutesAgo = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const row = (overrides: Partial<CronHealthRow> = {}): CronHealthRow => ({
  jobname: 'job',
  schedule: '*/5 * * * *',
  active: true,
  last_start: minutesAgo(1),
  last_status: 'succeeded',
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
    expect(evaluateCronHealth([row(), row({ jobname: 'b', schedule: '0 0 * * *' })], NOW)).toEqual([]);
  });

  it('flags a job whose latest run failed', () => {
    expect(evaluateCronHealth([row({ jobname: 'a', last_status: 'failed' })], NOW)).toEqual([
      { jobname: 'a', reason: 'failed' },
    ]);
  });

  it('does not treat running or starting runs as failures', () => {
    expect(evaluateCronHealth([row({ last_status: 'running' }), row({ last_status: 'starting' })], NOW)).toEqual([]);
  });

  describe.each(THRESHOLDS)('%s (%s)', (_, schedule, thresholdMinutes) => {
    it('is healthy exactly at the threshold', () => {
      const rows = [row({ schedule, last_start: minutesAgo(thresholdMinutes) })];
      expect(evaluateCronHealth(rows, NOW)).toEqual([]);
    });

    it('is overdue one minute after the threshold', () => {
      const rows = [row({ jobname: 'late', schedule, last_start: minutesAgo(thresholdMinutes + 1) })];
      expect(evaluateCronHealth(rows, NOW)).toEqual([{ jobname: 'late', reason: 'overdue' }]);
    });
  });

  it('flags a job that never ran as overdue', () => {
    const rows = [row({ jobname: 'new', last_start: null, last_status: null })];
    expect(evaluateCronHealth(rows, NOW)).toEqual([{ jobname: 'new', reason: 'overdue' }]);
  });

  it('skips inactive jobs even when failed, overdue or never run', () => {
    const rows = [
      row({ jobname: 'a', active: false, last_status: 'failed' }),
      row({ jobname: 'b', active: false, last_start: minutesAgo(10_000) }),
      row({ jobname: 'c', active: false, last_start: null, last_status: null }),
      row({ jobname: 'd', active: false, schedule: '0 9 * * 1' }),
    ];
    expect(evaluateCronHealth(rows, NOW)).toEqual([]);
  });

  it('flags unsupported schedules', () => {
    expect(evaluateCronHealth([row({ jobname: 'weekly', schedule: '0 9 * * 1' })], NOW)).toEqual([
      { jobname: 'weekly', reason: 'unsupported-schedule' },
    ]);
  });

  it('reports a single reason per job, failed first', () => {
    const rows = [row({ jobname: 'a', last_status: 'failed', last_start: minutesAgo(10_000) })];
    expect(evaluateCronHealth(rows, NOW)).toEqual([{ jobname: 'a', reason: 'failed' }]);
  });

  it('orders the output by jobname regardless of input order', () => {
    const rows = [
      row({ jobname: 'zeta', last_status: 'failed' }),
      row({ jobname: 'alpha', last_status: 'failed' }),
      row({ jobname: 'mid', schedule: '0 9 * * 1' }),
    ];
    expect(evaluateCronHealth(rows, NOW).map((entry) => entry.jobname)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('does not mutate its input', () => {
    const rows = [row({ jobname: 'b' }), row({ jobname: 'a' })];
    evaluateCronHealth(rows, NOW);
    expect(rows.map((r) => r.jobname)).toEqual(['b', 'a']);
  });
});
