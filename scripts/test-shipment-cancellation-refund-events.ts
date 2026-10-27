import { SQL } from 'bun';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const help =
  'Usage: bun scripts/test-shipment-cancellation-refund-events.ts [--help]\n' +
  'B2.3 SQL: the service-only fn_apply_shipment_cancellation_refund_event applies asynchronous Stripe refund\n' +
  'events to a started shipment cancellation (completes on succeeded, keeps the fence and notifies on failure).\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b300000-0000-4000-8000-000000000001',
  shipment: '7b300000-0000-4000-8000-000000000011',
  sibling: '7b300000-0000-4000-8000-000000000012',
  product: '00000000-0000-4000-8000-0000000000b1',
  siblingProduct: '00000000-0000-4000-8000-0000000000b2',
};
const paymentIntent = 'pi_b23_local';
const amounts: Record<string, number> = { [ids.shipment]: 11000, [ids.sibling]: 7000 };

type Tx = SQL;
type Outcome = {
  outcome: string;
  refund_id?: string;
  refund_status?: string;
  refund_failure_reason?: string | null;
  amount_owed_cents?: number;
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

function request(shipmentId: string, callerRole: string) {
  return {
    payment_intent: paymentIntent,
    amount: amounts[shipmentId],
    reason: 'requested_by_customer',
    metadata: {
      shipment_id: shipmentId,
      order_id: ids.order,
      caller_role: callerRole,
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
  await tx`INSERT INTO public.order_items (order_id, product_id, seller_id, price_at_purchase, net_payout, shipment_id)
    VALUES (${ids.order}, ${ids.product}, ${ids.seller}, 7500, 7000, ${ids.shipment}),
           (${ids.order}, ${ids.siblingProduct}, ${ids.seller}, 3900, 3500, ${ids.sibling})`;
  await tx`UPDATE public.products SET status = 'SOLD' WHERE id IN (${ids.product}, ${ids.siblingProduct})`;
  await asService(tx);
}

/** Claims and starts through the real B1 RPCs, so the fence is genuine. */
async function start(
  tx: Tx,
  shipmentId: string,
  source: 'buyer' | 'seller' | 'paid_timeout' = 'buyer',
) {
  const actor = source === 'buyer' ? ids.buyer : source === 'seller' ? ids.seller : null;
  const [{ claim }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${shipmentId}::uuid, ${ids.order}::uuid, ${actor}::uuid, ${source}, 'Changed my mind') AS claim`;
  assert.equal(claim.status, 'claimed');
  await tx`SELECT public.fn_start_shipment_cancellation_refund(
    ${shipmentId}::uuid, ${claim.claim_token}::uuid, ${JSON.stringify(request(shipmentId, source === 'paid_timeout' ? 'system' : source))}::text::jsonb, 0::bigint)`;
}

async function apply(
  tx: Tx,
  shipmentId: string,
  refundId: string,
  status: string,
  overrides: { paymentIntent?: string; amount?: number; reason?: string | null } = {},
): Promise<Outcome> {
  const [{ result }] = await tx`SELECT public.fn_apply_shipment_cancellation_refund_event(
    ${shipmentId}::uuid, ${refundId}, ${overrides.paymentIntent ?? paymentIntent},
    ${overrides.amount ?? amounts[shipmentId]}::bigint, ${status},
    ${overrides.reason ?? null}) AS result`;
  return result;
}

async function snapshot(tx: Tx, shipmentId: string) {
  const [shipment] = await tx`SELECT status FROM public.shipments WHERE id = ${shipmentId}`;
  const [operation] = await tx`SELECT * FROM public.shipment_cancellation_operations WHERE shipment_id = ${shipmentId}`;
  return { shipment: shipment.status as string, operation };
}

async function productStatus(tx: Tx, productId: string) {
  const [row] = await tx`SELECT status FROM public.products WHERE id = ${productId}`;
  return row.status as string;
}

async function notifications(tx: Tx, kind: string, shipmentId = ids.shipment) {
  return await tx`SELECT user_id, type, title, message, action_path, source_event_key, event_payload
    FROM public.notifications WHERE event_kind = ${kind} AND event_payload->>'shipment_id' = ${shipmentId}
    ORDER BY user_id`;
}

async function notificationCount(tx: Tx, shipmentId = ids.shipment) {
  const [row] = await tx`SELECT count(*)::int AS n FROM public.notifications
    WHERE event_payload->>'shipment_id' = ${shipmentId}`;
  return row.n as number;
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
    'ignores a shipment with no started cancellation (missing, unknown or merely claimed) without writing anything',
    async (tx) => {
      assert.deepEqual(await apply(tx, ids.shipment, 're_1', 'succeeded'), { outcome: 'ignored' });
      assert.deepEqual(
        await apply(tx, '7b300000-0000-4000-8000-0000000000ff', 're_1', 'succeeded'),
        { outcome: 'ignored' },
      );
      await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.shipment}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'Changed my mind')`;
      assert.deepEqual(await apply(tx, ids.shipment, 're_1', 'succeeded'), { outcome: 'ignored' });
      const state = await snapshot(tx, ids.shipment);
      assert.equal(state.shipment, 'paid');
      assert.equal(state.operation.refund_id, null);
      assert.equal(await productStatus(tx, ids.product), 'SOLD');
      assert.equal(await notificationCount(tx), 0);
    },
  ],
  [
    'pending is recorded without completing; pending to succeeded completes the cancellation',
    async (tx) => {
      await start(tx, ids.shipment);
      assert.deepEqual(await apply(tx, ids.shipment, 're_1', 'pending'), {
        outcome: 'recorded',
        refund_id: 're_1',
        refund_status: 'pending',
        refund_failure_reason: null,
        amount_owed_cents: 11000,
      });
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
      assert.equal(await productStatus(tx, ids.product), 'SOLD');

      assert.deepEqual(await apply(tx, ids.shipment, 're_1', 'succeeded'), {
        outcome: 'completed',
        refund_id: 're_1',
        refund_status: 'succeeded',
        refund_failure_reason: null,
        amount_owed_cents: 11000,
      });
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
      assert.equal(await productStatus(tx, ids.product), 'VERIFIED');
      const cancelled = await notifications(tx, 'shipment.cancelled');
      assert.deepEqual(
        cancelled
          .map((n: { event_payload: { recipient_role: string } }) => n.event_payload.recipient_role)
          .sort(),
        ['buyer', 'seller'],
      );
      assert.equal((await notifications(tx, 'shipment.refund_failed')).length, 0);
    },
  ],
  [
    'a replay of the same event after completion is unchanged and writes nothing more',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'requires_action');
      assert.equal((await apply(tx, ids.shipment, 're_1', 'succeeded')).outcome, 'completed');
      const before = await snapshot(tx, ids.shipment);
      const noticesBefore = await notificationCount(tx);
      const replay = await apply(tx, ids.shipment, 're_1', 'succeeded');
      assert.equal(replay.outcome, 'unchanged');
      assert.equal(replay.refund_status, 'succeeded');
      assert.equal((await apply(tx, ids.shipment, 're_1', 'pending')).outcome, 'unchanged');
      assert.deepEqual(await snapshot(tx, ids.shipment), before);
      assert.equal(await notificationCount(tx), noticesBefore);
    },
  ],
  [
    'a changed non-terminal status (requires_action to pending) is recorded and the shipment stays open',
    async (tx) => {
      await start(tx, ids.shipment);
      assert.equal((await apply(tx, ids.shipment, 're_1', 'requires_action')).outcome, 'recorded');
      assert.equal((await apply(tx, ids.shipment, 're_1', 'pending')).outcome, 'recorded');
      assert.equal((await apply(tx, ids.shipment, 're_1', 'pending')).outcome, 'unchanged');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
    },
  ],
  [
    'succeeded to failed after cancellation keeps the shipment cancelled, notifies the buyer once and replays are idempotent',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'succeeded');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');

      const failed = await apply(tx, ids.shipment, 're_1', 'failed', {
        reason: 'expired_or_canceled_card',
      });
      assert.deepEqual(failed, {
        outcome: 'failed_after_cancellation',
        refund_id: 're_1',
        refund_status: 'failed',
        refund_failure_reason: 'expired_or_canceled_card',
        amount_owed_cents: 11000,
      });
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
      assert.equal(await productStatus(tx, ids.product), 'VERIFIED');

      const rows = await notifications(tx, 'shipment.refund_failed');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].user_id, ids.buyer);
      assert.equal(rows[0].type, 'error');
      assert.equal(rows[0].source_event_key, `shipment.refund_failed:${ids.shipment}:re_1`);
      assert.equal(rows[0].action_path, `/profile/orders/${ids.order}`);
      assert.deepEqual(
        { ...rows[0].event_payload },
        {
          order_id: ids.order,
          shipment_id: ids.shipment,
          refund_id: 're_1',
          recipient_role: 'buyer',
        },
      );

      // BL7: a redelivered failure of an unresolved operation reports again (the first alert may have
      // been lost to a crash after commit), while the buyer still gets a single notice.
      assert.equal(
        (await apply(tx, ids.shipment, 're_1', 'failed', { reason: 'expired_or_canceled_card' })).outcome,
        'failed_after_cancellation',
      );
      assert.equal((await apply(tx, ids.shipment, 're_1', 'succeeded')).outcome, 'unchanged');
      assert.equal((await notifications(tx, 'shipment.refund_failed')).length, 1);
    },
  ],
  [
    'failure before success (failed) keeps the shipment open, does not cancel it and notifies the buyer once',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'pending');
      const failed = await apply(tx, ids.shipment, 're_1', 'failed', { reason: 'lost_or_stolen_card' });
      assert.equal(failed.outcome, 'failed_before_cancellation');
      assert.equal(failed.refund_failure_reason, 'lost_or_stolen_card');
      assert.equal(failed.amount_owed_cents, 11000);
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
      assert.equal(await productStatus(tx, ids.product), 'SOLD');
      assert.equal((await notifications(tx, 'shipment.cancelled')).length, 0);
      assert.equal((await notifications(tx, 'shipment.refund_failed')).length, 1);

      // failed is terminal: a late succeeded snapshot cannot reopen it. A redelivered failure reports
      // again while the operation is unresolved (BL7) but adds no notice and keeps the shipment open.
      assert.equal((await apply(tx, ids.shipment, 're_1', 'succeeded')).outcome, 'unchanged');
      assert.equal(
        (await apply(tx, ids.shipment, 're_1', 'failed', { reason: 'lost_or_stolen_card' })).outcome,
        'failed_before_cancellation',
      );
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
      assert.equal(await productStatus(tx, ids.product), 'SOLD');
      assert.equal((await notifications(tx, 'shipment.refund_failed')).length, 1);
    },
  ],
  [
    'a canceled refund before success is reported like a failure and never cancels the shipment',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'requires_action');
      const canceled = await apply(tx, ids.shipment, 're_1', 'canceled');
      assert.equal(canceled.outcome, 'failed_before_cancellation');
      assert.equal(canceled.refund_status, 'canceled');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
      assert.equal((await notifications(tx, 'shipment.refund_failed')).length, 1);
    },
  ],
  [
    'a payment intent, amount, refund id or status that does not match raises and leaves every row unchanged',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'pending');
      const before = await snapshot(tx, ids.shipment);
      await rejects(
        tx,
        (sp) => apply(sp, ids.shipment, 're_1', 'succeeded', { paymentIntent: 'pi_other' }),
        'REFUND_PAYMENT_INTENT_MISMATCH',
      );
      await rejects(
        tx,
        (sp) => apply(sp, ids.shipment, 're_1', 'succeeded', { amount: 10999 }),
        'REFUND_AMOUNT_MISMATCH',
      );
      await rejects(tx, (sp) => apply(sp, ids.shipment, 're_2', 'succeeded'), 'REFUND_ID_MISMATCH');
      await rejects(tx, (sp) => apply(sp, ids.shipment, 're_1', 'refunded'), 'INVALID_REFUND_STATUS');
      await rejects(tx, (sp) => apply(sp, ids.shipment, '  ', 'succeeded'), 'INVALID_REFUND_ID');
      assert.deepEqual(await snapshot(tx, ids.shipment), before);
      assert.equal(await productStatus(tx, ids.product), 'SOLD');
      assert.equal(await notificationCount(tx), 0);
    },
  ],
  [
    'a sibling shipment on the same payment intent is untouched, and cannot take this shipment refund',
    async (tx) => {
      await start(tx, ids.shipment);
      await start(tx, ids.sibling);
      const siblingBefore = await snapshot(tx, ids.sibling);
      assert.equal((await apply(tx, ids.shipment, 're_1', 'succeeded')).outcome, 'completed');
      assert.deepEqual(await snapshot(tx, ids.sibling), siblingBefore);
      assert.equal(await productStatus(tx, ids.siblingProduct), 'SOLD');
      assert.equal(
        (await apply(tx, ids.shipment, 're_1', 'failed', { reason: 'lost_or_stolen_card' })).outcome,
        'failed_after_cancellation',
      );
      assert.deepEqual(await snapshot(tx, ids.sibling), siblingBefore);
      assert.equal(await notificationCount(tx, ids.sibling), 0);
      await rejects(
        tx,
        (sp) => apply(sp, ids.sibling, 're_1', 'succeeded', { amount: 7000 }),
        'REFUND_ID_ALREADY_LINKED',
      );
      assert.deepEqual(await snapshot(tx, ids.sibling), siblingBefore);
    },
  ],
  [
    'completes with the stored winner: a timeout-sourced operation cancels as system, a seller-sourced one as seller',
    async (tx) => {
      await start(tx, ids.shipment, 'paid_timeout');
      await start(tx, ids.sibling, 'seller');
      assert.equal((await apply(tx, ids.shipment, 're_1', 'succeeded')).outcome, 'completed');
      assert.equal((await apply(tx, ids.sibling, 're_2', 'succeeded')).outcome, 'completed');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
      assert.equal((await snapshot(tx, ids.sibling)).shipment, 'cancelled');
    },
  ],
  [
    'a succeeded refund already recorded on a still-open shipment converges on the next event without a new refund',
    async (tx) => {
      await start(tx, ids.shipment);
      await tx`SELECT public.fn_record_shipment_cancellation_refund(
        ${ids.shipment}::uuid, 're_1', ${paymentIntent}, 11000::bigint, 'succeeded', NULL)`;
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
      const done = await apply(tx, ids.shipment, 're_1', 'succeeded');
      assert.equal(done.outcome, 'completed');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
    },
  ],
  [
    'only service_role may apply a refund event (authenticated denied)',
    async (tx) => {
      await start(tx, ids.shipment);
      await tx`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await tx`SET LOCAL ROLE authenticated`;
      await rejects(tx, (sp) => apply(sp, ids.shipment, 're_1', 'succeeded'), 'permission denied');
    },
  ],
  [
    'anon cannot apply a refund event either',
    async (tx) => {
      await start(tx, ids.shipment);
      await tx`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`;
      await tx`SET LOCAL ROLE anon`;
      await rejects(tx, (sp) => apply(sp, ids.shipment, 're_1', 'succeeded'), 'permission denied');
    },
  ],
  [
    'V1 a failed event after a recorded succeeded on a still-open shipment keeps it fenced, open and notifies once',
    async (tx) => {
      await start(tx, ids.shipment);
      // The handler recorded succeeded and crashed before fn_cancel_shipment.
      await tx`SELECT public.fn_record_shipment_cancellation_refund(
        ${ids.shipment}::uuid, 're_1', ${paymentIntent}, 11000::bigint, 'succeeded', NULL)`;
      const failed = await apply(tx, ids.shipment, 're_1', 'failed', { reason: 'expired_or_canceled_card' });
      assert.equal(failed.outcome, 'failed_before_cancellation');
      assert.equal(failed.refund_failure_reason, 'expired_or_canceled_card');
      assert.equal(failed.amount_owed_cents, 11000);
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
      assert.equal(await productStatus(tx, ids.product), 'SOLD');
      assert.equal((await notifications(tx, 'shipment.cancelled')).length, 0);
      assert.equal((await notifications(tx, 'shipment.refund_failed')).length, 1);
      const [cancel] = await tx`SELECT * FROM public.fn_cancel_shipment(
        ${ids.shipment}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
      assert.equal(cancel.error_message, 'REFUND_NOT_SUCCEEDED');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
    },
  ],
  [
    'V2 a succeeded event after a recorded failure is unchanged, never completes and adds no notice',
    async (tx) => {
      await start(tx, ids.shipment);
      assert.equal((await apply(tx, ids.shipment, 're_1', 'failed')).outcome, 'failed_before_cancellation');
      const late = await apply(tx, ids.shipment, 're_1', 'succeeded');
      assert.equal(late.outcome, 'unchanged');
      assert.equal(late.refund_status, 'failed');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
      assert.equal(await productStatus(tx, ids.product), 'SOLD');
      assert.equal((await notifications(tx, 'shipment.refund_failed')).length, 1);
    },
  ],
  [
    'V3 refund.failed and refund.updated(failed) for the same refund notify only the buyer, once',
    async (tx) => {
      await start(tx, ids.shipment);
      assert.equal((await apply(tx, ids.shipment, 're_1', 'succeeded')).outcome, 'completed');
      assert.equal(
        (await apply(tx, ids.shipment, 're_1', 'failed', { reason: 'lost_or_stolen_card' })).outcome,
        'failed_after_cancellation',
      );
      assert.equal(
        (await apply(tx, ids.shipment, 're_1', 'failed', { reason: 'lost_or_stolen_card' })).outcome,
        'failed_after_cancellation',
      );
      const rows = await notifications(tx, 'shipment.refund_failed');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].user_id, ids.buyer);
      assert.equal(rows[0].type, 'error');
      assert.equal(rows[0].event_payload.recipient_role, 'buyer');
      const [others] = await tx`SELECT count(*)::int AS n FROM public.notifications
        WHERE event_kind = 'shipment.refund_failed' AND user_id <> ${ids.buyer}`;
      assert.equal(others.n, 0);
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
      assert.equal(await productStatus(tx, ids.product), 'VERIFIED');
    },
  ],
  [
    'V4 a different refund id on a recorded refund raises even for a failed status and writes no notice',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'pending');
      const before = await snapshot(tx, ids.shipment);
      await rejects(tx, (sp) => apply(sp, ids.shipment, 're_other', 'failed'), 'REFUND_ID_MISMATCH');
      assert.deepEqual(await snapshot(tx, ids.shipment), before);
      assert.equal(await notificationCount(tx), 0);
    },
  ],
  [
    'V5 with both siblings started, a failure on one never touches the other completed shipment',
    async (tx) => {
      await start(tx, ids.shipment);
      await start(tx, ids.sibling);
      assert.equal((await apply(tx, ids.shipment, 're_1', 'succeeded')).outcome, 'completed');
      assert.equal((await snapshot(tx, ids.sibling)).shipment, 'paid');
      assert.equal(
        (await apply(tx, ids.sibling, 're_2', 'failed', { amount: 7000 })).outcome,
        'failed_before_cancellation',
      );
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
      assert.equal((await snapshot(tx, ids.sibling)).shipment, 'paid');
      assert.equal(await productStatus(tx, ids.siblingProduct), 'SOLD');
      assert.equal((await notifications(tx, 'shipment.refund_failed', ids.shipment)).length, 0);
      assert.equal((await notifications(tx, 'shipment.refund_failed', ids.sibling)).length, 1);
    },
  ],
  [
    'V6 boundaries before any refund is recorded: off-by-one amount, other payment intent, blank id, unknown status',
    async (tx) => {
      await start(tx, ids.shipment);
      await rejects(tx, (sp) => apply(sp, ids.shipment, 're_1', 'succeeded', { amount: 11001 }), 'REFUND_AMOUNT_MISMATCH');
      await rejects(
        tx,
        (sp) => apply(sp, ids.shipment, 're_1', 'succeeded', { paymentIntent: 'pi_other' }),
        'REFUND_PAYMENT_INTENT_MISMATCH',
      );
      await rejects(tx, (sp) => apply(sp, ids.shipment, ' ', 'succeeded'), 'INVALID_REFUND_ID');
      await rejects(tx, (sp) => apply(sp, ids.shipment, 're_1', 'processing'), 'INVALID_REFUND_STATUS');
      const state = await snapshot(tx, ids.shipment);
      assert.equal(state.operation.refund_id, null);
      assert.equal(state.shipment, 'paid');
      assert.equal(await notificationCount(tx), 0);
    },
  ],
  [
    'V7 the RPC is a SECURITY DEFINER with an empty search_path executable only by service_role',
    async (tx) => {
      const sig = 'public.fn_apply_shipment_cancellation_refund_event(uuid,text,text,bigint,text,text)';
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
    'V8 the notification catalogue is the one the latest migration defines and includes shipment.refund_failed',
    async (tx) => {
      const [row] = await tx`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'notifications_event_kind_catalogue_chk'`;
      const kinds = [...(row.def as string).matchAll(/'([a-z_.]+)'::text/g)].map((m) => m[1]).sort();
      assert.deepEqual(kinds, latestCatalogueKinds().sort());
      assert.ok(kinds.includes('shipment.refund_failed'));
      await rejects(
        tx,
        (sp) => sp`INSERT INTO public.notifications (user_id, event_kind, source_event_key, event_payload, type, title, message)
          VALUES (${ids.buyer}, 'shipment.unknown', 'shipment.unknown:1', '{}'::jsonb, 'info', 't', 'm')`,
        'notifications_event_kind_catalogue_chk',
      );
    },
  ],
  [
    'V9 a failure on a shipment that moved on (shipped) is reported but never cancels it',
    async (tx) => {
      await start(tx, ids.shipment);
      await tx`RESET ROLE`;
      await tx`UPDATE public.shipments SET status = 'shipped' WHERE id = ${ids.shipment}`;
      await asService(tx);
      assert.equal((await apply(tx, ids.shipment, 're_1', 'failed')).outcome, 'failed_before_cancellation');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'shipped');
      assert.equal((await apply(tx, ids.shipment, 're_1', 'succeeded')).outcome, 'unchanged');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'shipped');
      assert.equal((await notifications(tx, 'shipment.refund_failed')).length, 1);
    },
  ],
];

// The catalogue grows with every notification kind: read it from the newest migration (not
// archive/) that adds the constraint, so this case does not need an edit per new kind.
function latestCatalogueKinds(): string[] {
  const dir = join(import.meta.dir, '..', 'supabase', 'migrations');
  const definition = /ADD CONSTRAINT notifications_event_kind_catalogue_chk\s+CHECK \(event_kind IS NULL OR event_kind IN \(([^)]*)\)\)/;
  const files = readdirSync(dir).filter((file) => file.endsWith('.sql')).sort().reverse();
  for (const file of files) {
    const match = definition.exec(readFileSync(join(dir, file), 'utf8'));
    if (match) return [...match[1].matchAll(/'([a-z_.]+)'/g)].map((kind) => kind[1]);
  }
  throw new Error('No migration defines notifications_event_kind_catalogue_chk');
}

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
