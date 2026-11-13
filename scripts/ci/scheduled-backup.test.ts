// source-text: reads back the $GITHUB_OUTPUT file the script writes (its output contract with GitHub Actions), never source code.
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkScheduledRun,
  decideScheduledRun,
  type ListScheduledRuns,
} from './scheduled-backup';

const PRIMARY = '17 14 * * 1';
const BACKUP = '23 20 * * 1';
const NOW = new Date('2026-11-16T20:31:00Z');

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function outputFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'scheduled-backup-'));
  roots.push(root);
  const path = join(root, 'github-output');
  writeFileSync(path, '');
  return path;
}

async function check(
  env: Record<string, string>,
  listRuns: ListScheduledRuns,
): Promise<{ log: string[]; output: string; calls: unknown[] }> {
  const output = outputFile();
  const log: string[] = [];
  const calls: unknown[] = [];
  await checkScheduledRun({
    workflow: 'dependency-audit.yml',
    backupCron: BACKUP,
    env: {
      GITHUB_RUN_ID: '1000',
      GITHUB_REPOSITORY: 'ydafy/Selene-project',
      GITHUB_OUTPUT: output,
      ...env,
    },
    now: NOW,
    listRuns: async (query) => {
      calls.push(query);
      return listRuns(query);
    },
    log: (line) => log.push(line),
  });
  return { log, output: readFileSync(output, 'utf8'), calls };
}

const neverCalled: ListScheduledRuns = () => {
  throw new Error('gh run list must not run');
};

describe('decideScheduledRun', () => {
  it('runs every event that is not a schedule', () => {
    expect(
      decideScheduledRun({
        eventName: 'workflow_dispatch',
        schedule: '',
        backupCron: BACKUP,
        otherScheduledRuns: 3,
      }),
    ).toEqual({
      run: true,
      reason: 'event "workflow_dispatch" is not the backup schedule; it runs',
    });
  });

  it('runs the primary schedule', () => {
    expect(
      decideScheduledRun({
        eventName: 'schedule',
        schedule: PRIMARY,
        backupCron: BACKUP,
        otherScheduledRuns: 3,
      }),
    ).toEqual({
      run: true,
      reason: `schedule "${PRIMARY}" is not the backup schedule; it runs`,
    });
  });

  it('runs the backup schedule when no other scheduled run started in 24 hours', () => {
    expect(
      decideScheduledRun({
        eventName: 'schedule',
        schedule: BACKUP,
        backupCron: BACKUP,
        otherScheduledRuns: 0,
      }),
    ).toEqual({
      run: true,
      reason: `backup schedule "${BACKUP}": no other scheduled run started in the last 24 hours; it runs`,
    });
  });

  it('skips the backup schedule when another scheduled run started in 24 hours', () => {
    expect(
      decideScheduledRun({
        eventName: 'schedule',
        schedule: BACKUP,
        backupCron: BACKUP,
        otherScheduledRuns: 2,
      }),
    ).toEqual({
      run: false,
      reason: `backup schedule "${BACKUP}": 2 other scheduled runs started in the last 24 hours; it skips`,
    });
  });
});

describe('checkScheduledRun', () => {
  it('writes run=true for a manual run without calling gh', async () => {
    const result = await check(
      { GITHUB_EVENT_NAME: 'workflow_dispatch', EVENT_SCHEDULE: '' },
      neverCalled,
    );
    expect(result).toEqual({
      log: [
        'run=true: event "workflow_dispatch" is not the backup schedule; it runs',
      ],
      output: 'run=true\n',
      calls: [],
    });
  });

  it('writes run=true for the primary schedule without calling gh', async () => {
    const result = await check(
      { GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: PRIMARY },
      neverCalled,
    );
    expect(result).toEqual({
      log: [
        `run=true: schedule "${PRIMARY}" is not the backup schedule; it runs`,
      ],
      output: 'run=true\n',
      calls: [],
    });
  });

  it('writes run=true for the backup when only the current run is in the window', async () => {
    const result = await check(
      { GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: BACKUP },
      async () => [1000],
    );
    expect(result).toEqual({
      log: [
        `run=true: backup schedule "${BACKUP}": no other scheduled run started in the last 24 hours; it runs`,
      ],
      output: 'run=true\n',
      calls: [
        {
          workflow: 'dependency-audit.yml',
          repository: 'ydafy/Selene-project',
          since: '2026-11-15T20:31:00Z',
        },
      ],
    });
  });

  it('writes run=false for the backup when another scheduled run is in the window', async () => {
    const result = await check(
      { GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: BACKUP },
      async () => [999, 1000],
    );
    expect(result.log).toEqual([
      `run=false: backup schedule "${BACKUP}": 1 other scheduled run started in the last 24 hours; it skips`,
    ]);
    expect(result.output).toBe('run=false\n');
  });

  it('writes run=true for the backup when gh run list fails', async () => {
    const result = await check(
      { GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: BACKUP },
      async () => {
        throw new Error('HTTP 502');
      },
    );
    expect(result.log).toEqual([
      `run=true: backup schedule "${BACKUP}": could not count other scheduled runs (HTTP 502); it runs, because a missed check is worse than a duplicate email`,
    ]);
    expect(result.output).toBe('run=true\n');
  });
});
