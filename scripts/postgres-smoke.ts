import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/postgres-smoke.ts [--help]\n' +
  'Local infrastructure only: readiness, distinct sessions, row-lock rejection and recovery.\n' +
  'SELENE_TEST_PG_PORT defaults to 55432. Host, database and credentials are local-test-only.';

async function smoke() {
  const rawPort = process.env.SELENE_TEST_PG_PORT ?? '55432';
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      'SELENE_TEST_PG_PORT must be an integer between 1 and 65535.',
    );
  }
  // Never consume DATABASE_URL, PGHOST or application/remote credentials.
  const sql = new SQL(
    `postgres://selene_test:selene_local_test_only@127.0.0.1:${port}/selene_test?sslmode=disable`,
    { max: 2, connectionTimeout: 5 },
  );
  // Identifiers below are generated internally, never supplied by the caller.
  const schema = `infra_probe_${crypto.randomUUID().replaceAll('-', '')}`;
  const table = `"${schema}".counter`;
  let created = false;
  let transaction = false;
  try {
    const a = await sql.reserve();
    try {
      const b = await sql.reserve();
      try {
        for (const connection of [a, b]) {
          await connection`SET statement_timeout = '5s'`;
          await connection`SET idle_in_transaction_session_timeout = '15s'`;
        }
        const [server] =
          await a`SELECT current_database() AS db, current_user AS role,
          current_setting('server_version') AS version, pg_backend_pid() AS pid`;
        const [second] = await b`SELECT pg_backend_pid() AS pid`;
        assert.equal(server.db, 'selene_test');
        assert.equal(server.role, 'selene_test');
        assert.match(server.version, /^17\./);
        assert.notEqual(server.pid, second.pid);
        console.log(
          `PASS readiness: PostgreSQL ${server.version} on 127.0.0.1:${port}`,
        );
        console.log(
          `PASS independent sessions: A=${server.pid} B=${second.pid}`,
        );

        await a.unsafe(`CREATE SCHEMA "${schema}"`);
        created = true;
        await a.unsafe(
          `CREATE TABLE ${table} (id integer PRIMARY KEY, value integer NOT NULL)`,
        );
        await a.unsafe(`INSERT INTO ${table} VALUES (1, 0)`);
        await a`BEGIN`;
        transaction = true;
        // Awaiting this response proves A holds the row lock before B attempts it.
        await a.unsafe(`SELECT id FROM ${table} WHERE id = 1 FOR UPDATE`);
        let state: unknown;
        try {
          await b.unsafe(
            `SELECT id FROM ${table} WHERE id = 1 FOR UPDATE NOWAIT`,
          );
        } catch (error) {
          if (error && typeof error === 'object' && 'errno' in error)
            state = error.errno;
        }
        assert.equal(
          state,
          '55P03',
          'B must receive lock_not_available while A holds the row',
        );
        const [unchanged] = await b.unsafe(
          `SELECT value FROM ${table} WHERE id = 1`,
        );
        assert.equal(unchanged.value, 0);
        console.log(
          'PASS contention: B rejected with SQLSTATE 55P03 while A holds the row; value=0',
        );
        await a`ROLLBACK`;
        transaction = false;
        const [updated] = await b.unsafe(
          `UPDATE ${table} SET value = value + 1 WHERE id = 1 RETURNING value`,
        );
        assert.equal(updated.value, 1);
        const [visible] = await a.unsafe(
          `SELECT value FROM ${table} WHERE id = 1`,
        );
        assert.equal(visible.value, 1);
        console.log(
          'PASS recovery: B writes after A rolls back; A observes value=1',
        );
      } finally {
        try {
          if (transaction) await a`ROLLBACK`;
          if (created) {
            await a.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
            const [remaining] =
              await a`SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname = ${schema}`;
            assert.equal(remaining.count, 0);
            console.log('PASS cleanup: isolated synthetic schema removed');
          }
        } finally {
          b.release();
        }
      }
    } finally {
      a.release();
    }
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') {
  console.log(help);
} else {
  try {
    if (process.argv.length > 2)
      throw new Error('Unknown arguments. Use --help.');
    await smoke();
  } catch (error) {
    console.error(
      `FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
