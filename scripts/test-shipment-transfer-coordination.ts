import { SQL } from 'bun';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const help =
  'Usage: bun scripts/test-shipment-transfer-coordination.ts [--help]\n' +
  'B1.3 transfer SQL: public RPC arbitration, ownership, uncertainty and preservation in a disposable local database.\n' +
  'Uses only 127.0.0.1, selene_test credentials and SELENE_TEST_PG_PORT (default 55432).';
const ids = {
  order: '10000000-0000-4000-8000-000000000001',
  buyer: '20000000-0000-4000-8000-000000000001',
  seller: '20000000-0000-4000-8000-000000000002',
  shipment: '30000000-0000-4000-8000-000000000001',
  sibling: '30000000-0000-4000-8000-000000000002',
  run: '40000000-0000-4000-8000-000000000001',
  other: '40000000-0000-4000-8000-000000000002',
};
const source = (path: string) => readFileSync(`${root}${path}`, 'utf8');
function definition(path: string, name: string) {
  const match = source(path).match(
    new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`,
      'i',
    ),
  );
  assert.ok(match, `Missing production function ${name}`);
  return match[0];
}

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
  const url = (db: string) =>
    `postgres://selene_test:selene_local_test_only@127.0.0.1:${port}/${db}?sslmode=disable`;
  const admin = new SQL(url('selene_test'), { max: 1, connectionTimeout: 5 });
  const database = `b13t_${crypto.randomUUID().replaceAll('-', '')}`;
  const roles: string[] = [];
  let created = false;
  let sql: SQL | undefined;
  try {
    const [server] =
      await admin`SELECT current_database() AS db, current_user AS role, current_setting('server_version_num')::integer AS version`;
    assert.equal(server.db, 'selene_test');
    assert.equal(server.role, 'selene_test');
    assert.ok(server.version >= 170000 && server.version < 180000);
    // Same role-stub ownership serialization as the cancellation harness.
    await admin`SELECT pg_advisory_lock(11110001)`;
    for (const role of ['anon', 'authenticated', 'service_role']) {
      if (
        (await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`).length ===
        0
      ) {
        await admin.unsafe(`CREATE ROLE ${role} NOLOGIN`);
        roles.push(role);
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
      // Minimal synthetic schema, using deployed column contracts; no application data.
      await a.unsafe(`
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
          SELECT current_setting('request.jwt.claim.role', true)
        $$;
        CREATE TYPE public.order_status_enum AS ENUM ('pending','paid','preparing','shipped','delivered','completed','cancelled','dispute','refunded');
        CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text);
        CREATE TABLE public.profiles_private (id uuid PRIMARY KEY, stripe_account_id text, stripe_onboarding_status text);
        CREATE TABLE public.orders (id uuid PRIMARY KEY, buyer_id uuid, stripe_payment_intent_id text, stripe_charge_id text, stripe_transfer_group text);
        CREATE TABLE public.shipments (id uuid PRIMARY KEY, order_id uuid REFERENCES public.orders(id), seller_id uuid,
          status public.order_status_enum, completed_at timestamptz, stripe_payment_intent_id text,
          stripe_transfer_id text, stripe_payout_id text, shipping_cost integer,
          label_generation_state text DEFAULT 'unclaimed', updated_at timestamptz);
        CREATE TABLE public.order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shipment_id uuid, net_payout numeric);
        CREATE TABLE public.disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shipment_id uuid, status text);
        CREATE TABLE public.connect_account_actionability (stripe_account_id text PRIMARY KEY, is_actionable boolean, blocked_reason text);
        INSERT INTO public.profiles VALUES ('${ids.buyer}', 'buyer'), ('${ids.seller}', 'seller');
        INSERT INTO public.profiles_private VALUES ('${ids.seller}', 'acct_seller', 'complete');
        INSERT INTO public.orders VALUES ('${ids.order}', '${ids.buyer}', 'pi_order', 'ch_order', 'group_order');
        INSERT INTO public.shipments (id,order_id,seller_id,status,completed_at,stripe_payment_intent_id,shipping_cost) VALUES
          ('${ids.shipment}', '${ids.order}', '${ids.seller}', 'completed', now(), 'pi_order', 100),
          ('${ids.sibling}', '${ids.order}', '${ids.seller}', 'completed', now(), 'pi_order', 100);
        INSERT INTO public.order_items (shipment_id,net_payout) VALUES ('${ids.shipment}', 100), ('${ids.sibling}', 100);
      `);
      await a.unsafe(
        source(
          'supabase/migrations/20260621000000_connect_manual_payout_release.sql',
        ),
      );
      await a.unsafe(
        source(
          'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql',
        ),
      );
      await a.unsafe(`ALTER TABLE public.connect_payout_runs
        ADD COLUMN release_stage text, ADD COLUMN release_stage_version integer NOT NULL DEFAULT 1,
        ADD COLUMN payout_claim_token text, ADD COLUMN payout_claim_expires_at timestamptz,
        ADD COLUMN payout_create_attempted_at timestamptz, ADD COLUMN action_required_reason text;
        ${definition('supabase/migrations/20260919100000_connect_account_actionability.sql', 'fn_get_connect_account_actionability')}
        ${definition('supabase/migrations/20260919090000_connect_payout_stage_fencing.sql', 'fn_begin_manual_payout_create_fence')}
      `);
      const resumeSql = source(
        'supabase/migrations/20261008090000_atomic_payout_resume_mapping.sql',
      );
      await a.unsafe(resumeSql);
      const cancellationSql = source(
        'supabase/queries/orders/shipment_cancellation_coordination.sql',
      );
      await a.unsafe(cancellationSql);
      await a.unsafe(
        source(
          'supabase/queries/orders/shipment_cancellation_refund_request.sql',
        ),
      );
      const claim = async (connection = a, shipment = ids.shipment) => {
        const [row] =
          await connection`SELECT public.fn_claim_shipment_cancellation(${shipment}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'reason') AS result`;
        return row.result;
      };
      const startCancellation = async (token: string, connection = a) => {
        const request = {
          payment_intent: 'pi_order',
          amount: 11000,
          reason: 'requested_by_customer',
          metadata: {
            shipment_id: ids.shipment,
            order_id: ids.order,
            caller_role: 'buyer',
            reason: 'reason',
            seguro_share_cents: 1000,
          },
        };
        const [row] =
          await connection`SELECT public.fn_start_shipment_cancellation_refund(${ids.shipment}::uuid, ${token}::uuid, ${JSON.stringify(request)}::text::jsonb, 400::bigint) AS result`;
        return row.result;
      };
      const begin = async (
        connection = a,
        shipment = ids.shipment,
        version: number | null = 1,
        runId = ids.run,
      ) => {
        const [row] =
          await connection`SELECT public.fn_begin_shipment_transfer(${runId}::uuid, ${shipment}::uuid, ${version}::integer) AS result`;
        return row.result;
      };
      const finish = async (
        token: string | null,
        transfer: string | null = 'tr_one',
        version: number | null = 1,
        runId = ids.run,
        connection = a,
      ) => {
        const [row] =
          await connection`SELECT public.fn_complete_shipment_transfer(${runId}::uuid, ${ids.shipment}::uuid, ${version}::integer, ${token}::uuid, ${transfer}::text) AS result`;
        return row.result;
      };
      const tables = [
        'orders',
        'shipments',
        'profiles',
        'profiles_private',
        'order_items',
        'disputes',
        'connect_account_actionability',
        'connect_payout_runs',
        'connect_payout_run_shipments',
        'shipment_cancellation_operations',
      ];
      const snapshot = async () => {
        const values: Record<string, unknown> = {};
        for (const table of tables) {
          const [row] = await a.unsafe(
            `SELECT jsonb_agg(data ORDER BY data::text) AS data FROM (SELECT to_jsonb(t) AS data FROM public.${table} t) rows`,
          );
          values[table] = row.data;
        }
        return values;
      };
      const rejects = async (
        action: () => Promise<unknown>,
        message: string,
        code = 'P0001',
      ) => {
        const before = await snapshot();
        await assert.rejects(action, (e: unknown) => {
          assert.ok(
            e && typeof e === 'object' && 'message' in e && 'errno' in e,
          );
          assert.equal(e.message, message);
          assert.equal(e.errno, code);
          return true;
        });
        assert.deepEqual(await snapshot(), before);
      };
      const unchanged = async (
        action: () => Promise<unknown>,
        expected: unknown,
      ) => {
        const before = await snapshot();
        assert.deepEqual(await action(), expected);
        assert.deepEqual(await snapshot(), before);
      };
      const reset = async () => {
        await a`TRUNCATE public.shipment_cancellation_operations, public.connect_payout_run_shipments, public.connect_payout_runs CASCADE`;
        await a`UPDATE public.shipments SET status = 'completed', completed_at = '2026-01-01', stripe_transfer_id = NULL, stripe_payout_id = NULL, label_generation_state = 'unclaimed'`;
        await a`UPDATE public.profiles_private SET stripe_onboarding_status = 'complete'`;
        await a`DELETE FROM public.connect_account_actionability`;
        await a`DELETE FROM public.disputes`;
        await a`INSERT INTO public.connect_payout_runs (id,idempotency_key,seller_id,actor_id,amount,release_stage) VALUES (${ids.run}::uuid,'release-key',${ids.seller}::uuid,${ids.buyer}::uuid,20000,'release_accepted')`;
        await a`INSERT INTO public.connect_payout_run_shipments (run_id,shipment_id,net_payout) VALUES (${ids.run}::uuid,${ids.shipment}::uuid,10000), (${ids.run}::uuid,${ids.sibling}::uuid,10000)`;
      };
      // Same public inputs against migration-defined previous and new cancellation
      // bodies. Existing mappings alone are deliberately NOT transfer-start proof.
      const preservation = async () => {
        await reset();
        await a`UPDATE public.shipments SET status = 'paid'`;
        await rejects(() => claim(a, ids.other), 'SHIPMENT_NOT_FOUND');
        const owner = await claim();
        assert.equal(owner.status, 'claimed');
        assert.equal(owner.operation_key, `cancel_shipment_${ids.shipment}`);
        await unchanged(async () => (await claim()).status, 'busy');
        await startCancellation(owner.claim_token);
        await unchanged(
          async () => (await claim()).status,
          'recovery_required',
        );
        await reset();
        const [resumed] =
          await a`SELECT public.fn_atomic_payout_resume_mapping(${ids.run}::uuid,'retry','pending_reconciliation','release_accepted',1,ARRAY[${ids.shipment}::uuid,${ids.sibling}::uuid],NULL,NULL,NULL) AS result`;
        assert.equal(resumed.result, 2);
        const [fenced] =
          await a`SELECT public.fn_begin_manual_payout_create_fence(${ids.run}::uuid) AS result`;
        assert.equal(fenced.result, 3);
        await reset();
        await a`UPDATE public.shipments SET status = 'completed', stripe_transfer_id = 'tr_existing' WHERE id = ${ids.shipment}::uuid`;
        await rejects(() => claim(), 'SHIPMENT_NOT_CANCELABLE');
        await a`UPDATE public.shipments SET status = 'paid' WHERE id = ${ids.shipment}::uuid`;
        await rejects(() => claim(), 'SHIPMENT_FUNDS_ALREADY_RELEASED');
        return [
          'claimed',
          'busy',
          'recovery_required',
          2,
          3,
          'SHIPMENT_NOT_CANCELABLE',
          'SHIPMENT_FUNDS_ALREADY_RELEASED',
        ];
      };
      const baseline = await preservation();
      const canonical =
        'supabase/queries/payments/shipment_transfer_coordination.sql';
      if (existsSync(`${root}${canonical}`)) {
        const migrations = readdirSync(`${root}supabase/migrations`).filter(
          (name) => name.endsWith('_shipment_transfer_coordination.sql'),
        );
        assert.equal(migrations.length, 1);
        assert.equal(
          source(canonical),
          source(`supabase/migrations/${migrations[0]}`),
        );
        await a.unsafe(source(canonical));
      }
      assert.deepEqual(await preservation(), baseline);
      console.log(
        'PASS differential: previous/current cancellation, refund start, resume and payout fence public contracts',
      );
      await reset();
      // Meaningful RED before SQL: the required public transfer boundary is absent.
      const beforeBegin = await snapshot();
      const started = await begin();
      const afterBegin = await snapshot();
      assert.deepEqual(afterBegin, {
        ...beforeBegin,
        connect_payout_run_shipments: afterBegin.connect_payout_run_shipments,
      });
      const mappingRows =
        await a`SELECT shipment_id, transfer_token, transfer_started_at FROM public.connect_payout_run_shipments ORDER BY shipment_id`;
      assert.equal(mappingRows[0].shipment_id, ids.shipment);
      assert.equal(mappingRows[0].transfer_token, started.transfer_token);
      assert.ok(mappingRows[0].transfer_started_at);
      assert.equal(mappingRows[1].transfer_token, null);
      assert.equal(mappingRows[1].transfer_started_at, null);
      assert.equal(
        started.idempotency_key,
        `release-key:${ids.run}:${ids.shipment}`,
      );
      assert.equal(started.amount, 10000);
      assert.equal(started.currency, 'mxn');
      assert.equal(started.destination, 'acct_seller');
      assert.equal(started.source_transaction, 'ch_order');
      assert.equal(started.transfer_group, 'group_order');
      assert.deepEqual(started.metadata, {
        app_name: 'selene',
        run_id: ids.run,
        shipment_id: ids.shipment,
        seller_id: ids.seller,
        order_id: ids.order,
      });
      assert.match(started.transfer_token, /^[0-9a-f-]{36}$/);
      assert.deepEqual(
        Object.keys(started).sort(),
        [
          'transfer_token',
          'amount',
          'currency',
          'destination',
          'source_transaction',
          'transfer_group',
          'idempotency_key',
          'metadata',
        ].sort(),
      );
      await rejects(() => begin(), 'SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED');
      assert.equal((await begin(b, ids.sibling)).amount, 10000);
      await unchanged(() => finish(null), false);
      await unchanged(() => finish(crypto.randomUUID()), false);
      await unchanged(() => finish(started.transfer_token, 'tr_one', 2), false);
      await unchanged(
        () => finish(started.transfer_token, 'tr_one', 1, ids.other),
        false,
      );
      await rejects(
        () => finish(started.transfer_token, ''),
        'MISSING_STRIPE_TRANSFER_ID',
      );
      const beforeFinish = await snapshot();
      assert.equal(await finish(started.transfer_token), true);
      const afterFinish = await snapshot();
      assert.deepEqual(afterFinish, {
        ...beforeFinish,
        shipments: afterFinish.shipments,
      });
      const [finishedShipment] =
        await a`SELECT stripe_transfer_id FROM public.shipments WHERE id = ${ids.shipment}::uuid`;
      assert.equal(finishedShipment.stripe_transfer_id, 'tr_one');
      await unchanged(() => finish(started.transfer_token), true);
      await unchanged(() => finish(started.transfer_token, 'tr_other'), false);
      await rejects(() => begin(), 'SHIPMENT_FUNDS_ALREADY_RELEASED');
      console.log(
        'PASS write-ahead: exact server payload/key, single start, sibling and conditional immutable identity',
      );

      for (const status of [
        'pending',
        'paid',
        'preparing',
        'shipped',
        'delivered',
        'cancelled',
        'dispute',
        'refunded',
      ]) {
        await reset();
        await a`UPDATE public.shipments SET status = ${status}::public.order_status_enum WHERE id = ${ids.shipment}::uuid`;
        await rejects(() => begin(), 'SHIPMENT_NOT_COMPLETED');
      }
      for (const mutation of [
        'UPDATE public.shipments SET completed_at = NULL',
        "UPDATE public.profiles_private SET stripe_onboarding_status = 'pending'",
        'UPDATE public.connect_payout_run_shipments SET net_payout = 9999',
        `INSERT INTO public.disputes (shipment_id,status) VALUES ('${ids.shipment}','open')`,
        "INSERT INTO public.connect_account_actionability VALUES ('acct_seller',false,'payouts_disabled')",
      ]) {
        await reset();
        await a.unsafe(mutation);
        await rejects(
          () => begin(),
          mutation.includes('completed_at')
            ? 'SHIPMENT_NOT_COMPLETED'
            : mutation.includes('actionability')
              ? 'CONNECT_ACCOUNT_NOT_ACTIONABLE'
              : 'SHIPMENT_TRANSFER_INELIGIBLE',
        );
      }
      await reset();
      await rejects(
        () => begin(a, ids.shipment, null),
        'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT',
      );
      await rejects(
        () => begin(a, ids.shipment, 2),
        'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT',
      );
      for (const mutation of [
        "UPDATE public.connect_payout_runs SET payout_claim_token = 'executor', payout_claim_expires_at = '-infinity'",
        "UPDATE public.connect_payout_runs SET release_stage = 'payout_create_in_progress'",
        "UPDATE public.connect_payout_runs SET status = 'failed'",
        "UPDATE public.connect_payout_runs SET stripe_payout_id = 'po_existing'",
      ]) {
        await reset();
        await a.unsafe(mutation);
        await rejects(() => begin(), 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT');
      }
      console.log(
        'PASS eligibility: completed-only, allocation/readiness/actionability and run version/executor/stage authority',
      );

      // Cancellation first is a normal paid fixture; no paid transfer is allowed.
      await reset();
      await a`UPDATE public.shipments SET status = 'paid' WHERE id = ${ids.shipment}::uuid`;
      const owner = await claim();
      await rejects(() => begin(), 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE');
      await startCancellation(owner.claim_token);
      await a`UPDATE public.shipment_cancellation_operations SET claim_expires_at = '-infinity'`;
      await rejects(() => begin(), 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE');
      // Explicit legacy-corruption fixture: an expired PRE-start cancellation
      // row on a now completed shipment. This is not a reachable normal flow.
      await a`UPDATE public.shipment_cancellation_operations SET external_started_at = NULL`;
      await a`UPDATE public.shipments SET status = 'completed' WHERE id = ${ids.shipment}::uuid`;
      const beforeExpired =
        await a`SELECT * FROM public.shipment_cancellation_operations`;
      await begin();
      assert.deepEqual(
        await a`SELECT * FROM public.shipment_cancellation_operations`,
        beforeExpired,
      );
      console.log(
        'PASS cancellation-first: live and started-after-TTL fences; expired pre-start context never erased',
      );

      await reset();
      const transferOwner = await begin();
      // Explicit legacy-corruption overlap: completed transferred shipment made
      // paid by an out-of-band writer. Test guards, never enable paid transfers.
      await a`UPDATE public.shipments SET status = 'paid' WHERE id = ${ids.shipment}::uuid`;
      await rejects(() => claim(), 'SHIPMENT_TRANSFER_OPERATION_ACTIVE');
      await a`INSERT INTO public.shipment_cancellation_operations (shipment_id,order_id,source,actor_id,reason,claim_token,claim_expires_at)
        VALUES (${ids.shipment}::uuid,${ids.order}::uuid,'buyer',${ids.buyer}::uuid,'reason',${crypto.randomUUID()}::uuid,clock_timestamp() + interval '15 minutes')`;
      const [legacyOwner] =
        await a`SELECT claim_token FROM public.shipment_cancellation_operations`;
      await rejects(
        () => startCancellation(legacyOwner.claim_token),
        'SHIPMENT_TRANSFER_OPERATION_ACTIVE',
      );
      // Even if payout reconciliation changes mapping/run status or a lease
      // lapses, the possible transfer effect is not undone or retried.
      await a`UPDATE public.connect_payout_run_shipments SET status = 'failed'`;
      await a`UPDATE public.connect_payout_runs SET status = 'failed', payout_claim_expires_at = '-infinity'`;
      await rejects(() => claim(), 'SHIPMENT_TRANSFER_OPERATION_ACTIVE');
      await unchanged(() => finish(transferOwner.transfer_token), false);
      console.log(
        'PASS transfer uncertainty: no stored Stripe ID needed; mapping terminal state/TTL cannot reopen cancellation',
      );
      await a`UPDATE public.shipments SET status = 'completed' WHERE id = ${ids.shipment}::uuid`;
      await a`UPDATE public.shipment_cancellation_operations SET claim_expires_at = '-infinity'`;
      await a`INSERT INTO public.connect_payout_runs (id,idempotency_key,seller_id,actor_id,amount,release_stage)
        VALUES (${ids.other}::uuid,'other-key',${ids.seller}::uuid,${ids.buyer}::uuid,10000,'release_accepted')`;
      await a`INSERT INTO public.connect_payout_run_shipments (run_id,shipment_id,net_payout)
        VALUES (${ids.other}::uuid,${ids.shipment}::uuid,10000)`;
      await rejects(
        () => begin(a, ids.shipment, 1, ids.other),
        'SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED',
      );
      console.log(
        'PASS historical fence: failed old mapping excludes a different run without a stored Stripe ID',
      );

      // Both genuine contention orders, with legitimate business statuses.
      // Their final eligibility rules are disjoint; do not manufacture paid transfers.
      for (const first of ['cancellation', 'transfer']) {
        await reset();
        if (first === 'cancellation')
          await a`UPDATE public.shipments SET status = 'paid' WHERE id = ${ids.shipment}::uuid`;
        await a`BEGIN`;
        try {
          if (first === 'cancellation') await claim();
          else await begin();
          await b`SET lock_timeout = '150ms'`;
          await rejects(
            first === 'cancellation' ? () => begin(b) : () => claim(b),
            'canceling statement due to lock timeout',
            '55P03',
          );
          await a`COMMIT`;
        } catch (e) {
          await a`ROLLBACK`;
          throw e;
        }
        await b`SET lock_timeout = '0'`;
        await rejects(
          first === 'cancellation' ? () => begin(b) : () => claim(b),
          first === 'cancellation'
            ? 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'
            : 'SHIPMENT_NOT_CANCELABLE',
        );
        assert.equal((await begin(b, ids.sibling)).amount, 10000);
      }
      await reset();
      await a`BEGIN`;
      await begin();
      await a`ROLLBACK`;
      assert.ok((await begin()).transfer_token);
      console.log(
        'PASS contention: both real row-lock orders, sibling progress and transactional rollback',
      );

      // Preserve both original cancellation entry points on the requested new
      // input. This deliberately corrupt paid+transfer-start overlap was not a
      // supported business state; the old bodies accepted it, replacements refuse.
      await reset();
      await begin();
      await a`UPDATE public.shipments SET status = 'paid' WHERE id = ${ids.shipment}::uuid`;
      const replacements = source(canonical);
      for (const name of [
        'fn_claim_shipment_cancellation',
        'fn_start_shipment_cancellation',
      ])
        await a.unsafe(
          definition(
            'supabase/queries/orders/shipment_cancellation_coordination.sql',
            name,
          ),
        );
      await a`BEGIN`;
      try {
        const priorOwner = await claim();
        assert.equal(priorOwner.status, 'claimed');
        assert.equal(
          (await startCancellation(priorOwner.claim_token)).operation_key,
          priorOwner.operation_key,
        );
      } finally {
        await a`ROLLBACK`;
      }
      const oldClaim = await claim();
      for (const name of [
        'fn_claim_shipment_cancellation',
        'fn_start_shipment_cancellation',
      ]) {
        const match = replacements.match(
          new RegExp(
            `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`,
            'i',
          ),
        );
        assert.ok(match);
        await a.unsafe(match[0]);
      }
      await rejects(() => claim(), 'SHIPMENT_TRANSFER_OPERATION_ACTIVE');
      await rejects(
        () => startCancellation(oldClaim.claim_token),
        'SHIPMENT_TRANSFER_OPERATION_ACTIVE',
      );
      console.log(
        'PASS intentional differential: old bodies accepted legacy overlap; new claim/start fence the same input',
      );

      await reset();
      for (const field of ['stripe_transfer_id', 'stripe_payout_id']) {
        await a.unsafe(
          `UPDATE public.shipments SET ${field} = 'stored_reference' WHERE id = '${ids.shipment}'`,
        );
        await rejects(() => begin(), 'SHIPMENT_FUNDS_ALREADY_RELEASED');
        await a.unsafe(
          `UPDATE public.shipments SET ${field} = NULL WHERE id = '${ids.shipment}'`,
        );
      }
      await a`UPDATE public.orders SET stripe_transfer_group = NULL`;
      await a`UPDATE public.connect_payout_run_shipments SET net_payout = 9900`;
      await a`UPDATE public.connect_payout_runs SET amount = 19800`;
      await rejects(() => begin(), 'MISSING_SETTLEMENT_CONTEXT');
      // Existing legacy payout fence remains valid, without a Transfer step.
      const [legacyFence] =
        await a`SELECT public.fn_begin_manual_payout_create_fence(${ids.run}::uuid) AS result`;
      assert.equal(legacyFence.result, 2);
      await a`UPDATE public.orders SET stripe_transfer_group = 'group_order'`;
      console.log(
        'PASS stored references and legacy: no duplicate transfer; no-transfer payout fence preserved',
      );

      // Fake provider seam only: a missing/lost begin response must not trigger
      // create; a successful create whose persistence fails never permits retry.
      await reset();
      const effects = { transfers: 0, persisted: 0 };
      await begin(); // Simulate committed start with lost response; caller has no authority.
      await rejects(() => begin(), 'SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED');
      assert.deepEqual(effects, { transfers: 0, persisted: 0 });
      await reset();
      const uncertain = await begin();
      effects.transfers++;
      await a`UPDATE public.connect_payout_runs SET release_stage_version = 2`;
      await unchanged(() => finish(uncertain.transfer_token), false);
      await rejects(
        () => begin(a, ids.shipment, 2),
        'SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED',
      );
      assert.deepEqual(effects, { transfers: 1, persisted: 0 });
      console.log(
        'PASS ambiguity seam: lost start response and failed post-provider persistence never authorize another create',
      );

      await reset();
      await a`UPDATE public.shipments SET status = 'paid' WHERE id = ${ids.sibling}::uuid`;
      await a`BEGIN`;
      try {
        await begin();
        // Different shipment cancellation succeeds while A still holds its run
        // and shipment locks; no feature-wide lock spans the provider boundary.
        assert.equal((await claim(b, ids.sibling)).status, 'claimed');
      } finally {
        await a`ROLLBACK`;
      }
      console.log(
        'PASS live sibling isolation: cancellation progresses during another shipment transfer transaction',
      );

      await reset();
      const authOwner = await begin();
      for (const role of ['anon', 'authenticated']) {
        const before = await snapshot();
        await a.unsafe(`SET ROLE ${role}`);
        try {
          for (const [name, action] of [
            ['fn_begin_shipment_transfer', () => begin()],
            [
              'fn_complete_shipment_transfer',
              () => finish(authOwner.transfer_token),
            ],
          ] as const) {
            await assert.rejects(action, (e: unknown) => {
              assert.ok(
                e && typeof e === 'object' && 'errno' in e && 'message' in e,
              );
              assert.equal(e.errno, '42501');
              assert.equal(e.message, `permission denied for function ${name}`);
              return true;
            });
          }
        } finally {
          await a`RESET ROLE`;
        }
        assert.deepEqual(await snapshot(), before);
      }
      await a`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`;
      await rejects(() => begin(), 'UNAUTHORIZED');
      await rejects(() => finish(authOwner.transfer_token), 'UNAUTHORIZED');
      await a`SELECT set_config('request.jwt.claim.role', 'service_role', false)`;
      await a`SET ROLE service_role`;
      try {
        assert.equal(await finish(authOwner.transfer_token), true);
      } finally {
        await a`RESET ROLE`;
      }
      console.log(
        'PASS authorization: explicit service grants and body guards; rejected calls leave all ten fixture tables unchanged',
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
      for (const role of roles.reverse())
        await admin.unsafe(`DROP ROLE ${role}`);
      if (created)
        console.log(
          'PASS cleanup: generated local database and owned role stubs removed',
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
  } catch (e) {
    console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
