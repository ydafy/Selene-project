import { SQL, type TransactionSQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/verify/test-auto-cancel-lease.ts [--help]\n' +
  'B3.1 races: the auto-cancel cron lease (fn_acquire_cron_lease / fn_release_cron_lease, job\n' +
  'auto_cancel_orders) under real row locks: exactly one winner for two concurrent acquires, a second\n' +
  'acquire that waits on the open holder transaction, and one new holder for five concurrent takeovers.\n' +
  'The single-session contract (lengths, holder-only release, job names, grants) is pgTAP:\n' +
  'supabase/tests/database/cron_leases.test.sql.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case deletes the lease\n" +
  'row it committed.\n' +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

type Tx = TransactionSQL;
type Lease = {
  acquired: boolean;
  lease_id: string | null;
  lease_expires_at: Date | null;
};
const JOB = 'auto_cancel_orders';

function databaseUrl(): string {
  let url = process.env.SELENE_LOCAL_DB_URL;
  if (!url) {
    const status = Bun.spawnSync(['supabase', 'status', '--env'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (status.exitCode !== 0)
      throw new Error(
        'Local Supabase stack is not running for this worktree: run `supabase start`.',
      );
    url = JSON.parse(status.stdout.toString()).DB_URL as string | undefined;
  }
  if (!url) throw new Error('No local database URL found.');
  // Never touch a remote project: this harness writes data.
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost')
    throw new Error(`Refusing non-local database host: ${host}`);
  return url;
}

async function asService(tx: Tx) {
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
}

async function acquire(tx: Tx, job: string): Promise<Lease> {
  const [row] = await tx`SELECT * FROM public.fn_acquire_cron_lease(${job})`;
  return row as Lease;
}

async function release(tx: Tx, job: string, leaseId: string): Promise<boolean> {
  const [row] =
    await tx`SELECT public.fn_release_cron_lease(${job}, ${leaseId}::uuid) AS released`;
  return row.released as boolean;
}

async function clearLeases(tx: Tx) {
  await tx`DELETE FROM internal.cron_leases WHERE job = ${JOB}`;
}

async function storedLeaseId(sql: SQL): Promise<string | undefined> {
  const [row] =
    await sql`SELECT lease_id FROM internal.cron_leases WHERE job = ${JOB}`;
  return row?.lease_id as string | undefined;
}

/** Two connections acquire the same job at once: exactly one wins, the other sees it held. */
async function concurrentAcquire(sql: SQL) {
  const name =
    'two concurrent acquires of the same job produce exactly one holder';
  try {
    const attempt = () =>
      sql.begin(async (tx) => {
        await asService(tx as Tx);
        return acquire(tx as Tx, JOB);
      });
    const results = await Promise.all([attempt(), attempt()]);
    const winners = results.filter((lease) => lease.acquired);
    assert.equal(winners.length, 1, JSON.stringify(results));
    assert.equal(await storedLeaseId(sql), winners[0].lease_id);
    console.log(`PASS ${name}`);
    return 0;
  } catch (error) {
    console.log(`FAIL ${name}\n  ${(error as Error).message}`);
    return 1;
  } finally {
    await sql.begin((tx) => clearLeases(tx as Tx)).catch(() => undefined);
  }
}

/** A second run blocks on the row lock while the holder's transaction is open, then sees it held. */
async function heldOpenAcquire(sql: SQL) {
  const name =
    'a second acquire waits on the open holder transaction and then sees the lease held';
  let commitFirst!: () => void;
  const gate = new Promise<void>((resolve) => (commitFirst = resolve));
  try {
    const first = sql.begin(async (tx) => {
      await asService(tx as Tx);
      const lease = await acquire(tx as Tx, JOB);
      await gate;
      return lease;
    });
    await Bun.sleep(200);
    let secondDone = false;
    const second = sql.begin(async (tx) => {
      await asService(tx as Tx);
      const lease = await acquire(tx as Tx, JOB);
      secondDone = true;
      return lease;
    });
    await Bun.sleep(300);
    assert.equal(
      secondDone,
      false,
      'the second acquire must wait on the row lock',
    );
    commitFirst();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.acquired, true);
    assert.equal(b.acquired, false);
    console.log(`PASS ${name}`);
    return 0;
  } catch (error) {
    commitFirst();
    console.log(`FAIL ${name}\n  ${(error as Error).message}`);
    return 1;
  } finally {
    await sql.begin((tx) => clearLeases(tx as Tx)).catch(() => undefined);
  }
}

/** Five runs take over one expired lease at once: exactly one new holder; the stale id cannot release it. */
async function concurrentTakeover(sql: SQL) {
  const name =
    'five concurrent takeovers of an expired lease produce one new holder the stale id cannot release';
  const asServiceAcquire = () =>
    sql.begin(async (tx) => {
      await asService(tx as Tx);
      return acquire(tx as Tx, JOB);
    });
  try {
    const stale = await asServiceAcquire();
    await sql`UPDATE internal.cron_leases SET expires_at = statement_timestamp() - interval '1 second' WHERE job = ${JOB}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, asServiceAcquire),
    );
    const winners = results.filter((lease) => lease.acquired);
    assert.equal(winners.length, 1, JSON.stringify(results));
    assert.notEqual(winners[0].lease_id, stale.lease_id);
    const released = await sql.begin(async (tx) => {
      await asService(tx as Tx);
      return release(tx as Tx, JOB, stale.lease_id!);
    });
    assert.equal(released, false);
    assert.equal(await storedLeaseId(sql), winners[0].lease_id);
    console.log(`PASS ${name}`);
    return 0;
  } catch (error) {
    console.log(`FAIL ${name}\n  ${(error as Error).message}`);
    return 1;
  } finally {
    await sql.begin((tx) => clearLeases(tx as Tx)).catch(() => undefined);
  }
}

async function run() {
  const sql = new SQL(databaseUrl(), { max: 5, connectionTimeout: 5 });
  let failed = 0;
  try {
    assert.equal(
      await storedLeaseId(sql),
      undefined,
      'The local auto_cancel_orders lease must be free before the harness runs.',
    );
    failed += await concurrentAcquire(sql);
    failed += await heldOpenAcquire(sql);
    failed += await concurrentTakeover(sql);
  } finally {
    await sql.close();
  }
  const total = 3;
  console.log(`${total - failed} pass, ${failed} fail`);
  if (failed) process.exit(1);
}

if (process.argv.includes('--help')) console.log(help);
else await run();
