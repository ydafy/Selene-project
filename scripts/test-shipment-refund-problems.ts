import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-shipment-refund-problems.ts [--help]\n' +
  'B2.4a SQL: the service-only fn_list_shipment_refund_problems lists unresolved refund problems (failed or\n' +
  'canceled refunds, escalated operations without a refund), oldest first, and drops them once resolved.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b420000-0000-4000-8000-000000000001',
};
const productIds = [1, 2, 3, 4].map((n) => `00000000-0000-4000-8000-0000000000b${n}`);
const shipmentId = (n: number) => `7b420000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const paymentIntent = (n: number) => `pi_b24a_${n}`;
const amount = (n: number) => 1000 * n;
const reference = 'SPEI-2026-10-22-0001';

type Tx = SQL;
type Problem = {
  shipment_id: string;
  order_id: string;
  buyer_id: string;
  shipment_status: string;
  kind: string;
  refund_id: string | null;
  refund_failure_reason: string | null;
  amount_owed_cents: string | number;
  payment_intent_id: string;
  since: Date;
};

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

/** Shipments 1..10 of one order; the first four own the seeded products so cancellations can complete. */
async function fixture(tx: Tx) {
  await tx`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id, actual_stripe_fee_cents)
    VALUES (${ids.order}, ${ids.buyer}, 500, '{}'::jsonb, 'paid', 'pi_b24a_order', 500)`;
  for (let n = 1; n <= 10; n++) {
    await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id)
      VALUES (${shipmentId(n)}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent(n)})`;
  }
  for (const [index, product] of productIds.entries()) {
    await tx`INSERT INTO public.order_items (order_id, product_id, seller_id, price_at_purchase, net_payout, shipment_id)
      VALUES (${ids.order}, ${product}, ${ids.seller}, 1000, 900, ${shipmentId(index + 1)})`;
  }
  await tx`UPDATE public.products SET status = 'SOLD' WHERE id IN ${tx(productIds)}`;
  await asService(tx);
}

