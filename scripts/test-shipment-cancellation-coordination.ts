import { SQL } from 'bun';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  runShipmentCancellation,
  type CancellationContext,
} from '../supabase/functions/_shared/shipment-cancellation.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const canonical = `${root}supabase/queries/orders/shipment_cancellation_coordination.sql`;
const help =
  'Usage: bun scripts/test-shipment-cancellation-coordination.ts [--help]\n' +
  'B1.1/B1.2 SQL: claim/start, frozen refund request, ownership and contention in a new disposable local database.\n' +
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
        CREATE TABLE public.orders (id uuid PRIMARY KEY, buyer_id uuid NOT NULL, stripe_payment_intent_id text);
        CREATE TABLE public.shipments (
          id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id), seller_id uuid NOT NULL,
          status public.order_status_enum NOT NULL, stripe_transfer_id text, stripe_payout_id text,
          stripe_payment_intent_id text,
          label_generation_state text NOT NULL DEFAULT 'unclaimed',
          claim_token uuid, claim_expires_at timestamptz
        );
        INSERT INTO public.orders VALUES ('${ids.order}', '${ids.buyer}', 'pi_order');
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

      // B1.2 is additive: first prove the original B1.1 contract above, then
      // prove the new entry point and the intentional direct-start revocation.
      const requestCanonical = `${root}supabase/queries/orders/shipment_cancellation_refund_request.sql`;
      if (existsSync(requestCanonical)) {
        const requestMigration = readdirSync(
          `${root}supabase/migrations`,
        ).filter((name) =>
          name.endsWith('_shipment_cancellation_refund_request.sql'),
        );
        assert.equal(requestMigration.length, 1);
        const source = readFileSync(requestCanonical, 'utf8');
        assert.equal(
          source,
          readFileSync(
            `${root}supabase/migrations/${requestMigration[0]}`,
            'utf8',
          ),
        );
        await a.unsafe(source);
      }
      const legacyFence = await snapshot();
      assert.equal((await claim()).status, 'recovery_required');
      assert.deepEqual(await snapshot(), legacyFence);
      assert.equal(legacyFence.operations[0].refund_request, null);
      await reset();
      const request = {
        payment_intent: 'pi_order',
        amount: 11000,
        reason: 'requested_by_customer',
        metadata: {
          shipment_id: ids.shipment,
          order_id: ids.order,
          caller_role: 'buyer',
          reason: 'first reason',
          seguro_share_cents: 1000,
        },
      };
      const startRefund = async (
        token: string | null,
        payload: unknown = request,
        loss: number | null = 400,
        connection = a,
        shipment = ids.shipment,
      ) => {
        const [row] =
          await connection`SELECT public.fn_start_shipment_cancellation_refund(
          ${shipment}::uuid, ${token}::uuid, ${JSON.stringify(payload)}::text::jsonb, ${loss}::bigint
        ) AS result`;
        return row.result;
      };
      owner = await claim();
      // First call supplies RED when B1.2 has not been implemented.
      const beforeRefund = await snapshot();
      const started = await startRefund(owner.claim_token!);
      assert.deepEqual(started, {
        operation_key: owner.operation_key,
        refund_request: request,
        cancellation_loss_cents: 400,
      });
      const afterRefund = await snapshot();
      assert.deepEqual(afterRefund.orders, beforeRefund.orders);
      assert.deepEqual(afterRefund.shipments, beforeRefund.shipments);
      assert.deepEqual(afterRefund.operations[0].refund_request, request);
      assert.equal(
        Number(afterRefund.operations[0].cancellation_loss_cents),
        400,
      );
      assert.ok(afterRefund.operations[0].external_started_at);
      await rejectsUnchanged(
        () => startRefund(owner.claim_token!),
        'CANCELLATION_EXTERNAL_ALREADY_STARTED',
      );
      await a`UPDATE public.shipment_cancellation_operations SET claim_expires_at = '-infinity' WHERE shipment_id = ${ids.shipment}::uuid`;
      const frozen = await snapshot();
      assert.equal(
        (await claim(b, null, 'paid_timeout')).status,
        'recovery_required',
      );
      assert.deepEqual(await snapshot(), frozen);
      await rejectsUnchanged(
        () => startRefund(owner.claim_token!, { ...request, amount: 12000 }),
        'CANCELLATION_EXTERNAL_ALREADY_STARTED',
      );
      console.log(
        'PASS refund snapshot: exact durable request/loss and fence; replay never starts again',
      );

      await reset();
      owner = await claim();
      for (const payload of [
        null,
        [],
        {},
        { ...request, amount: 0 },
        { ...request, amount: -1 },
        { ...request, amount: 1.5 },
        { ...request, amount: '11000' },
        { ...request, amount: 9007199254740992 },
        { ...request, payment_intent: 'pi_other' },
        { ...request, reason: 'fraudulent' },
        { ...request, reverse_transfer: true },
        { ...request, metadata: null },
        {
          ...request,
          metadata: { ...request.metadata, shipment_id: ids.sibling },
        },
        {
          ...request,
          metadata: { ...request.metadata, order_id: ids.stranger },
        },
        {
          ...request,
          metadata: { ...request.metadata, caller_role: 'seller' },
        },
        { ...request, metadata: { ...request.metadata, reason: 'changed' } },
        {
          ...request,
          metadata: { ...request.metadata, seguro_share_cents: -1 },
        },
        {
          ...request,
          metadata: { ...request.metadata, seguro_share_cents: 11001 },
        },
        {
          ...request,
          metadata: { ...request.metadata, seguro_share_cents: 0.5 },
        },
        { ...request, metadata: { ...request.metadata, unexpected: 'value' } },
      ]) {
        await rejectsUnchanged(
          () => startRefund(owner.claim_token!, payload),
          'INVALID_CANCELLATION_REFUND_REQUEST',
        );
      }
      await rejectsUnchanged(
        () => startRefund(owner.claim_token!, request, -1),
        'INVALID_CANCELLATION_LOSS',
      );
      await rejectsUnchanged(
        () => startRefund(null),
        'STALE_CANCELLATION_CLAIM',
      );
      await rejectsUnchanged(
        () => startRefund(crypto.randomUUID()),
        'STALE_CANCELLATION_CLAIM',
      );
      await a`UPDATE public.shipment_cancellation_operations SET claim_expires_at = '-infinity' WHERE shipment_id = ${ids.shipment}::uuid`;
      const staleToken = owner.claim_token;
      await rejectsUnchanged(
        () => startRefund(staleToken!),
        'CANCELLATION_CLAIM_EXPIRED',
      );
      owner = await claim(b, null, 'paid_timeout');
      await rejectsUnchanged(
        () => startRefund(staleToken!),
        'STALE_CANCELLATION_CLAIM',
      );
      assert.equal(owner.source, 'buyer');
      assert.deepEqual(
        (await startRefund(owner.claim_token!, request, null)).refund_request,
        request,
      );
      console.log(
        'PASS request rejection: malformed/context drift/stale claims leave data unchanged; takeover preserves winner',
      );

      await reset();
      owner = await claim();
      for (const [field, value, error] of [
        [
          'label_generation_state',
          'claimed',
          'SHIPMENT_LABEL_OPERATION_ACTIVE',
        ],
        ['stripe_transfer_id', 'tr_1', 'SHIPMENT_FUNDS_ALREADY_RELEASED'],
        ['stripe_payout_id', 'po_1', 'SHIPMENT_FUNDS_ALREADY_RELEASED'],
        ['status', 'shipped', 'SHIPMENT_NOT_CANCELABLE'],
      ]) {
        await a.unsafe(
          `UPDATE public.shipments SET ${field} = '${value}' WHERE id = '${ids.shipment}'`,
        );
        await rejectsUnchanged(() => startRefund(owner.claim_token!), error);
        await a.unsafe(
          `UPDATE public.shipments SET ${field} = ${field === 'status' ? "'paid'" : field === 'label_generation_state' ? "'unclaimed'" : 'NULL'} WHERE id = '${ids.shipment}'`,
        );
      }
      const beforePrivileges = await snapshot();
      for (const role of ['anon', 'authenticated', 'service_role']) {
        await a.unsafe(`SET ROLE ${role}`);
        try {
          await assert.rejects(
            () => start(owner.claim_token!),
            (e: unknown) =>
              !!e &&
              typeof e === 'object' &&
              'errno' in e &&
              e.errno === '42501',
          );
          if (role !== 'service_role') {
            await assert.rejects(
              () => startRefund(owner.claim_token!),
              (e: unknown) =>
                !!e &&
                typeof e === 'object' &&
                'errno' in e &&
                e.errno === '42501',
            );
          }
        } finally {
          await a`RESET ROLE`;
        }
      }
      assert.deepEqual(await snapshot(), beforePrivileges);
      await a`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`;
      await rejectsUnchanged(
        () => startRefund(owner.claim_token!),
        'UNAUTHORIZED',
      );
      await a`SELECT set_config('request.jwt.claim.role', 'service_role', false)`;
      await a`BEGIN`;
      try {
        await a`SET ROLE service_role`;
        await startRefund(owner.claim_token!);
        await a`RESET ROLE`;
        // A's uncommitted start cannot fence a sibling, but B must contend on A.
        const siblingOwner = await claim(b, ids.seller, 'seller', ids.sibling);
        assert.equal(siblingOwner.status, 'claimed');
        await b`SET lock_timeout = '150ms'`;
        await assert.rejects(
          () => startRefund(owner.claim_token!, request, 400, b),
          (e: unknown) =>
            !!e && typeof e === 'object' && 'errno' in e && e.errno === '55P03',
        );
        await a`ROLLBACK`;
      } catch (error) {
        await a`ROLLBACK`;
        throw error;
      }
      await b`SET lock_timeout = '0'`;
      const rolledBack = await snapshot();
      const targetOperation = rolledBack.operations.find(
        (row: { shipment_id: string }) => row.shipment_id === ids.shipment,
      );
      assert.equal(targetOperation.refund_request, null);
      assert.equal(targetOperation.external_started_at, null);
      assert.equal(targetOperation.cancellation_loss_cents, null);
      await b`SET ROLE service_role`;
      try {
        await startRefund(owner.claim_token!, request, 0, b);
      } finally {
        await b`RESET ROLE`;
      }
      await rejectsUnchanged(
        () => startRefund(owner.claim_token!),
        'CANCELLATION_EXTERNAL_ALREADY_STARTED',
      );
      console.log(
        'PASS atomic start: service-only, blockers rechecked, rollback clears snapshot/fence, same-shipment contention and sibling isolation',
      );

      for (const source of ['seller', 'paid_timeout', 'preparing_timeout']) {
        await reset();
        if (source === 'preparing_timeout')
          await a`UPDATE public.shipments SET status = 'preparing', label_generation_state = 'generated' WHERE id = ${ids.shipment}::uuid`;
        await a`UPDATE public.shipments SET stripe_payment_intent_id = 'pi_shipment' WHERE id = ${ids.shipment}::uuid`;
        const context = await claim(
          a,
          source === 'seller' ? ids.seller : null,
          source,
        );
        const contextRequest = {
          ...request,
          payment_intent: 'pi_shipment',
          metadata: {
            ...request.metadata,
            caller_role: source === 'seller' ? 'seller' : 'system',
          },
        };
        await rejectsUnchanged(
          () =>
            startRefund(context.claim_token!, {
              ...contextRequest,
              payment_intent: 'pi_order',
            }),
          'INVALID_CANCELLATION_REFUND_REQUEST',
        );
        assert.deepEqual(
          (await startRefund(context.claim_token!, contextRequest))
            .refund_request,
          contextRequest,
        );
      }
      console.log(
        'PASS caller contexts: seller/paid cron/preparing cron freeze scoped payment identity without changing business state',
      );

      // Exercise the production orchestration with actual SQL RPC arbitration,
      // but synthetic provider/business ports. No Stripe/network is involved.
      await reset();
      const effects = { prepares: 0, refunds: 0, completions: 0 };
      const orchestrate = (
        source: CancellationContext['source'],
        connection = a,
        shipment = ids.shipment,
      ) =>
        runShipmentCancellation({
          context: {
            shipmentId: shipment,
            orderId: ids.order,
            source,
            actorId:
              source === 'paid_timeout'
                ? null
                : source === 'seller'
                  ? ids.seller
                  : ids.buyer,
            reason: 'first reason',
          },
          claim: async (context) =>
            claim(
              connection,
              context.actorId,
              context.source,
              context.shipmentId,
              context.orderId,
              context.reason,
            ),
          prepare: async () => {
            effects.prepares++;
            return {
              paymentIntentId:
                shipment === ids.shipment ? 'pi_shipment' : 'pi_order',
              amountCents: 11000,
              seguroShareCents: 1000,
              cancellationLossCents: 400,
            };
          },
          start: async (input) =>
            startRefund(
              input.claimToken,
              input.refundRequest,
              input.cancellationLossCents,
              connection,
              input.shipmentId,
            ),
          refund: async (payload, options) => {
            effects.refunds++;
            assert.equal(options.idempotencyKey, `cancel_shipment_${shipment}`);
            assert.equal(payload.metadata.shipment_id, shipment);
            return { status: 'succeeded' };
          },
          complete: async () => {
            effects.completions++;
            return true;
          },
        });
      const businessBefore = await snapshot();
      const competing = await Promise.all([
        orchestrate('buyer'),
        orchestrate('paid_timeout', b),
      ]);
      assert.equal(
        competing.filter((result) => result.status === 'cancelled').length,
        1,
      );
      assert.equal(
        competing.filter(
          (result) =>
            result.status === 'busy' || result.status === 'recovery_required',
        ).length,
        1,
      );
      assert.deepEqual(effects, { prepares: 1, refunds: 1, completions: 1 });
      const afterRace = await snapshot();
      assert.equal((await orchestrate('seller')).status, 'recovery_required');
      assert.deepEqual(await snapshot(), afterRace);
      assert.deepEqual(effects, { prepares: 1, refunds: 1, completions: 1 });
      assert.equal(
        (await orchestrate('seller', b, ids.sibling)).status,
        'cancelled',
      );
      assert.deepEqual(effects, { prepares: 2, refunds: 2, completions: 2 });
      const businessAfter = await snapshot();
      assert.deepEqual(businessAfter.shipments, businessBefore.shipments);
      assert.deepEqual(businessAfter.orders, businessBefore.orders);
      console.log(
        'PASS orchestration seam: production helper with real RPC race/repeat/sibling arbitration; fake provider/business ports only',
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
