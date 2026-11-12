import { SQL, type TransactionSQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/verify/test-checkout-recovery-lease.ts [--help]\n' +
  'BL13 races: the checkout-recovery-worker cron lease (fn_acquire_cron_lease / fn_release_cron_lease,\n' +
  'job checkout_recovery) under real row locks: exactly one winner for two concurrent acquires, and one\n' +
  'new holder for five concurrent takeovers of an expired lease that the stale id cannot release.\n' +
  'The single-session contract (length, holder-only release, the disabled switch, grants) is pgTAP:\n' +
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
const JOB = 'checkout_recovery';

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

async function acquire(tx: Tx): Promise<Lease> {
  const [row] = await tx`SELECT * FROM public.fn_acquire_cron_lease(${JOB})`;
  return row as Lease;
}

async function release(tx: Tx, leaseId: string): Promise<boolean> {
  const [row] =
    await tx`SELECT public.fn_release_cron_lease(${JOB}, ${leaseId}::uuid) AS released`;
  return row.released as boolean;
}

async function clearLease(tx: Tx) {
  await tx`DELETE FROM internal.cron_leases WHERE job = ${JOB}`;
}

async function storedLeaseId(sql: SQL): Promise<string | undefined> {
  const [row] =
    await sql`SELECT lease_id FROM internal.cron_leases WHERE job = ${JOB}`;
  return row?.lease_id as string | undefined;
}

const asServiceAcquire = (sql: SQL) =>
  sql.begin(async (tx) => {
    await asService(tx as Tx);
    return acquire(tx as Tx);
  });

/** Two connections acquire at once: exactly one wins, the other sees it held. */
async function concurrentAcquire(sql: SQL) {
  const name = 'two concurrent acquires produce exactly one holder';
  try {
    const results = await Promise.all([
      asServiceAcquire(sql),
      asServiceAcquire(sql),
    ]);
    const winners = results.filter((lease) => lease.acquired);
    assert.equal(winners.length, 1, JSON.stringify(results));
    assert.equal(await storedLeaseId(sql), winners[0].lease_id);
    console.log(`PASS ${name}`);
    return 0;
  } catch (error) {
    console.log(`FAIL ${name}\n  ${(error as Error).message}`);
    return 1;
  } finally {
    await sql.begin((tx) => clearLease(tx as Tx)).catch(() => undefined);
  }
}

/** Five runs take over one expired lease at once: one new holder; the stale id cannot release it. */
async function concurrentTakeover(sql: SQL) {
  const name =
    'five concurrent takeovers of an expired lease produce one new holder the stale id cannot release';
  try {
    const stale = await asServiceAcquire(sql);
    assert.equal(stale.acquired, true);
    await sql`UPDATE internal.cron_leases
      SET expires_at = statement_timestamp() - interval '1 second' WHERE job = ${JOB}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => asServiceAcquire(sql)),
    );
    const winners = results.filter((lease) => lease.acquired);
    assert.equal(winners.length, 1, JSON.stringify(results));
    assert.notEqual(winners[0].lease_id, stale.lease_id);
    const released = await sql.begin(async (tx) => {
      await asService(tx as Tx);
      return release(tx as Tx, stale.lease_id!);
    });
    assert.equal(released, false);
    assert.equal(await storedLeaseId(sql), winners[0].lease_id);
    console.log(`PASS ${name}`);
    return 0;
  } catch (error) {
    console.log(`FAIL ${name}\n  ${(error as Error).message}`);
    return 1;
  } finally {
    await sql.begin((tx) => clearLease(tx as Tx)).catch(() => undefined);
  }
}

async function run() {
  const sql = new SQL(databaseUrl(), { max: 5, connectionTimeout: 5 });
  let failed = 0;
  try {
    const [settings] =
      await sql`SELECT checkout_recovery_enabled AS enabled FROM public.system_settings WHERE id = 1`;
    assert.equal(
      settings.enabled === true && (await storedLeaseId(sql)) === undefined,
      true,
      'Local checkout recovery must be enabled with a free lease before the harness runs.',
    );
    failed += await concurrentAcquire(sql);
    failed += await concurrentTakeover(sql);
  } finally {
    await sql.close();
  }
  const total = 2;
  console.log(`${total - failed} pass, ${failed} fail`);
  if (failed) process.exit(1);
}

if (process.argv.includes('--help')) console.log(help);
else await run();
