// Verifier probes for B2.4a (resolved escalated operations, list edges). Same harness rules: local stack only, every case rolls back.
// Usage: bun scripts/test-shipment-refund-problems.probes.ts
import { SQL } from 'bun';
import assert from 'node:assert/strict';

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

async function escalate(tx: Tx, n: number, reason: 'refund_not_found' | 'refund_ambiguous') {
  await tx`SELECT public.fn_escalate_shipment_cancellation(${shipmentId(n)}::uuid, ${reason})`;
}

async function list(tx: Tx) {
  return [...(await tx`SELECT * FROM public.fn_list_shipment_refund_problems()`)] as Problem[];
}

async function startPreparing(tx: Tx, n: number) {
  await asOwner(tx);
  await tx`UPDATE public.shipments SET status = 'preparing' WHERE id = ${shipmentId(n)}`;
  await asService(tx);
  const [{ result }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${shipmentId(n)}::uuid, ${ids.order}::uuid, NULL::uuid, 'preparing_timeout', 'Preparing timeout') AS result`;
  const body = {
    payment_intent: paymentIntent(n), amount: amount(n), reason: 'requested_by_customer',
    metadata: { shipment_id: shipmentId(n), order_id: ids.order, caller_role: 'system', reason: 'Preparing timeout', seguro_share_cents: 500 },
  };
  // A preparing refund can only start after the carrier accepted the label cancellation (B4.2).
  await tx`SELECT public.fn_record_shipment_carrier_cancellation(
    ${shipmentId(n)}::uuid, ${(result as { claim_token: string }).claim_token}::uuid, 'accepted', true, now())`;
  await tx`SELECT public.fn_start_shipment_cancellation_refund(
    ${shipmentId(n)}::uuid, ${(result as { claim_token: string }).claim_token}::uuid, ${JSON.stringify(body)}::text::jsonb, 0::bigint)`;
}
async function applyResult(tx: Tx, n: number, refundId: string, status: string, reason: string | null = null) {
  const [{ r }] = await tx`SELECT public.fn_apply_shipment_cancellation_refund_event(
    ${shipmentId(n)}::uuid, ${refundId}, ${paymentIntent(n)}, ${amount(n)}::bigint, ${status}, ${reason}) AS r`;
  return r as {
    outcome: string;
    refund_id: string | null;
    refund_status: string | null;
    refund_failure_reason: string | null;
    amount_owed_cents: number;
    resolution_reference?: string;
  };
}
async function applyRaw(tx: Tx, n: number, refundId: string, pi: string, cents: number, status: string) {
  await tx`SELECT public.fn_apply_shipment_cancellation_refund_event(
    ${shipmentId(n)}::uuid, ${refundId}, ${pi}, ${cents}::bigint, ${status}, NULL)`;
}
async function resolveResult(tx: Tx, n: number, ref = reference) {
  const [{ r }] = await tx`SELECT public.fn_resolve_shipment_cancellation_refund(${shipmentId(n)}::uuid, ${ids.admin}::uuid, ${ref}) AS r`;
  return r as { resolved: boolean; shipment_cancelled: boolean; amount_owed_cents: number; reference: string };
}
async function state(tx: Tx, n: number) {
  const [op] = await tx`SELECT to_jsonb(o) AS j FROM public.shipment_cancellation_operations o WHERE shipment_id = ${shipmentId(n)}`;
  const [sh] = await tx`SELECT status::text AS s FROM public.shipments WHERE id = ${shipmentId(n)}`;
  const [nt] = await tx`SELECT count(*)::int AS c FROM public.notifications WHERE event_payload->>'shipment_id' = ${shipmentId(n)}`;
  const [au] = await tx`SELECT count(*)::int AS c FROM public.admin_audit_logs WHERE target_id = ${shipmentId(n)}`;
  return JSON.stringify({ op: op?.j ?? null, shipment: sh?.s, notifications: nt.c, audits: au.c });
}
async function rejectsWith(tx: Tx, action: (sp: Tx) => Promise<unknown>): Promise<string> {
  try { await tx.savepoint((sp) => action(sp as Tx)); } catch (e) { return (e as Error).message; }
  return 'NO_ERROR';
}
const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  ['Q1 resolved escalated (no refund): later pending/requires_action/succeeded refund events return after_resolution and change nothing', async (tx) => {
    for (const [n, reason] of [[1, 'refund_not_found'], [2, 'refund_ambiguous']] as const) {
      await start(tx, n);
      await escalate(tx, n, reason);
      assert.equal((await resolveResult(tx, n)).shipment_cancelled, true);
      const before = await state(tx, n);
      for (const status of ['pending', 'requires_action', 'succeeded']) {
        const r = await applyResult(tx, n, `re_late_${n}`, status);
        assert.deepEqual(
          [r.outcome, r.refund_id, r.refund_status, Number(r.amount_owed_cents), r.resolution_reference],
          ['after_resolution', `re_late_${n}`, status, amount(n), reference],
        );
        assert.equal(await state(tx, n), before);
      }
      assert.deepEqual(await list(tx), []);
    }
  }],
  ['Q2 resolved escalated: a later failed/canceled refund event returns after_resolution, records nothing and notifies no one', async (tx) => {
    await start(tx, 1);
    await escalate(tx, 1, 'refund_ambiguous');
    await resolveResult(tx, 1);
    const before = await state(tx, 1);
    const r = await applyResult(tx, 1, 're_late_1', 'failed', 'expired_or_canceled_card');
    assert.deepEqual(
      [r.outcome, r.refund_id, r.refund_status, r.refund_failure_reason, r.resolution_reference],
      ['after_resolution', 're_late_1', 'failed', 'expired_or_canceled_card', reference],
    );
    assert.equal(await state(tx, 1), before);
    await start(tx, 2);
    await escalate(tx, 2, 'refund_not_found');
    await resolveResult(tx, 2);
    const beforeCanceled = await state(tx, 2);
    const c = await applyResult(tx, 2, 're_late_2', 'canceled');
    assert.deepEqual([c.outcome, c.refund_id, c.refund_status], ['after_resolution', 're_late_2', 'canceled']);
    assert.equal(await state(tx, 2), beforeCanceled);
    assert.deepEqual(await list(tx), []);
  }],
  ['Q3 resolved escalated: a new claim (cancel-order / cron) is refused before any refund; resolve replay is idempotent', async (tx) => {
    await start(tx, 1);
    await escalate(tx, 1, 'refund_not_found');
    await resolveResult(tx, 1);
    const before = await state(tx, 1);
    assert.match(await rejectsWith(tx, (sp) => claim(sp, 1)), /SHIPMENT_NOT_CANCELABLE/);
    const again = await resolveResult(tx, 1, 'OTHER-REF');
    assert.deepEqual(again, { resolved: false, shipment_cancelled: false, amount_owed_cents: 1000, reference });
    const [{ rec }] = await tx`SELECT public.fn_get_shipment_cancellation_recovery(${shipmentId(1)}::uuid) AS rec`;
    assert.ok(rec.recovery_escalated_at);
    assert.equal(rec.refund_id, null);
    const [{ e }] = await tx`SELECT public.fn_escalate_shipment_cancellation(${shipmentId(1)}::uuid, 'refund_ambiguous') AS e`;
    assert.deepEqual(e, { escalated: false });
    assert.equal(await state(tx, 1), before);
  }],
  ['Q4 escalated on a shipment that moved on (shipped) raises SHIPMENT_STATUS_UNEXPECTED and writes nothing', async (tx) => {
    await start(tx, 1);
    await escalate(tx, 1, 'refund_not_found');
    await asOwner(tx);
    await tx`UPDATE public.shipments SET status = 'shipped' WHERE id = ${shipmentId(1)}`;
    await asService(tx);
    const before = await state(tx, 1);
    assert.match(await rejectsWith(tx, (sp) => resolveResult(sp, 1)), /SHIPMENT_STATUS_UNEXPECTED: shipped/);
    assert.equal(await state(tx, 1), before);
    const rows = await list(tx);
    assert.deepEqual(rows.map((r) => [r.shipment_status, r.kind]), [['shipped', 'refund_not_found']]);
  }],
  ['Q5 escalated on an already cancelled shipment: resolution only, no second cancellation', async (tx) => {
    await start(tx, 1);
    await escalate(tx, 1, 'refund_ambiguous');
    await asOwner(tx);
    await tx`UPDATE public.shipments SET status = 'cancelled' WHERE id = ${shipmentId(1)}`;
    await asService(tx);
    assert.deepEqual(await resolveResult(tx, 1), { resolved: true, shipment_cancelled: false, amount_owed_cents: 1000, reference });
    const [{ c }] = await tx`SELECT count(*)::int AS c FROM public.admin_audit_logs WHERE target_id = ${shipmentId(1)}`;
    assert.equal(c, 1);
  }],
  ['Q6 escalated preparing_timeout on a preparing shipment resolves and completes as system', async (tx) => {
    await startPreparing(tx, 1);
    await escalate(tx, 1, 'refund_not_found');
    const [row] = await list(tx);
    assert.equal(row.shipment_status, 'preparing');
    assert.equal((await resolveResult(tx, 1)).shipment_cancelled, true);
    const [sh] = await tx`SELECT status::text AS s FROM public.shipments WHERE id = ${shipmentId(1)}`;
    assert.equal(sh.s, 'cancelled');
  }],
  ['Q7 late succeeded->failed on a cancelled shipment is listed as refund_failed with shipment_status cancelled', async (tx) => {
    await start(tx, 1);
    assert.equal((await applyResult(tx, 1, 're_1', 'succeeded')).outcome, 'completed');
    assert.equal((await applyResult(tx, 1, 're_1', 'failed', 'expired_or_canceled_card')).outcome, 'failed_after_cancellation');
    const [row] = await list(tx);
    assert.deepEqual([row.kind, row.shipment_status, row.refund_id, row.refund_failure_reason, Number(row.amount_owed_cents)],
      ['refund_failed', 'cancelled', 're_1', 'expired_or_canceled_card', 1000]);
    const [op] = await tx`SELECT refund_status_updated_at FROM public.shipment_cancellation_operations WHERE shipment_id = ${shipmentId(1)}`;
    assert.equal(row.since.toISOString(), op.refund_status_updated_at.toISOString());
  }],
  ['Q8 an escalated op whose refund is recorded succeeded/pending is never listed nor resolvable', async (tx) => {
    await start(tx, 1);
    await applyResult(tx, 1, 're_1', 'succeeded');
    await escalate(tx, 1, 'refund_ambiguous');
    await start(tx, 2);
    await applyResult(tx, 2, 're_2', 'pending');
    await escalate(tx, 2, 'refund_not_found');
    assert.deepEqual(await list(tx), []);
    for (const n of [1, 2]) assert.match(await rejectsWith(tx, (sp) => resolveResult(sp, n)), /REFUND_NOT_RESOLVABLE/);
  }],
  ['Q9 the relaxed CHECK still rejects resolution columns on a recorded non-failed refund (even escalated) and on an unescalated unrecorded op', async (tx) => {
    await start(tx, 1);
    await escalate(tx, 1, 'refund_ambiguous');
    await applyResult(tx, 1, 're_1', 'pending');
    await start(tx, 2);
    await start(tx, 3);
    await escalate(tx, 3, 'refund_not_found');
    await asOwner(tx);
    for (const n of [1, 2]) {
      const msg = await rejectsWith(tx, (sp) => sp`UPDATE public.shipment_cancellation_operations
        SET refund_resolved_at = now(), refund_resolved_by = ${ids.admin}, refund_resolution_reference = 'X' WHERE shipment_id = ${shipmentId(n)}`);
      assert.match(msg, /refund_resolution_status/);
    }
    await tx`UPDATE public.shipment_cancellation_operations
      SET refund_resolved_at = now(), refund_resolved_by = ${ids.admin}, refund_resolution_reference = 'X' WHERE shipment_id = ${shipmentId(3)}`;
    const msg = await rejectsWith(tx, (sp) => sp`UPDATE public.shipment_cancellation_operations
      SET refund_id = 're_x', refund_status = 'succeeded', refund_status_updated_at = now() WHERE shipment_id = ${shipmentId(3)}`);
    assert.match(msg, /refund_resolution_status/);
    await asService(tx);
  }],
  ['Q10 list skips a missing/unstarted op and returns amount_owed from the frozen request, not the order', async (tx) => {
    await claim(tx, 1);
    await start(tx, 7);
    await escalate(tx, 7, 'refund_not_found');
    const rows = await list(tx);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].amount_owed_cents), 7000);
    assert.equal(rows[0].payment_intent_id, 'pi_b24a_7');
    assert.equal(rows[0].buyer_id, ids.buyer);
  }],
  ['Q11 resolved failed-before-success op: a replay of the identical failed event is unchanged and writes nothing', async (tx) => {
    await start(tx, 1);
    assert.equal((await applyResult(tx, 1, 're_1', 'failed', 'lost_or_stolen_card')).outcome, 'failed_before_cancellation');
    assert.equal((await resolveResult(tx, 1)).shipment_cancelled, true);
    const before = await state(tx, 1);
    const r = await applyResult(tx, 1, 're_1', 'failed', 'lost_or_stolen_card');
    assert.deepEqual([r.outcome, r.refund_id, r.refund_status], ['unchanged', 're_1', 'failed']);
    assert.equal(await state(tx, 1), before);
  }],
  ['Q12 resolved failed-before-success op: succeeded for the same refund and a different refund id are after_resolution and write nothing', async (tx) => {
    await start(tx, 1);
    await applyResult(tx, 1, 're_1', 'failed');
    await resolveResult(tx, 1);
    const before = await state(tx, 1);
    const same = await applyResult(tx, 1, 're_1', 'succeeded');
    assert.deepEqual([same.outcome, same.refund_id, same.refund_status, same.resolution_reference], ['after_resolution', 're_1', 'succeeded', reference]);
    const other = await applyResult(tx, 1, 're_other', 'failed');
    assert.deepEqual([other.outcome, other.refund_id, other.refund_status], ['after_resolution', 're_other', 'failed']);
    assert.equal(await state(tx, 1), before);
  }],
  ['Q13 resolved op: a foreign payment intent or amount still raises, never after_resolution, and writes nothing', async (tx) => {
    await start(tx, 1);
    await escalate(tx, 1, 'refund_not_found');
    await resolveResult(tx, 1);
    const before = await state(tx, 1);
    assert.match(await rejectsWith(tx, (sp) => applyRaw(sp, 1, 're_x', 'pi_foreign', amount(1), 'succeeded')), /REFUND_PAYMENT_INTENT_MISMATCH/);
    assert.match(await rejectsWith(tx, (sp) => applyRaw(sp, 1, 're_x', paymentIntent(1), amount(1) + 1, 'succeeded')), /REFUND_AMOUNT_MISMATCH/);
    assert.equal(await state(tx, 1), before);
  }],
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

await run();
