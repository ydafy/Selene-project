import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-shipment-cancellation-refund-status.ts [--help]\n' +
  "B2.1+B2.2+B2.2.1 SQL: per-shipment refund ID/status on the cancellation operation, fn_cancel_shipment's refund guard,\n" +
  'the service-only fn_get_shipment_cancellation_recovery read and the once-only fn_escalate_shipment_cancellation.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b200000-0000-4000-8000-000000000001',
  shipment: '7b200000-0000-4000-8000-000000000011',
  sibling: '7b200000-0000-4000-8000-000000000012',
};
const paymentIntent = 'pi_b21_local';
const amounts: Record<string, number> = { [ids.shipment]: 11000, [ids.sibling]: 7000 };

type Tx = SQL;
type Recorded = {
  refund_id: string;
  refund_status: string;
  refund_failure_reason: string | null;
  changed: boolean;
};

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
  // Never touch a remote project: this harness writes (and rolls back) data.
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost')
    throw new Error(`Refusing non-local database host: ${host}`);
  return url;
}

class Rollback extends Error {}

async function asService(tx: Tx) {
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
}

function request(shipmentId: string) {
  return {
    payment_intent: paymentIntent,
    amount: amounts[shipmentId],
    reason: 'requested_by_customer',
    metadata: {
      shipment_id: shipmentId,
      order_id: ids.order,
      caller_role: 'buyer',
      reason: 'Changed my mind',
      seguro_share_cents: 500,
    },
  };
}

async function fixture(tx: Tx) {
  await tx`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id)
    VALUES (${ids.order}, ${ids.buyer}, 180, '{}'::jsonb, 'paid', ${paymentIntent})`;
  await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id)
    VALUES (${ids.shipment}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}),
           (${ids.sibling}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent})`;
  await asService(tx);
}

/** Claims and starts through the real B1 RPCs, so the fence is genuine. */
async function start(tx: Tx, shipmentId: string) {
  const [{ claim }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${shipmentId}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'Changed my mind') AS claim`;
  assert.equal(claim.status, 'claimed');
  await tx`SELECT public.fn_start_shipment_cancellation_refund(
    ${shipmentId}::uuid, ${claim.claim_token}::uuid, ${JSON.stringify(request(shipmentId))}::text::jsonb, 0::bigint)`;
}

