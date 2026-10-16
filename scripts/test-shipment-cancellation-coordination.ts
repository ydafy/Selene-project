import { SQL } from 'bun';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const canonical = `${root}supabase/queries/orders/shipment_cancellation_coordination.sql`;
const help =
  'Usage: bun scripts/test-shipment-cancellation-coordination.ts [--help]\n' +
  'B1.1 only: real SQL claim/start, ownership, expiry and contention in a new disposable local database.\n' +
  'Uses only 127.0.0.1, selene_test credentials and SELENE_TEST_PG_PORT (default 55432).';

type Claim = {
  status: string;
  operation_key: string;
  claim_token?: string;
  source: string;
  actor_id: string | null;
  reason: string;
};
const ids = {
  order: '10000000-0000-4000-8000-000000000001',
  buyer: '20000000-0000-4000-8000-000000000001',
  seller: '20000000-0000-4000-8000-000000000002',
  stranger: '20000000-0000-4000-8000-000000000003',
  shipment: '30000000-0000-4000-8000-000000000001',
  sibling: '30000000-0000-4000-8000-000000000002',
};

async function run() {
  const rawPort = process.env.SELENE_TEST_PG_PORT ?? '55432';
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error(
      'SELENE_TEST_PG_PORT must be an integer between 1 and 65535.',
    );
  // Never consume application URLs, hosts or credentials.
  const url = (database: string) =>
    `postgres://selene_test:selene_local_test_only@127.0.0.1:${port}/${database}?sslmode=disable`;
  const admin = new SQL(url('selene_test'), { max: 1, connectionTimeout: 5 });
  const database = `b11_${crypto.randomUUID().replaceAll('-', '')}`;
  const createdRoles: string[] = [];
  let created = false;
  let sql: SQL | undefined;
  try {
    const [server] =
      await admin`SELECT current_database() AS db, current_user AS role, current_setting('server_version_num')::integer AS version`;
    assert.equal(server.db, 'selene_test');
    assert.equal(server.role, 'selene_test');
    assert.ok(server.version >= 170000 && server.version < 180000);
    // Serialize role-stub ownership across independent executions of this harness.
    await admin`SELECT pg_advisory_lock(11110001)`;
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const existing =
        await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`;
      if (existing.length === 0) {
        await admin.unsafe(`CREATE ROLE ${role} NOLOGIN`);
        createdRoles.push(role);
      }
    }
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    created = true;
    sql = new SQL(url(database), { max: 2, connectionTimeout: 5 });
    const a = await sql.reserve();
    const b = await sql.reserve();
    try {
      for (const connection of [a, b]) {
        await connection`SET statement_timeout = '5s'`;
        await connection`SET idle_in_transaction_session_timeout = '15s'`;
        await connection`SELECT set_config('request.jwt.claim.role', 'service_role', false)`;
      }
      // Deliberately minimal fixtures, not a replica of Supabase or its full migrations.
      await a.unsafe(`
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
          SELECT current_setting('request.jwt.claim.role', true)
        $$;
        CREATE TYPE public.order_status_enum AS ENUM ('pending','paid','preparing','shipped','delivered','completed','cancelled','dispute','refunded');
        CREATE TABLE public.orders (id uuid PRIMARY KEY, buyer_id uuid NOT NULL);
        CREATE TABLE public.shipments (
          id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id), seller_id uuid NOT NULL,
          status public.order_status_enum NOT NULL, stripe_transfer_id text, stripe_payout_id text,
          label_generation_state text NOT NULL DEFAULT 'unclaimed',
          claim_token uuid, claim_expires_at timestamptz
        );
        INSERT INTO public.orders VALUES ('${ids.order}', '${ids.buyer}');
        INSERT INTO public.shipments (id,order_id,seller_id,status) VALUES
          ('${ids.shipment}','${ids.order}','${ids.seller}','paid'),
          ('${ids.sibling}','${ids.order}','${ids.seller}','paid');
      `);
      const migration = readdirSync(`${root}supabase/migrations`).find((name) =>
        name.endsWith('_shipment_cancellation_coordination.sql'),
      );
      if (existsSync(canonical)) {
        assert.ok(migration, 'CLI-created migration must exist');
        const source = readFileSync(canonical, 'utf8');
        assert.equal(
          source,
          readFileSync(`${root}supabase/migrations/${migration}`, 'utf8'),
          'canonical SQL and migration must be identical',
        );
        await a.unsafe(source);
      }
      const [pidA] = await a`SELECT pg_backend_pid() AS pid`;
      const [pidB] = await b`SELECT pg_backend_pid() AS pid`;
      assert.notEqual(pidA.pid, pidB.pid);
      const claim = async (
        connection = a,
        actor: string | null = ids.buyer,
        source = 'buyer',
        shipment = ids.shipment,
        order = ids.order,
        reason = 'first reason',
      ): Promise<Claim> => {
        const [row] =
          await connection`SELECT public.fn_claim_shipment_cancellation(${shipment}::uuid, ${order}::uuid, ${actor}::uuid, ${source}, ${reason}) AS result`;
        return row.result as Claim;
      };
      const start = async (token: string, connection = a) => {
        const [row] =
          await connection`SELECT public.fn_start_shipment_cancellation(${ids.shipment}::uuid, ${token}::uuid) AS result`;
        return row.result;
      };
      const snapshot = async (connection = a) => {
        const [row] = await connection`SELECT jsonb_build_object(
          'orders', (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.orders o),
          'shipments', (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.shipments s),
          'operations', (SELECT jsonb_agg(to_jsonb(c) ORDER BY shipment_id) FROM public.shipment_cancellation_operations c)
        ) AS data`;
        return row.data;
      };
      const rejectsUnchanged = async (
        action: () => Promise<unknown>,
        message: string,
        code = 'P0001',
        connection = a,
      ) => {
        const before = await snapshot(connection);
        await assert.rejects(action, (error: unknown) => {
          assert.ok(
            error &&
              typeof error === 'object' &&
              'errno' in error &&
              'message' in error,
          );
          assert.equal(error.errno, code);
          assert.equal(error.message, message);
          return true;
        });
        assert.deepEqual(
          await snapshot(connection),
          before,
          `Rejected ${message} must leave all fixture data unchanged`,
        );
      };
      // First public call also supplies meaningful RED before the migration exists.
      let owner = await claim();
      assert.equal(owner.status, 'claimed');
      assert.equal(owner.operation_key, `cancel_shipment_${ids.shipment}`);
      assert.ok(owner.claim_token);
      assert.equal(owner.source, 'buyer');
      assert.equal(owner.actor_id, ids.buyer);
      assert.equal(owner.reason, 'first reason');
      console.log(
        'PASS claim: stable shipment identity and server-validated context',
      );

      const reserved = await snapshot();
      const busy = await claim(
        b,
        ids.seller,
        'seller',
        ids.shipment,
        ids.order,
        'changed reason',
      );
      assert.equal(busy.status, 'busy');
      assert.equal(busy.claim_token, undefined);
      assert.equal(busy.reason, 'first reason');
      assert.equal(busy.source, 'buyer');
      assert.equal(busy.actor_id, ids.buyer);
      assert.deepEqual(await snapshot(), reserved);
      const sibling = await claim(a, ids.seller, 'seller', ids.sibling);
      assert.equal(sibling.status, 'claimed');
      assert.notEqual(sibling.operation_key, owner.operation_key);
      console.log(
        'PASS repeat: one owner, frozen context and independent sibling',
      );

      // Time fixture only: make the persisted pre-call lease explicitly expired.
      await a`UPDATE public.shipment_cancellation_operations SET claim_expires_at = '-infinity' WHERE shipment_id = ${ids.shipment}::uuid`;
      await rejectsUnchanged(
        () => start(owner.claim_token!),
        'CANCELLATION_CLAIM_EXPIRED',
      );
      const oldToken = owner.claim_token;
      owner = await claim(
        b,
        null,
        'paid_timeout',
        ids.shipment,
        ids.order,
        'cron reason',
      );
      assert.equal(owner.status, 'claimed');
      assert.notEqual(owner.claim_token, oldToken);
      assert.equal(owner.operation_key, `cancel_shipment_${ids.shipment}`);
      assert.equal(owner.source, 'buyer');
      assert.equal(owner.actor_id, ids.buyer);
      assert.equal(owner.reason, 'first reason');
      await rejectsUnchanged(
        () => start(oldToken!),
        'STALE_CANCELLATION_CLAIM',
      );
      console.log(
        'PASS expiry: only pre-call lease reclaims; stale owner rejected',
      );

      await a`UPDATE public.shipments SET label_generation_state = 'claimed' WHERE id = ${ids.shipment}::uuid`;
      await rejectsUnchanged(
        () => start(owner.claim_token!),
        'SHIPMENT_LABEL_OPERATION_ACTIVE',
      );
      await a`UPDATE public.shipments SET label_generation_state = 'unclaimed' WHERE id = ${ids.shipment}::uuid`;
      assert.equal(await start(owner.claim_token!), true);
      await rejectsUnchanged(
        () => start(owner.claim_token!),
        'CANCELLATION_EXTERNAL_ALREADY_STARTED',
      );
      await a`UPDATE public.shipment_cancellation_operations SET claim_expires_at = '-infinity' WHERE shipment_id = ${ids.shipment}::uuid`;
      const fenced = await snapshot();
      const recovery = await claim();
      assert.equal(recovery.status, 'recovery_required');
      assert.equal(recovery.claim_token, undefined);
      assert.deepEqual(await snapshot(), fenced);
      console.log(
        'PASS external fence: start once; TTL never authorizes another call',
      );

      // New synthetic fixture set for each rejection/concurrency rule.
      const reset = async () => {
        await a`TRUNCATE public.shipment_cancellation_operations`;
        await a`UPDATE public.shipments SET status = 'paid', label_generation_state = 'unclaimed', stripe_transfer_id = NULL, stripe_payout_id = NULL`;
      };
      await reset();
      for (const role of ['anon', 'authenticated']) {
        await a.unsafe(`SET ROLE ${role}`);
        try {
          await assert.rejects(
            () => claim(),
            (error: unknown) =>
              !!error &&
              typeof error === 'object' &&
              'errno' in error &&
              error.errno === '42501',
          );
          await assert.rejects(
            () => start(crypto.randomUUID()),
            (error: unknown) =>
              !!error &&
              typeof error === 'object' &&
              'errno' in error &&
              error.errno === '42501',
          );
          await assert.rejects(
            () => a`SELECT * FROM public.shipment_cancellation_operations`,
            (error: unknown) =>
              !!error &&
              typeof error === 'object' &&
              'errno' in error &&
              error.errno === '42501',
          );
        } finally {
          await a`RESET ROLE`;
        }
      }
      await a`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`;
      await rejectsUnchanged(() => claim(), 'UNAUTHORIZED');
      await rejectsUnchanged(() => start(crypto.randomUUID()), 'UNAUTHORIZED');
      await a`SELECT set_config('request.jwt.claim.role', 'service_role', false)`;
      await rejectsUnchanged(
        () => claim(a, ids.stranger),
        'ORDER_BUYER_MISMATCH',
      );
      await rejectsUnchanged(
        () => claim(a, ids.stranger, 'seller'),
        'SHIPMENT_SELLER_MISMATCH',
      );
      await rejectsUnchanged(
        () => claim(a, null),
        'INVALID_CANCELLATION_CONTEXT',
      );
      await rejectsUnchanged(
        () => claim(a, ids.buyer, 'paid_timeout'),
        'INVALID_CANCELLATION_CONTEXT',
      );
      await rejectsUnchanged(
        () => claim(a, null, 'other'),
        'INVALID_CANCELLATION_CONTEXT',
      );
      await rejectsUnchanged(
        () => claim(a, ids.buyer, 'buyer', ids.shipment, ids.order, ' '),
        'INVALID_CANCELLATION_CONTEXT',
      );
      await rejectsUnchanged(
        () => claim(a, ids.buyer, 'buyer', ids.shipment, ids.stranger),
        'SHIPMENT_ORDER_MISMATCH',
      );
      await rejectsUnchanged(
        () => claim(a, ids.buyer, 'buyer', ids.stranger),
        'SHIPMENT_NOT_FOUND',
      );
      console.log(
        'PASS authorization: service-only RPCs; invalid context has no effects',
      );

      for (const status of [
        'pending',
        'preparing',
        'shipped',
        'delivered',
        'completed',
        'cancelled',
        'dispute',
        'refunded',
      ]) {
        await a`UPDATE public.shipments SET status = ${status}::public.order_status_enum WHERE id = ${ids.shipment}::uuid`;
        await rejectsUnchanged(() => claim(), 'SHIPMENT_NOT_CANCELABLE');
        await rejectsUnchanged(
          () => claim(a, ids.seller, 'seller'),
          'SHIPMENT_NOT_CANCELABLE',
        );
      }
      await reset();
      for (const state of [
        'claimed',
        'generation_sent',
        'orphan_pending',
        'generated',
      ]) {
        await a`UPDATE public.shipments SET label_generation_state = ${state} WHERE id = ${ids.shipment}::uuid`;
        await rejectsUnchanged(
          () => claim(),
          'SHIPMENT_LABEL_OPERATION_ACTIVE',
        );
      }
      await reset();
      for (const field of ['stripe_transfer_id', 'stripe_payout_id']) {
        await a.unsafe(
          `UPDATE public.shipments SET ${field} = 'provider_reference' WHERE id = '${ids.shipment}'`,
        );
        await rejectsUnchanged(
          () => claim(),
          'SHIPMENT_FUNDS_ALREADY_RELEASED',
        );
        await a.unsafe(
          `UPDATE public.shipments SET ${field} = NULL WHERE id = '${ids.shipment}'`,
        );
      }
      await a`UPDATE public.shipments SET status = 'preparing', label_generation_state = 'generated' WHERE id = ${ids.shipment}::uuid`;
      const preparing = await claim(a, null, 'preparing_timeout');
      assert.equal(preparing.status, 'claimed');
      assert.equal(preparing.source, 'preparing_timeout');
      console.log(
        'PASS state guards: manual paid-only; persisted label/funds blockers; cron context separate',
      );

      await reset();
      // A holds the *RPC's* shipment lock until COMMIT. B must really contend.
      await a`BEGIN`;
      try {
        owner = await claim();
        await b`SET lock_timeout = '150ms'`;
        await assert.rejects(
          () => claim(b, null, 'paid_timeout'),
          (error: unknown) =>
            !!error &&
            typeof error === 'object' &&
            'errno' in error &&
            error.errno === '55P03',
        );
        await a`COMMIT`;
      } catch (error) {
        await a`ROLLBACK`;
        throw error;
      }
      await b`SET lock_timeout = '0'`;
      const afterCommit = await snapshot();
      assert.equal((await claim(b, null, 'paid_timeout')).status, 'busy');
      assert.deepEqual(await snapshot(), afterCommit);
      await b.unsafe('SET ROLE service_role');
      try {
        assert.equal(await start(owner.claim_token!, b), true);
        await assert.rejects(
          () =>
            b`UPDATE public.shipment_cancellation_operations SET external_started_at = NULL`,
          (error: unknown) =>
            !!error &&
            typeof error === 'object' &&
            'errno' in error &&
            error.errno === '42501',
        );
      } finally {
        await b`RESET ROLE`;
      }
      const final = await snapshot();
      assert.deepEqual(final.orders, afterCommit.orders);
      assert.deepEqual(final.shipments, afterCommit.shipments);
      console.log(
        'PASS concurrency: real RPC row-lock contention; loser busy after winner commits',
      );
      console.log(
        'PASS business isolation: no shipment/order mutation or provider calls',
      );
    } finally {
      try {
        await a`ROLLBACK`;
      } finally {
        b.release();
        a.release();
      }
    }
  } finally {
    if (sql) await sql.close({ timeout: 1 });
    try {
      if (created) await admin.unsafe(`DROP DATABASE "${database}"`);
      for (const role of createdRoles.reverse())
        await admin.unsafe(`DROP ROLE ${role}`);
      if (created)
        console.log(
          'PASS cleanup: only generated local database and owned role stubs removed',
        );
    } finally {
      await admin.close({ timeout: 1 });
    }
  }
}

if (process.argv.length === 3 && process.argv[2] === '--help')
  console.log(help);
else {
  try {
    if (process.argv.length > 2)
      throw new Error('Unknown arguments. Use --help.');
    await run();
  } catch (error) {
    console.error(
      `FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
