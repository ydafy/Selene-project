import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-checkout-recovery-lease.ts [--help]\n' +
  'BL13 SQL: service-only expiring lease for checkout-recovery-worker (fn_acquire_checkout_recovery_lease,\n' +
  'fn_release_checkout_recovery_lease): one holder, nothing acquired while recovery is disabled, takeover\n' +
  'after expiry, release only by the holder, grants, and exactly one winner for concurrent acquires.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back and the\n" +
  'concurrency cases restore the lease columns they committed.\n' +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

type Tx = SQL;
type Lease = { acquired: boolean; lease_id: string | null; lease_expires_at: Date | null };

const TTL_SECONDS = 600;

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

async function asService(tx: Tx) {
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
}

async function asOwner(tx: Tx) {
  await tx`RESET ROLE`;
}

async function acquire(tx: Tx): Promise<Lease> {
  const [row] = await tx`SELECT * FROM public.fn_acquire_checkout_recovery_lease()`;
  return row as Lease;
}

async function release(tx: Tx, leaseId: string): Promise<boolean> {
  const [row] = await tx`SELECT public.fn_release_checkout_recovery_lease(${leaseId}::uuid) AS released`;
  return row.released as boolean;
}

async function stored(tx: Tx) {
  await asOwner(tx);
  const [row] = await tx`SELECT checkout_recovery_lease_id AS lease_id,
      checkout_recovery_lease_expires_at AS expires_at
    FROM public.system_settings WHERE id = 1`;
  await asService(tx);
  return row as { lease_id: string | null; expires_at: Date | null };
}

async function expireLease(tx: Tx) {
  await asOwner(tx);
  await tx`UPDATE public.system_settings
    SET checkout_recovery_lease_expires_at = statement_timestamp() - interval '1 second' WHERE id = 1`;
  await asService(tx);
}

async function rejects(tx: Tx, action: (sp: Tx) => Promise<unknown>, message: string) {
  await assert.rejects(
    tx.savepoint((sp) => action(sp as Tx)),
    (error: Error) => error.message.includes(message),
    `expected ${message}`,
  );
}

async function clearLease(tx: Tx) {
  await tx`UPDATE public.system_settings SET
      checkout_recovery_lease_id = NULL, checkout_recovery_lease_expires_at = NULL
    WHERE id = 1`;
}

const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  [
    'a free lease is acquired for a fixed 600-second TTL and stored on system_settings',
    async (tx) => {
      const [{ now }] = await tx`SELECT statement_timestamp() AS now`;
      const lease = await acquire(tx);
      assert.equal(lease.acquired, true);
      assert.match(lease.lease_id ?? '', /^[0-9a-f-]{36}$/);
      const ttl = (lease.lease_expires_at!.getTime() - (now as Date).getTime()) / 1000;
      assert.ok(Math.abs(ttl - TTL_SECONDS) < 2, `TTL ${ttl}`);
      const row = await stored(tx);
      assert.equal(row.lease_id, lease.lease_id);
      assert.equal(row.expires_at!.getTime(), lease.lease_expires_at!.getTime());
    },
  ],
  [
    'a held unexpired lease is not acquired again and stays unchanged',
    async (tx) => {
      const first = await acquire(tx);
      const second = await acquire(tx);
      assert.deepEqual(second, { acquired: false, lease_id: null, lease_expires_at: null });
      assert.equal((await stored(tx)).lease_id, first.lease_id);
    },
  ],
  [
    'nothing is acquired or stored while checkout recovery is disabled',
    async (tx) => {
      await asOwner(tx);
      await tx`UPDATE public.system_settings SET checkout_recovery_enabled = false WHERE id = 1`;
      await asService(tx);
      assert.deepEqual(await acquire(tx), { acquired: false, lease_id: null, lease_expires_at: null });
      assert.deepEqual(await stored(tx), { lease_id: null, expires_at: null });
    },
  ],
  [
    'an expired lease (a killed run) is taken over with a new lease id',
    async (tx) => {
      const stale = await acquire(tx);
      await expireLease(tx);
      const fresh = await acquire(tx);
      assert.equal(fresh.acquired, true);
      assert.notEqual(fresh.lease_id, stale.lease_id);
      assert.equal((await stored(tx)).lease_id, fresh.lease_id);
    },
  ],
  [
    'release by a non-holder returns false and keeps the lease; the holder clears it',
    async (tx) => {
      const lease = await acquire(tx);
      assert.equal(await release(tx, crypto.randomUUID()), false);
      assert.equal((await stored(tx)).lease_id, lease.lease_id);
      assert.equal(await release(tx, lease.lease_id!), true);
      assert.deepEqual(await stored(tx), { lease_id: null, expires_at: null });
      assert.equal((await acquire(tx)).acquired, true);
    },
  ],
  [
    'a superseded holder cannot release the lease of the run that took over',
    async (tx) => {
      const stale = await acquire(tx);
      await expireLease(tx);
      const fresh = await acquire(tx);
      assert.equal(await release(tx, stale.lease_id!), false);
      assert.equal((await stored(tx)).lease_id, fresh.lease_id);
    },
  ],
  [
    'a null lease id releases nothing',
    async (tx) => {
      const lease = await acquire(tx);
      const [row] = await tx`SELECT public.fn_release_checkout_recovery_lease(NULL) AS released`;
      assert.equal(row.released, false);
      assert.equal((await stored(tx)).lease_id, lease.lease_id);
    },
  ],
  [
    'both functions are SECURITY DEFINER with an empty search_path executable only by service_role',
    async (tx) => {
      for (const sig of [
        'public.fn_acquire_checkout_recovery_lease()',
        'public.fn_release_checkout_recovery_lease(uuid)',
      ]) {
        const [row] = await tx`SELECT
            has_function_privilege('anon', ${sig}, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', ${sig}, 'EXECUTE') AS authed,
            has_function_privilege('service_role', ${sig}, 'EXECUTE') AS service,
            p.prosecdef AS definer, p.proconfig AS config, p.proacl::text AS acl
          FROM pg_proc p WHERE p.oid = ${sig}::regprocedure`;
        assert.equal(row.anon, false, sig);
        assert.equal(row.authed, false, sig);
        assert.equal(row.service, true, sig);
        assert.equal(row.definer, true, sig);
        assert.deepEqual(row.config, ['search_path=""'], sig);
        // An ACL entry starting with "=" is PUBLIC.
        assert.ok(!/[{,]=X/.test(row.acl), `PUBLIC must not execute ${sig}: ${row.acl}`);
      }
    },
  ],
  [
    'authenticated and anon cannot acquire or release (permission denied)',
    async (tx) => {
      for (const role of ['authenticated', 'anon']) {
        await asOwner(tx);
        await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ role })}, true)`;
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await rejects(tx, (sp) => acquire(sp), 'permission denied');
        await rejects(tx, (sp) => release(sp, crypto.randomUUID()), 'permission denied');
      }
      assert.deepEqual(await stored(tx), { lease_id: null, expires_at: null });
    },
  ],
  [
    'a caller without the service_role claim is refused by the body',
    async (tx) => {
      await tx`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await rejects(tx, (sp) => acquire(sp), 'UNAUTHORIZED');
      await rejects(tx, (sp) => release(sp, crypto.randomUUID()), 'UNAUTHORIZED');
      assert.deepEqual(await stored(tx), { lease_id: null, expires_at: null });
    },
  ],
];