async function claim(tx: Tx, shipmentId: string) {
  const [{ claim: claimed }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${shipmentId}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'Changed my mind') AS claim`;
  assert.equal(claimed.status, 'claimed');
}

async function recovery(tx: Tx, shipmentId: string) {
  const [{ result }] = await tx`SELECT public.fn_get_shipment_cancellation_recovery(${shipmentId}::uuid) AS result`;
  return result;
}

async function escalate(tx: Tx, shipmentId: string, reason: string) {
  const [{ result }] = await tx`SELECT public.fn_escalate_shipment_cancellation(${shipmentId}::uuid, ${reason}) AS result`;
  return result;
}

async function escalationRow(tx: Tx, shipmentId: string) {
  const [row] = await tx`SELECT recovery_escalated_at, recovery_escalation_reason
    FROM public.shipment_cancellation_operations WHERE shipment_id = ${shipmentId}`;
  return row;
}

async function record(
  tx: Tx,
  shipmentId: string,
  refundId: string,
  status: string,
  overrides: { paymentIntent?: string; amount?: number; reason?: string | null } = {},
): Promise<Recorded> {
  const [{ result }] = await tx`SELECT public.fn_record_shipment_cancellation_refund(
    ${shipmentId}::uuid, ${refundId}, ${overrides.paymentIntent ?? paymentIntent},
    ${overrides.amount ?? amounts[shipmentId]}::bigint, ${status},
    ${overrides.reason ?? null}) AS result`;
  return result;
}

async function operation(tx: Tx, shipmentId: string) {
  const [row] = await tx`SELECT refund_id, refund_status, refund_failure_reason, refund_status_updated_at
    FROM public.shipment_cancellation_operations WHERE shipment_id = ${shipmentId}`;
  return row;
}

async function rejects(tx: Tx, action: (sp: Tx) => Promise<unknown>, message: string) {
  await assert.rejects(
    tx.savepoint((sp) => action(sp as Tx)),
    (error: Error) => error.message.includes(message),
    `expected ${message}`,
  );
}

const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  [
    'records a pending refund on a started operation, and a replay changes nothing',
    async (tx) => {
      await start(tx, ids.shipment);
      assert.deepEqual(await record(tx, ids.shipment, 're_1', 'pending'), {
        refund_id: 're_1',
        refund_status: 'pending',
        refund_failure_reason: null,
        changed: true,
      });
      const first = await operation(tx, ids.shipment);
      assert.ok(first.refund_status_updated_at);
      assert.equal((await record(tx, ids.shipment, 're_1', 'pending')).changed, false);
      assert.deepEqual(await operation(tx, ids.shipment), first);
    },
  ],
  [
    'moves pending to succeeded, then a late failure keeps its Stripe reason',
    async (tx) => {
      await start(tx, ids.shipment);
      await record(tx, ids.shipment, 're_1', 'pending');
      assert.equal((await record(tx, ids.shipment, 're_1', 'succeeded')).refund_status, 'succeeded');
      assert.deepEqual(
        await record(tx, ids.shipment, 're_1', 'failed', { reason: 'expired_or_canceled_card' }),
        {
          refund_id: 're_1',
          refund_status: 'failed',
          refund_failure_reason: 'expired_or_canceled_card',
          changed: true,
        },
      );
    },
  ],
  [
    'ignores stale or impossible transitions without error (out-of-order webhooks)',
    async (tx) => {
      await start(tx, ids.shipment);
      await record(tx, ids.shipment, 're_1', 'succeeded');
      const stale = await record(tx, ids.shipment, 're_1', 'pending');
      assert.equal(stale.changed, false);
      assert.equal(stale.refund_status, 'succeeded');
      await record(tx, ids.shipment, 're_1', 'failed', { reason: 'lost_or_stolen_card' });
      for (const status of ['succeeded', 'pending', 'canceled']) {
        const terminal = await record(tx, ids.shipment, 're_1', status);
        assert.equal(terminal.changed, false);
        assert.equal(terminal.refund_status, 'failed');
      }
    },
  ],
  [
    'rejects a refund whose payment intent, amount or ID does not match, leaving the row unchanged',
    async (tx) => {
      await start(tx, ids.shipment);
      await record(tx, ids.shipment, 're_1', 'pending');
      const before = await operation(tx, ids.shipment);
      await rejects(tx, (sp) => record(sp, ids.shipment, 're_1', 'succeeded', { paymentIntent: 'pi_other' }), 'REFUND_PAYMENT_INTENT_MISMATCH');
      await rejects(tx, (sp) => record(sp, ids.shipment, 're_1', 'succeeded', { amount: 10999 }), 'REFUND_AMOUNT_MISMATCH');
      await rejects(tx, (sp) => record(sp, ids.shipment, 're_2', 'succeeded'), 'REFUND_ID_MISMATCH');
      assert.deepEqual(await operation(tx, ids.shipment), before);
    },
  ],
  [
    'one Stripe refund can belong to only one shipment',
    async (tx) => {
      await start(tx, ids.shipment);
      await start(tx, ids.sibling);
      await record(tx, ids.shipment, 're_1', 'succeeded');
      await rejects(tx, (sp) => record(sp, ids.sibling, 're_1', 'succeeded', { amount: 7000 }), 'REFUND_ID_ALREADY_LINKED');
      assert.equal((await operation(tx, ids.sibling)).refund_id, null);
    },
  ],
  [
    'a sibling with the same amount on the shared payment intent still cannot take another shipment refund',
    async (tx) => {
      amounts[ids.sibling] = amounts[ids.shipment];
      try {
        await start(tx, ids.shipment);
        await start(tx, ids.sibling);
        await record(tx, ids.shipment, 're_1', 'succeeded');
        await rejects(tx, (sp) => record(sp, ids.sibling, 're_1', 'succeeded'), 'REFUND_ID_ALREADY_LINKED');
        assert.equal((await operation(tx, ids.sibling)).refund_id, null);
      } finally {
        amounts[ids.sibling] = 7000;
      }
    },
  ],
  [
    'requires_action then succeeded lets the cancellation complete',
    async (tx) => {
      await start(tx, ids.shipment);
      await record(tx, ids.shipment, 're_1', 'requires_action');
      const [blocked] = await tx`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
      assert.equal(blocked.error_message, 'REFUND_NOT_SUCCEEDED');
      assert.equal((await record(tx, ids.shipment, 're_1', 'succeeded')).changed, true);
      const [done] = await tx`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
      assert.deepEqual({ ...done }, { success: true, error_message: null });
    },
  ],
  [
    'rejects unstarted operations and unknown statuses',
    async (tx) => {
      await rejects(tx, (sp) => record(sp, ids.shipment, 're_1', 'succeeded'), 'CANCELLATION_NOT_STARTED');
      await start(tx, ids.shipment);
      await rejects(tx, (sp) => record(sp, ids.shipment, 're_1', 'refunded'), 'INVALID_REFUND_STATUS');
      await rejects(tx, (sp) => record(sp, ids.shipment, '  ', 'succeeded'), 'INVALID_REFUND_ID');
      assert.equal((await operation(tx, ids.shipment)).refund_id, null);
    },
  ],
  [
    'only service_role may record a refund',
    async (tx) => {
      await start(tx, ids.shipment);
      await tx`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await tx`SET LOCAL ROLE authenticated`;
      await rejects(tx, (sp) => record(sp, ids.shipment, 're_1', 'succeeded'), 'permission denied');
    },
  ],
  [
    'fn_cancel_shipment refuses a recorded refund that has not succeeded, and the sibling is untouched',
    async (tx) => {
      await start(tx, ids.shipment);
      await record(tx, ids.shipment, 're_1', 'pending');
      const [pending] = await tx`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
      assert.deepEqual({ ...pending }, { success: false, error_message: 'REFUND_NOT_SUCCEEDED' });
      const [still] = await tx`SELECT status FROM public.shipments WHERE id = ${ids.shipment}`;
      assert.equal(still.status, 'paid');

      await record(tx, ids.shipment, 're_1', 'succeeded');
      const [done] = await tx`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
      assert.deepEqual({ ...done }, { success: true, error_message: null });
      const statuses = await tx`SELECT id, status FROM public.shipments WHERE order_id = ${ids.order} ORDER BY id`;
      assert.deepEqual(statuses.map((s: { status: string }) => s.status), ['cancelled', 'paid']);
    },
  ],
  [
    'fn_cancel_shipment refuses a started operation with no recorded refund status',
    async (tx) => {
      await start(tx, ids.shipment);
      const [blocked] = await tx`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
      assert.deepEqual({ ...blocked }, { success: false, error_message: 'REFUND_NOT_SUCCEEDED' });
      const [still] = await tx`SELECT status FROM public.shipments WHERE id = ${ids.shipment}`;
      assert.equal(still.status, 'paid');
    },
  ],
  [
    'fn_cancel_shipment refuses a shipment with no cancellation operation',
    async (tx) => {
      const [blocked] = await tx`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
      assert.deepEqual({ ...blocked }, { success: false, error_message: 'REFUND_NOT_SUCCEEDED' });
      const [still] = await tx`SELECT status FROM public.shipments WHERE id = ${ids.shipment}`;
      assert.equal(still.status, 'paid');
    },
  ],
  [
    'fn_cancel_shipment keeps returning ALREADY_CANCELLED for a cancelled shipment',
    async (tx) => {
      await start(tx, ids.shipment);
      await record(tx, ids.shipment, 're_1', 'succeeded');
      await tx`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
      const [again] = await tx`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
      assert.deepEqual({ ...again }, { success: true, error_message: 'ALREADY_CANCELLED' });
    },
  ],
  [
    'recovery read returns null for a missing or merely claimed operation',
    async (tx) => {
      assert.equal(await recovery(tx, ids.shipment), null);
      await claim(tx, ids.shipment);
      assert.equal(await recovery(tx, ids.shipment), null);
    },
  ],
  [
    'recovery read returns the frozen operation, reflects the recorded refund, and changes nothing',
    async (tx) => {
      await start(tx, ids.shipment);
      const before = await tx`SELECT * FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
      const started = await recovery(tx, ids.shipment);
      assert.deepEqual(Object.keys(started).sort(), [
        'actor_id',
        'cancellation_loss_cents',
        'external_started_at',
        'operation_key',
        'order_id',
        'reason',
        'recovery_escalated_at',
        'refund_id',
        'refund_request',
        'refund_status',
        'source',
      ]);
      assert.equal(started.operation_key, `cancel_shipment_${ids.shipment}`);
      assert.equal(started.order_id, ids.order);
      assert.equal(started.source, 'buyer');
      assert.equal(started.actor_id, ids.buyer);
      assert.equal(started.reason, 'Changed my mind');
      assert.deepEqual(started.refund_request, request(ids.shipment));
      assert.equal(Number(started.cancellation_loss_cents), 0);
      assert.equal(started.recovery_escalated_at, null);
      assert.equal(started.refund_id, null);
      assert.equal(started.refund_status, null);
      assert.ok(started.external_started_at);
      assert.deepEqual(await tx`SELECT * FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`, before);

      await record(tx, ids.shipment, 're_1', 'pending');
      const pending = await recovery(tx, ids.shipment);
      assert.equal(pending.refund_id, 're_1');
      assert.equal(pending.refund_status, 'pending');
    },
  ],
  [
    'only service_role may read the recovery state (authenticated denied)',
    async (tx) => {
      await start(tx, ids.shipment);
      await tx`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await tx`SET LOCAL ROLE authenticated`;
      await rejects(tx, (sp) => recovery(sp, ids.shipment), 'permission denied');
    },
  ],
  [
    'anon cannot read the recovery state either',
    async (tx) => {
      await start(tx, ids.shipment);
      await tx`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`;
      await tx`SET LOCAL ROLE anon`;
      await rejects(tx, (sp) => recovery(sp, ids.shipment), 'permission denied');
    },
  ],
  [
    'escalation is recorded once: the first call returns escalated true, a replay returns false and changes nothing',
    async (tx) => {
      await start(tx, ids.shipment);
      assert.equal((await escalationRow(tx, ids.shipment)).recovery_escalated_at, null);
      assert.deepEqual(await escalate(tx, ids.shipment, 'refund_not_found'), { escalated: true });
      const first = await escalationRow(tx, ids.shipment);
      assert.ok(first.recovery_escalated_at);
      assert.equal(first.recovery_escalation_reason, 'refund_not_found');
      assert.deepEqual(await escalate(tx, ids.shipment, 'refund_ambiguous'), { escalated: false });
      assert.deepEqual(await escalate(tx, ids.shipment, 'refund_not_found'), { escalated: false });
      assert.deepEqual(await escalationRow(tx, ids.shipment), first);
    },
  ],
  [
    'the recovery read shows the escalation, and escalating leaves the sibling and refund state untouched',
    async (tx) => {
      await start(tx, ids.shipment);
      await start(tx, ids.sibling);
      const before = await operation(tx, ids.shipment);
      await escalate(tx, ids.shipment, 'refund_ambiguous');
      const read = await recovery(tx, ids.shipment);
      assert.ok(read.recovery_escalated_at);
      assert.equal(read.refund_id, null);
      assert.deepEqual(await operation(tx, ids.shipment), before);
      assert.equal((await recovery(tx, ids.sibling)).recovery_escalated_at, null);
      assert.equal((await escalationRow(tx, ids.sibling)).recovery_escalated_at, null);
    },
  ],
  [
    'escalation rejects an unstarted or missing operation and an unknown reason, leaving the row unchanged',
    async (tx) => {
      await rejects(tx, (sp) => escalate(sp, ids.shipment, 'refund_not_found'), 'CANCELLATION_NOT_STARTED');
      await claim(tx, ids.shipment);
      await rejects(tx, (sp) => escalate(sp, ids.shipment, 'refund_not_found'), 'CANCELLATION_NOT_STARTED');
      assert.equal((await escalationRow(tx, ids.shipment)).recovery_escalated_at, null);
      await start(tx, ids.sibling);
      await rejects(tx, (sp) => escalate(sp, ids.sibling, 'because'), 'INVALID_ESCALATION_REASON');
      await rejects(tx, (sp) => escalate(sp, ids.sibling, '  '), 'INVALID_ESCALATION_REASON');
      assert.equal((await escalationRow(tx, ids.sibling)).recovery_escalated_at, null);
      assert.deepEqual(await escalate(tx, ids.sibling, 'refund_not_found'), { escalated: true });
    },
  ],
  [
    'only service_role may escalate (authenticated denied)',
    async (tx) => {
      await start(tx, ids.shipment);
      await tx`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await tx`SET LOCAL ROLE authenticated`;
      await rejects(tx, (sp) => escalate(sp, ids.shipment, 'refund_not_found'), 'permission denied');
    },
  ],
  [
    'anon cannot escalate either',
    async (tx) => {
      await start(tx, ids.shipment);
      await tx`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`;
      await tx`SET LOCAL ROLE anon`;
      await rejects(tx, (sp) => escalate(sp, ids.shipment, 'refund_not_found'), 'permission denied');
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
