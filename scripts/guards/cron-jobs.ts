// Guard for the pg_cron jobs declared in supabase/schemas/
// (odd/tasks/cron-functions-as-code.md, S6 and S7). Checked by cron-jobs.test.ts;
// supabase/tests/database/cron_jobs.test.sql proves the jobs hold no secret.
import { isSupportedSchedule } from '../../supabase/functions/cron-watchdog/health';

export type CronSchemaFile = { path: string; text: string };

export interface CronJob {
  path: string;
  name: string;
  schedule: string;
  command: string;
}

// `cron.schedule('<name>', '<schedule>', <command>` and the
// `cron.schedule_in_database(...)` form pg-delta writes; the command is a
// dollar-quoted or single-quoted string.
const SCHEDULE_CALL =
  /cron\.schedule(?:_in_database)?\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*(\$([A-Za-z_]*)\$[\s\S]*?\$\4\$|'(?:[^']|'')*')/gi;
const FUNCTION_TARGET = /\/functions\/v1\/([A-Za-z0-9_-]+)/g;

const unquote = (literal: string): string => literal.replace(/''/g, "'");

// The SQL files under supabase/schemas/, where the cron jobs are declared.
export function collectCronSchemaFiles(
  repoFiles: string[],
  read: (file: string) => string,
): CronSchemaFile[] {
  return repoFiles
    .filter(
      (file) => file.startsWith('supabase/schemas/') && file.endsWith('.sql'),
    )
    .map((path) => ({ path, text: read(path) }));
}

export function parseCronJobs(files: CronSchemaFile[]): CronJob[] {
  return files.flatMap(({ path, text }) =>
    [...text.matchAll(SCHEDULE_CALL)].map((match) => ({
      path,
      name: unquote(match[1]),
      schedule: unquote(match[2]),
      command: match[3],
    })),
  );
}

export function findCronJobProblems(
  jobs: CronJob[],
  repoFiles: string[],
): string[] {
  if (jobs.length === 0) {
    return [
      'no cron.schedule(...) found under supabase/schemas/; declare the pg_cron jobs there',
    ];
  }
  const files = new Set(repoFiles);
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const job of jobs) {
    const first = seen.get(job.name);
    if (first) {
      problems.push(
        `${job.path}: cron job "${job.name}" is also declared in ${first}; job names must be unique`,
      );
    } else {
      seen.set(job.name, job.path);
    }
    if (!isSupportedSchedule(job.schedule)) {
      problems.push(
        `${job.path}: cron job "${job.name}" has schedule "${job.schedule}", which cron-watchdog cannot monitor (supabase/functions/cron-watchdog/health.ts)`,
      );
    }
    for (const [, name] of job.command.matchAll(FUNCTION_TARGET)) {
      if (!files.has(`supabase/functions/${name}/index.ts`)) {
        problems.push(
          `${job.path}: cron job "${job.name}" calls /functions/v1/${name}, but supabase/functions/${name}/index.ts does not exist`,
        );
      }
    }
  }
  return problems;
}
