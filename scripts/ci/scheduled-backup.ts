// Decides whether a weekly workflow run does its work. GitHub can delay or drop a
// scheduled run, so the weekly dependency workflows have a second, backup cron
// hours after the primary one. A run started by the backup cron does the work
// only when no other scheduled run of the same workflow started in the last 24
// hours, whatever its conclusion. Every other trigger always runs.
//
// Usage, from a workflow step with GH_TOKEN, GITHUB_OUTPUT and
// EVENT_SCHEDULE=${{ github.event.schedule }} set:
//   bun scripts/ci/scheduled-backup.ts <workflow file> '<backup cron>'
// It prints one line with the reason and writes run=true or run=false to
// $GITHUB_OUTPUT.
import { appendFileSync } from 'node:fs';

export type BackupDecision = { run: boolean; reason: string };

export type ScheduledRunsQuery = {
  workflow: string;
  repository: string;
  since: string;
};

// Returns the database ids of the scheduled runs created since `since`.
export type ListScheduledRuns = (
  query: ScheduledRunsQuery,
) => Promise<number[]>;

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function decideScheduledRun(input: {
  eventName: string;
  schedule: string;
  backupCron: string;
  otherScheduledRuns: number;
}): BackupDecision {
  const { eventName, schedule, backupCron, otherScheduledRuns } = input;
  if (eventName !== 'schedule') {
    return {
      run: true,
      reason: `event "${eventName}" is not the backup schedule; it runs`,
    };
  }
  if (schedule !== backupCron) {
    return {
      run: true,
      reason: `schedule "${schedule}" is not the backup schedule; it runs`,
    };
  }
  if (otherScheduledRuns === 0) {
    return {
      run: true,
      reason: `backup schedule "${backupCron}": no other scheduled run started in the last 24 hours; it runs`,
    };
  }
  const runs = otherScheduledRuns === 1 ? 'run' : 'runs';
  return {
    run: false,
    reason: `backup schedule "${backupCron}": ${otherScheduledRuns} other scheduled ${runs} started in the last 24 hours; it skips`,
  };
}

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name];
  if (!value) throw new Error(`scheduled-backup: ${name} is not set`);
  return value;
}

export async function checkScheduledRun(deps: {
  workflow: string;
  backupCron: string;
  env: Record<string, string | undefined>;
  now: Date;
  listRuns: ListScheduledRuns;
  log: (line: string) => void;
}): Promise<BackupDecision> {
  const { workflow, backupCron, env, now, listRuns, log } = deps;
  const output = required(env, 'GITHUB_OUTPUT');
  const eventName = required(env, 'GITHUB_EVENT_NAME');
  const schedule = env.EVENT_SCHEDULE ?? '';

  let decision: BackupDecision;
  if (eventName !== 'schedule' || schedule !== backupCron) {
    decision = decideScheduledRun({
      eventName,
      schedule,
      backupCron,
      otherScheduledRuns: 0,
    });
  } else {
    try {
      const currentRun = Number(required(env, 'GITHUB_RUN_ID'));
      const since = new Date(now.getTime() - WINDOW_MS)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      const ids = await listRuns({
        workflow,
        repository: required(env, 'GITHUB_REPOSITORY'),
        since,
      });
      decision = decideScheduledRun({
        eventName,
        schedule,
        backupCron,
        otherScheduledRuns: ids.filter((id) => id !== currentRun).length,
      });
    } catch (error) {
      // A missed weekly check is worse than a duplicate email.
      const message = error instanceof Error ? error.message : String(error);
      decision = {
        run: true,
        reason: `backup schedule "${backupCron}": could not count other scheduled runs (${message}); it runs, because a missed check is worse than a duplicate email`,
      };
    }
  }

  log(`run=${decision.run}: ${decision.reason}`);
  appendFileSync(output, `run=${decision.run}\n`);
  return decision;
}

const ghListScheduledRuns: ListScheduledRuns = async (query) => {
  const result = Bun.spawnSync([
    'gh',
    'run',
    'list',
    '--repo',
    query.repository,
    '--workflow',
    query.workflow,
    '--event',
    'schedule',
    '--created',
    `>=${query.since}`,
    '--json',
    'databaseId',
  ]);
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr || `gh run list exited with ${result.exitCode}`);
  }
  const runs: unknown = JSON.parse(result.stdout.toString());
  if (!Array.isArray(runs))
    throw new Error('gh run list did not return a list');
  return runs.map((run: { databaseId?: unknown }) => {
    if (typeof run?.databaseId !== 'number')
      throw new Error('gh run list returned a run without databaseId');
    return run.databaseId;
  });
};

if (import.meta.main) {
  const [workflow, backupCron] = process.argv.slice(2);
  if (!workflow || !backupCron) {
    console.error(
      "Usage: bun scripts/ci/scheduled-backup.ts <workflow file> '<backup cron>'",
    );
    process.exit(1);
  }
  await checkScheduledRun({
    workflow,
    backupCron,
    env: process.env,
    now: new Date(),
    listRuns: ghListScheduledRuns,
    log: (line) => console.log(line),
  });
}
