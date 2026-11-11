// source-text: the cron.schedule calls in supabase/schemas/ are the job declarations this guard checks
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listRepoFiles } from './agent-instructions';
import {
  collectCronSchemaFiles,
  findCronJobProblems,
  parseCronJobs,
} from './cron-jobs';

const root = join(import.meta.dir, '..', '..');
const PATH = 'supabase/schemas/_cluster/misc.sql';
const FUNCTIONS = ['supabase/functions/dispatch-push/index.ts'];

const httpJob = (name: string, schedule: string, fn = 'dispatch-push') =>
  `select cron.schedule('${name}', '${schedule}', $$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/${fn}')$$);`;

describe('cron jobs (probes)', () => {
  it('parses cron.schedule and cron.schedule_in_database calls', () => {
    const text = [
      httpJob('a-job', '*/5 * * * *'),
      "select cron.schedule('b-job', '0 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);",
      "SELECT cron.schedule_in_database('c-job', '0 * * * *', 'select public.fn_x()', 'postgres', 'postgres', true);",
    ].join('\n');
    expect(
      parseCronJobs([{ path: PATH, text }]).map(({ name, schedule }) => ({
        name,
        schedule,
      })),
    ).toEqual([
      { name: 'a-job', schedule: '*/5 * * * *' },
      { name: 'b-job', schedule: '0 3 * * *' },
      { name: 'c-job', schedule: '0 * * * *' },
    ]);
  });

  it('accepts unique jobs with supported schedules that call existing functions', () => {
    const jobs = parseCronJobs([
      {
        path: PATH,
        text: `${httpJob('a-job', '*/1 * * * *')}\n${httpJob('b-job', '0 */6 * * *')}`,
      },
    ]);
    expect(findCronJobProblems(jobs, FUNCTIONS)).toEqual([]);
  });

  it('fails when no cron job is declared', () => {
    expect(findCronJobProblems([], FUNCTIONS)).toEqual([
      'no cron.schedule(...) found under supabase/schemas/; declare the pg_cron jobs there',
    ]);
  });

  it('reports a duplicate job name', () => {
    const jobs = parseCronJobs([
      { path: PATH, text: httpJob('a-job', '*/5 * * * *') },
      {
        path: 'supabase/schemas/public/more.sql',
        text: httpJob('a-job', '*/5 * * * *'),
      },
    ]);
    expect(findCronJobProblems(jobs, FUNCTIONS)).toEqual([
      `supabase/schemas/public/more.sql: cron job "a-job" is also declared in ${PATH}; job names must be unique`,
    ]);
  });

  it('reports a schedule cron-watchdog cannot monitor', () => {
    const jobs = parseCronJobs([
      { path: PATH, text: httpJob('a-job', '0 3 * * 1') },
    ]);
    expect(findCronJobProblems(jobs, FUNCTIONS)).toEqual([
      `${PATH}: cron job "a-job" has schedule "0 3 * * 1", which cron-watchdog cannot monitor (supabase/functions/cron-watchdog/health.ts)`,
    ]);
  });

  it('reports a job that calls a function with no directory', () => {
    const jobs = parseCronJobs([
      { path: PATH, text: httpJob('a-job', '*/5 * * * *', 'dynamic-api') },
    ]);
    expect(findCronJobProblems(jobs, FUNCTIONS)).toEqual([
      `${PATH}: cron job "a-job" calls /functions/v1/dynamic-api, but supabase/functions/dynamic-api/index.ts does not exist`,
    ]);
  });

  it('reads the target of a single-quoted schedule_in_database command, as generate writes it', () => {
    const text =
      "SELECT cron.schedule_in_database('a-job', '*/5 * * * *', 'select net.http_post(\n    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/dynamic-api'',\n    body := ''{}''::jsonb\n  )', 'postgres', NULL, true);";
    expect(
      findCronJobProblems(parseCronJobs([{ path: PATH, text }]), FUNCTIONS),
    ).toEqual([
      `${PATH}: cron job "a-job" calls /functions/v1/dynamic-api, but supabase/functions/dynamic-api/index.ts does not exist`,
    ]);
  });

  it('reads only the SQL files under supabase/schemas/', () => {
    const repoFiles = [
      'supabase/schemas/_cluster/misc.sql',
      'supabase/schemas/.pgdelta-export.json',
      'supabase/migrations/20261110000000_cron_jobs.sql',
      'supabase/snippets/cron.sql',
    ];
    const read = (file: string) => `text of ${file}`;
    expect(collectCronSchemaFiles(repoFiles, read).map((f) => f.path)).toEqual([
      'supabase/schemas/_cluster/misc.sql',
    ]);
  });
});

describe('cron jobs (repository)', () => {
  it('declares unique jobs with schedules cron-watchdog supports, calling existing functions', () => {
    const repoFiles = listRepoFiles(root);
    const jobs = parseCronJobs(
      collectCronSchemaFiles(repoFiles, (file) =>
        readFileSync(join(root, file), 'utf8'),
      ),
    );
    expect(findCronJobProblems(jobs, repoFiles)).toEqual([]);
  });
});