async function claim(tx: Tx, n: number) {
  const [{ result }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${shipmentId(n)}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'Changed my mind') AS result`;
  return result as { claim_token: string };
}

/** Claims and starts through the real B1 RPCs, so the fence is genuine. */
async function start(tx: Tx, n: number) {
  const { claim_token } = await claim(tx, n);
  const body = {
    payment_intent: paymentIntent(n),
    amount: amount(n),
    reason: 'requested_by_customer',
    metadata: { shipment_id: shipmentId(n), order_id: ids.order, caller_role: 'buyer', reason: 'Changed my mind', seguro_share_cents: 500 },
  };
  await tx`SELECT public.fn_start_shipment_cancellation_refund(
    ${shipmentId(n)}::uuid, ${claim_token}::uuid, ${JSON.stringify(body)}::text::jsonb, 0::bigint)`;
}

async function apply(tx: Tx, n: number, refundId: string, status: string, reason: string | null = null) {
  await tx`SELECT public.fn_apply_shipment_cancellation_refund_event(
    ${shipmentId(n)}::uuid, ${refundId}, ${paymentIntent(n)}, ${amount(n)}::bigint, ${status}, ${reason})`;
}

async function escalate(tx: Tx, n: number, reason: 'refund_not_found' | 'refund_ambiguous') {
  await tx`SELECT public.fn_escalate_shipment_cancellation(${shipmentId(n)}::uuid, ${reason})`;
}

/** Pins a known timestamp as owner, so the oldest-first order is deterministic. */
async function setSince(tx: Tx, n: number, column: 'refund_status_updated_at' | 'recovery_escalated_at', iso: string) {
  await asOwner(tx);
  if (column === 'refund_status_updated_at')
    await tx`UPDATE public.shipment_cancellation_operations SET refund_status_updated_at = ${iso}::timestamptz WHERE shipment_id = ${shipmentId(n)}`;
  else
    await tx`UPDATE public.shipment_cancellation_operations SET recovery_escalated_at = ${iso}::timestamptz WHERE shipment_id = ${shipmentId(n)}`;
  await asService(tx);
}

async function list(tx: Tx) {
  return [...(await tx`SELECT * FROM public.fn_list_shipment_refund_problems()`)] as Problem[];
}

async function resolve(tx: Tx, n: number) {
  await tx`SELECT public.fn_resolve_shipment_cancellation_refund(${shipmentId(n)}::uuid, ${ids.admin}::uuid, ${reference})`;
}

async function rejects(tx: Tx, action: (sp: Tx) => Promise<unknown>, message: string) {
  await assert.rejects(
    tx.savepoint((sp) => action(sp as Tx)),
    (error: Error) => error.message.includes(message),
    `expected ${message}`,
  );
}

/**
 * Shipments 1..4 are the four problem kinds; 5..10 must never be listed: succeeded, pending,
 * claimed only, started but not escalated, escalated with a pending refund, and a failed refund
 * that an admin already resolved.
 */
async function seedScenario(tx: Tx) {
  await start(tx, 1);
  await apply(tx, 1, 're_1', 'pending');
  await apply(tx, 1, 're_1', 'failed', 'lost_or_stolen_card');
  await start(tx, 2);
  await apply(tx, 2, 're_2', 'requires_action');
  await apply(tx, 2, 're_2', 'canceled');
  await start(tx, 3);
  await escalate(tx, 3, 'refund_not_found');
  await start(tx, 4);
  await escalate(tx, 4, 'refund_ambiguous');
  await start(tx, 5);
  await apply(tx, 5, 're_5', 'succeeded');
  await start(tx, 6);
  await apply(tx, 6, 're_6', 'pending');
  await claim(tx, 7);
  await start(tx, 8);
  await start(tx, 9);
  await escalate(tx, 9, 'refund_ambiguous');
  await apply(tx, 9, 're_9', 'pending');
  await start(tx, 10);
  await apply(tx, 10, 're_10', 'failed');
  await resolve(tx, 10);
}

const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  [
    'lists exactly the four problem kinds with the right fields and nothing else, oldest first',
    async (tx) => {
      await seedScenario(tx);
      await setSince(tx, 1, 'refund_status_updated_at', '2026-10-20T10:00:00Z');
      await setSince(tx, 2, 'refund_status_updated_at', '2026-10-18T10:00:00Z');
      await setSince(tx, 3, 'recovery_escalated_at', '2026-10-19T10:00:00Z');
      await setSince(tx, 4, 'recovery_escalated_at', '2026-10-21T10:00:00Z');

      const rows = await list(tx);
      assert.deepEqual(
        rows.map((row) => [row.shipment_id, row.kind]),
        [
          [shipmentId(2), 'refund_canceled'],
          [shipmentId(3), 'refund_not_found'],
          [shipmentId(1), 'refund_failed'],
          [shipmentId(4), 'refund_ambiguous'],
        ],
      );
      const byShipment = new Map(rows.map((row) => [row.shipment_id, row]));
      const failed = byShipment.get(shipmentId(1))!;
      assert.equal(failed.order_id, ids.order);
      assert.equal(failed.buyer_id, ids.buyer);
      assert.equal(failed.shipment_status, 'paid');
      assert.equal(failed.refund_id, 're_1');
      assert.equal(failed.refund_failure_reason, 'lost_or_stolen_card');
      assert.equal(Number(failed.amount_owed_cents), 1000);
      assert.equal(failed.payment_intent_id, paymentIntent(1));
      assert.equal(failed.since.toISOString(), '2026-10-20T10:00:00.000Z');
      const canceled = byShipment.get(shipmentId(2))!;
      assert.equal(canceled.refund_id, 're_2');
      assert.equal(canceled.refund_failure_reason, null);
      assert.equal(Number(canceled.amount_owed_cents), 2000);
      assert.equal(canceled.since.toISOString(), '2026-10-18T10:00:00.000Z');
      for (const [n, since] of [
        [3, '2026-10-19T10:00:00.000Z'],
        [4, '2026-10-21T10:00:00.000Z'],
      ] as const) {
        const row = byShipment.get(shipmentId(n))!;
        assert.equal(row.refund_id, null);
        assert.equal(row.refund_failure_reason, null);
        assert.equal(row.shipment_status, 'paid');
        assert.equal(Number(row.amount_owed_cents), amount(n));
        assert.equal(row.payment_intent_id, paymentIntent(n));
        assert.equal(row.since.toISOString(), since);
      }
    },
  ],
  [
    'is empty when nothing is wrong: succeeded, pending, claimed, started, escalated with a pending refund, resolved',
    async (tx) => {
      assert.deepEqual(await list(tx), []);
      await start(tx, 5);
      await apply(tx, 5, 're_5', 'succeeded');
      await start(tx, 6);
      await apply(tx, 6, 're_6', 'pending');
      await claim(tx, 7);
      await start(tx, 8);
      await start(tx, 9);
      await escalate(tx, 9, 'refund_ambiguous');
      await apply(tx, 9, 're_9', 'requires_action');
      await start(tx, 10);
      await apply(tx, 10, 're_10', 'canceled');
      await resolve(tx, 10);
      assert.deepEqual(await list(tx), []);
    },
  ],
  [
    'ties on since sort by shipment_id; an escalated operation whose refund failed is one refund_failed row, not two',
    async (tx) => {
      await start(tx, 3);
      await escalate(tx, 3, 'refund_not_found');
      await start(tx, 2);
      await escalate(tx, 2, 'refund_ambiguous');
      await start(tx, 1);
      await escalate(tx, 1, 'refund_not_found');
      await apply(tx, 1, 're_1', 'failed', 'expired_or_canceled_card');
      for (const n of [3, 2]) await setSince(tx, n, 'recovery_escalated_at', '2026-10-20T10:00:00Z');
      await setSince(tx, 1, 'refund_status_updated_at', '2026-10-20T10:00:00Z');
      assert.deepEqual(
        (await list(tx)).map((row) => [row.shipment_id, row.kind]),
        [
          [shipmentId(1), 'refund_failed'],
          [shipmentId(2), 'refund_ambiguous'],
          [shipmentId(3), 'refund_not_found'],
        ],
      );
    },
  ],
  [
    'resolved rows disappear from the list, the others stay, and resolving an escalated paid shipment cancels it',
    async (tx) => {
      await seedScenario(tx);
      assert.equal((await list(tx)).length, 4);
      await resolve(tx, 3);
      assert.deepEqual(
        (await list(tx)).map((row) => row.shipment_id).sort(),
        [shipmentId(1), shipmentId(2), shipmentId(4)],
      );
      const [shipment] = await tx`SELECT status FROM public.shipments WHERE id = ${shipmentId(3)}`;
      assert.equal(shipment.status, 'cancelled');
      await resolve(tx, 1);
      await resolve(tx, 2);
      await resolve(tx, 4);
      assert.deepEqual(await list(tx), []);
    },
  ],
  [
    'the RPC is a SECURITY DEFINER with an empty search_path executable only by service_role',
    async (tx) => {
      const sig = 'public.fn_list_shipment_refund_problems()';
      const [row] = await tx`SELECT
          has_function_privilege('anon', ${sig}, 'EXECUTE') AS anon,
          has_function_privilege('authenticated', ${sig}, 'EXECUTE') AS authed,
          has_function_privilege('service_role', ${sig}, 'EXECUTE') AS service,
          p.prosecdef AS definer, p.proconfig AS config, p.proacl::text AS acl
        FROM pg_proc p WHERE p.oid = ${sig}::regprocedure`;
      assert.equal(row.anon, false);
      assert.equal(row.authed, false);
      assert.equal(row.service, true);
      assert.equal(row.definer, true);
      assert.deepEqual(row.config, ['search_path=""']);
      // An ACL entry starting with "=" is PUBLIC.
      assert.ok(!/[{,]=X/.test(row.acl), `PUBLIC must not execute: ${row.acl}`);
    },
  ],
  [
    'authenticated and anon cannot list refund problems (permission denied)',
    async (tx) => {
      for (const role of ['authenticated', 'anon']) {
        await asOwner(tx);
        await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ role })}, true)`;
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await rejects(tx, (sp) => list(sp), 'permission denied');
      }
    },
  ],
  [
    'service_role may list, and a caller without the service_role claim is refused by the body',
    async (tx) => {
      assert.deepEqual(await list(tx), []);
      await tx`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await rejects(tx, (sp) => list(sp), 'UNAUTHORIZED');
    },
  ],
];

async function run() {
  const sql = new SQL(databaseUrl(), { max: 1, connectionTimeout: 5 });
  let failed = 0;
  try {
    for (const [name, body] of cases) {
      try {
        await sql.begin(async (tx) => {
          await fixture(tx as Tx);
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
    // Every case rolled back: nothing from this harness may persist.
    const [left] = await sql`SELECT count(*)::int AS n FROM public.orders WHERE id = ${ids.order}`;
    assert.equal(left.n, 0);
  } finally {
    await sql.close();
  }
  console.log(`${cases.length - failed} pass, ${failed} fail`);
  if (failed) process.exit(1);
}

if (process.argv.includes('--help')) console.log(help);
else await run();