const asServiceAcquire = (sql: SQL) =>
  sql.begin(async (tx) => {
    await asService(tx as Tx);
    return acquire(tx as Tx);
  });

/** Two connections acquire at once: exactly one wins, the other sees it held. */
async function concurrentAcquire(sql: SQL) {
  const name = 'two concurrent acquires produce exactly one holder';
  try {
    const results = await Promise.all([asServiceAcquire(sql), asServiceAcquire(sql)]);
    const winners = results.filter((lease) => lease.acquired);
    assert.equal(winners.length, 1, JSON.stringify(results));
    const [row] = await sql`SELECT checkout_recovery_lease_id AS lease_id FROM public.system_settings WHERE id = 1`;
    assert.equal(row.lease_id, winners[0].lease_id);
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
  const name = 'five concurrent takeovers of an expired lease produce one new holder the stale id cannot release';
  try {
    const stale = await asServiceAcquire(sql);
    await sql`UPDATE public.system_settings
      SET checkout_recovery_lease_expires_at = statement_timestamp() - interval '1 second' WHERE id = 1`;
    const results = await Promise.all(Array.from({ length: 5 }, () => asServiceAcquire(sql)));
    const winners = results.filter((lease) => lease.acquired);
    assert.equal(winners.length, 1, JSON.stringify(results));
    assert.notEqual(winners[0].lease_id, stale.lease_id);
    const released = await sql.begin(async (tx) => {
      await asService(tx as Tx);
      return release(tx as Tx, stale.lease_id!);
    });
    assert.equal(released, false);
    const [row] = await sql`SELECT checkout_recovery_lease_id AS lease_id FROM public.system_settings WHERE id = 1`;
    assert.equal(row.lease_id, winners[0].lease_id);
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
    const [before] = await sql`SELECT checkout_recovery_enabled AND checkout_recovery_lease_id IS NULL AS ready
      FROM public.system_settings WHERE id = 1`;
    assert.equal(before.ready, true, 'Local checkout recovery must be enabled with a free lease before the harness runs.');
    for (const [name, body] of cases) {
      try {
        await sql.begin(async (tx) => {
          await asService(tx as Tx);
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
    failed += await concurrentAcquire(sql);
    failed += await concurrentTakeover(sql);
  } finally {
    await sql.close();
  }
  const total = cases.length + 2;
  console.log(`${total - failed} pass, ${failed} fail`);
  if (failed) process.exit(1);
}

if (process.argv.includes('--help')) console.log(help);
else await run();
