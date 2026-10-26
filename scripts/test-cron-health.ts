import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-cron-health.ts [--help]\n' +
  'BL33 SQL: fn_cron_health() (read model of cron-watchdog) reports the latest started run of each\n' +
  'pg_cron job, and reads cron.job_run_details through its primary key backwards instead of scanning\n' +
  'the whole table once per job (the remote table held 86k rows and the old query hit the 8 s\n' +
  'statement timeout of service_role).\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

type Tx = SQL;
type Row = { jobname: string; schedule: string; active: boolean; last_start: Date | null; last_status: string | null };

function databaseUrl(): string {
  let url = process.env.SELENE_LOCAL_DB_URL;
  if (!url) {
    const status = Bun.spawnSync(['supabase', 'status', '--env'], { stdout: 'pipe', stderr: 'pipe' });
    if (status.exitCode !== 0)
      throw new Error('Local Supabase stack is not running for this worktree: run `supabase start`.');
    url = JSON.parse(status.stdout.toString()).DB_URL as string | undefined;
  }
  if (!url) throw new Error('No local database URL found.');
  // Never touch a remote project: this harness writes (and rolls back) data.
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-local database host: ${host}`);
  return url;
}

class Rollback extends Error {}

let nextRunId = 5_000_000;

async function schedule(tx: Tx, name: string, cron = '*/5 * * * *'): Promise<number> {
  const [{ jobid }] = await tx`SELECT cron.schedule(${name}, ${cron}, 'select 1') AS jobid`;
  return Number(jobid);
}

async function run(tx: Tx, jobid: number, status: string, startedAgo: string | null) {
  await tx`INSERT INTO cron.job_run_details (jobid, runid, job_pid, database, username, command, status, start_time, end_time)
    VALUES (${jobid}, ${nextRunId++}, 1, 'postgres', 'postgres', 'select 1', ${status},
      CASE WHEN ${startedAgo}::interval IS NULL THEN NULL ELSE now() - ${startedAgo}::interval END,
      CASE WHEN ${startedAgo}::interval IS NULL THEN NULL ELSE now() - ${startedAgo}::interval END)`;
}

async function health(tx: Tx, name: string): Promise<Row | undefined> {
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
  const [row] = await tx`SELECT * FROM public.fn_cron_health() WHERE jobname = ${name}`;
  await tx`RESET ROLE`;
  return row as Row | undefined;
}

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: PlanNode[] };
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];

const minutesAgo = (date: Date | null) => (date ? Math.round((Date.now() - date.getTime()) / 60_000) : null);

const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  [
    'reports the latest started run of a job, not an older one',
    async (tx) => {
      const job = await schedule(tx, 'bl33-latest');
      await run(tx, job, 'succeeded', '20 minutes');
      await run(tx, job, 'failed', '15 minutes');
      await run(tx, job, 'succeeded', '10 minutes');
      const row = await health(tx, 'bl33-latest');
      assert.equal(row?.last_status, 'succeeded');
      assert.equal(minutesAgo(row!.last_start), 10);
    },
  ],
  [
    'a latest failed run is reported as failed',
    async (tx) => {
      const job = await schedule(tx, 'bl33-failed');
      await run(tx, job, 'succeeded', '10 minutes');
      await run(tx, job, 'failed', '5 minutes');
      assert.equal((await health(tx, 'bl33-failed'))?.last_status, 'failed');
    },
  ],
  [
    'a run that has not started yet (no start_time) is skipped for the previous started run',
    async (tx) => {
      const job = await schedule(tx, 'bl33-starting');
      await run(tx, job, 'succeeded', '5 minutes');
      await run(tx, job, 'starting', null);
      const row = await health(tx, 'bl33-starting');
      assert.equal(row?.last_status, 'succeeded');
      assert.equal(minutesAgo(row!.last_start), 5);
    },
  ],
  [
    'a job that never ran is listed with no last run',
    async (tx) => {
      await schedule(tx, 'bl33-never', '0 3 * * *');
      const row = await health(tx, 'bl33-never');
      assert.deepEqual(row, { jobname: 'bl33-never', schedule: '0 3 * * *', active: true, last_start: null, last_status: null });
    },
  ],
  [
    'runs of other jobs do not leak into a job',
    async (tx) => {
      const a = await schedule(tx, 'bl33-a');
      const b = await schedule(tx, 'bl33-b');
      await run(tx, a, 'failed', '30 minutes');
      await run(tx, b, 'succeeded', '1 minute');
      assert.equal((await health(tx, 'bl33-a'))?.last_status, 'failed');
      assert.equal(minutesAgo((await health(tx, 'bl33-a'))!.last_start), 30);
    },
  ],
  [
    'with production-sized history it reads job_run_details by primary key backwards, never a full scan',
    async (tx) => {
      const jobs: number[] = [];
      for (let i = 0; i < 15; i++) jobs.push(await schedule(tx, `bl33-load-${i}`));
      await tx`INSERT INTO cron.job_run_details (jobid, runid, job_pid, database, username, command, status, start_time, end_time)
        SELECT j, 6000000 + g * 100 + j, 1, 'postgres', 'postgres', 'select 1', 'succeeded',
               now() - (g * interval '5 minutes'), now() - (g * interval '5 minutes')
        FROM unnest(${`{${jobs.join(",")}}`}::bigint[]) AS j CROSS JOIN generate_series(1, 6000) AS g`;
      await tx`ANALYZE cron.job_run_details`;
      const [{ prosrc }] = await tx`SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_cron_health()'::regprocedure`;
      const [explained] = await tx.unsafe(`EXPLAIN (FORMAT JSON) ${prosrc}`);
      const nodes = planNodes((explained['QUERY PLAN'] as Array<{ Plan: PlanNode }>)[0].Plan);
      const reads = nodes.filter((node) => node['Relation Name'] === 'job_run_details');
      assert.deepEqual(
        reads.map((node) => `${node['Node Type']} ${node['Index Name'] ?? ''}`.trim()),
        ['Index Scan job_run_details_pkey'],
        'job_run_details must be read once per job through its primary key, never sequentially',
      );
    },
  ],
];

async function main() {
  const sql = new SQL(databaseUrl(), { max: 1, connectionTimeout: 5 });
  let failed = 0;
  try {
    for (const [name, body] of cases) {
      try {
        await sql.begin(async (tx) => {
          await body(tx as Tx);
          throw new Rollback();
        });
      } catch (error) {
        if (error instanceof Rollback) {
          console.log(`PASS ${name}`);
          continue;
        }
        failed++;
        console.log(`FAIL ${name}\n  ${(error as Error).message}`);
      }
    }
  } finally {
    await sql.close();
  }
  console.log(`${cases.length - failed} pass, ${failed} fail`);
  if (failed) process.exit(1);
}

if (process.argv.includes('--help')) console.log(help);
else await main();
