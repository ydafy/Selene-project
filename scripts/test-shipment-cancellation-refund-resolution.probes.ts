import { SQL } from 'bun';
import assert from 'node:assert/strict';

// Verifier probes for B2.3.1 (fn_resolve_shipment_cancellation_refund). Every case rolls back.
const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b31f000-0000-4000-8000-000000000001',
  shipment: '7b31f000-0000-4000-8000-000000000011',
  product: '00000000-0000-4000-8000-0000000000b1',
};
const pi = 'pi_b231_probe';
const amount = 11000;
const reference = 'SPEI-PROBE-0001';
type Tx = SQL;

function databaseUrl(): string {
  let url = process.env.SELENE_LOCAL_DB_URL;
  if (!url) {
    const status = Bun.spawnSync(['supabase', 'status', '--env'], { stdout: 'pipe', stderr: 'pipe' });
    if (status.exitCode !== 0) throw new Error('Local Supabase stack is not running: run `supabase start`.');
    url = JSON.parse(status.stdout.toString()).DB_URL as string | undefined;
  }
  if (!url) throw new Error('No local database URL found.');
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-local database host: ${host}`);
  return url;
}

class Rollback extends Error {}
const asService = async (tx: Tx) => {
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
};
const asOwner = async (tx: Tx) => { await tx`RESET ROLE`; };

async function fixture(tx: Tx, status: 'paid' | 'preparing' = 'paid') {
  await tx`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id, actual_stripe_fee_cents)
    VALUES (${ids.order}, ${ids.buyer}, 180, '{}'::jsonb, 'paid', ${pi}, 500)`;
  await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id)
    VALUES (${ids.shipment}, ${ids.order}, ${ids.seller}, ${status}, ${pi})`;
  await tx`INSERT INTO public.order_items (order_id, product_id, seller_id, price_at_purchase, net_payout, shipment_id)
    VALUES (${ids.order}, ${ids.product}, ${ids.seller}, 7500, 7000, ${ids.shipment})`;
  await tx`UPDATE public.products SET status = 'SOLD' WHERE id = ${ids.product}`;
  await asService(tx);
}

async function start(tx: Tx, source: 'buyer' | 'preparing_timeout' = 'buyer') {
  const actor = source === 'buyer' ? ids.buyer : null;
  const [{ claim }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${ids.shipment}::uuid, ${ids.order}::uuid, ${actor}::uuid, ${source}, 'Changed my mind') AS claim`;
  assert.equal(claim.status, 'claimed');
  const request = { payment_intent: pi, amount, reason: 'requested_by_customer', metadata: {
    shipment_id: ids.shipment, order_id: ids.order, caller_role: source === 'buyer' ? 'buyer' : 'system',
    reason: 'Changed my mind', seguro_share_cents: 500 } };
  // A preparing refund can only start after the carrier accepted the label cancellation (B4.2).
  if (source === 'preparing_timeout')
    await tx`SELECT public.fn_record_shipment_carrier_cancellation(
      ${ids.shipment}::uuid, ${claim.claim_token}::uuid, 'accepted', true, now())`;
  await tx`SELECT public.fn_start_shipment_cancellation_refund(
    ${ids.shipment}::uuid, ${claim.claim_token}::uuid, ${JSON.stringify(request)}::text::jsonb, 0::bigint)`;
}
const apply = async (tx: Tx, refundId: string, status: string, reason: string | null = null) =>
  (await tx`SELECT public.fn_apply_shipment_cancellation_refund_event(
    ${ids.shipment}::uuid, ${refundId}, ${pi}, ${amount}::bigint, ${status}, ${reason}) AS r`)[0].r as { outcome: string };
const resolve = async (tx: Tx, ref: string | null = reference, admin: string | null = ids.admin) =>
  (await tx`SELECT public.fn_resolve_shipment_cancellation_refund(${ids.shipment}::uuid, ${admin}::uuid, ${ref}) AS r`)[0].r;
const op = async (tx: Tx) =>
  (await tx`SELECT * FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`)[0];
const shipmentStatus = async (tx: Tx) =>
  (await tx`SELECT status::text AS s FROM public.shipments WHERE id = ${ids.shipment}`)[0].s as string;
const count = async (tx: Tx, q: string) => (await tx.unsafe(q))[0].n as number;
async function rejects(tx: Tx, action: (sp: Tx) => Promise<unknown>, message: string) {
  await assert.rejects(tx.savepoint((sp) => action(sp as Tx)),
    (error: Error) => error.message.includes(message), `expected ${message}`);
}

const cases: Array<[string, (tx: Tx) => Promise<void>, ('paid' | 'preparing')?]> = [
  ['P1 the resolution columns are writable only through the definer: RLS on with no write policy, so an admin JWT updates 0 rows', async (tx) => {
    await asOwner(tx);
    // anon/authenticated keep Supabase's default table grants; RLS (no policies) is the barrier.
    const [rls] = await tx`SELECT relrowsecurity AS on FROM pg_class WHERE oid = 'public.shipment_cancellation_operations'::regclass`;
    assert.equal(rls.on, true);
    const policies = await tx`SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'shipment_cancellation_operations' AND cmd <> 'SELECT'`;
    assert.equal(policies.length, 0);
    await asService(tx);
    await start(tx);
    await apply(tx, 're_p1', 'failed');
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ role: 'authenticated', sub: ids.admin })}, true)`;
    await tx`SET LOCAL ROLE authenticated`;
    const updated = await tx`UPDATE public.shipment_cancellation_operations
      SET refund_resolved_at = now(), refund_resolved_by = ${ids.admin}, refund_resolution_reference = 'x'
      WHERE shipment_id = ${ids.shipment} RETURNING shipment_id`;
    assert.equal(updated.length, 0);
    // fn_cancel_shipment is granted to service_role only (T4 restates it), so a non-service caller never reaches the refund guard.
    await rejects(tx, (sp) => sp`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'x', 0::bigint)`,
      'permission denied for function fn_cancel_shipment');
    await asOwner(tx);
    assert.equal(await shipmentStatus(tx), 'paid');
    assert.equal((await op(tx)).refund_resolved_at, null);
  }],
  ['P2 only fn_resolve_shipment_cancellation_refund writes refund_resolved_*; fn_cancel_shipment, the B2.4a list and the refund event RPC only read it', async (tx) => {
    await asOwner(tx);
    const rows = await tx`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosrc ILIKE '%refund_resolved_at%' ORDER BY 1`;
    assert.deepEqual(rows.map((r: { proname: string }) => r.proname), ['fn_apply_shipment_cancellation_refund_event', 'fn_cancel_shipment', 'fn_list_shipment_refund_problems', 'fn_resolve_shipment_cancellation_refund']);
    const trig = await tx`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.shipment_cancellation_operations'::regclass AND NOT tgisinternal`;
    assert.equal(trig.length, 0);
  }],
  ['P3 after resolving a failed-before-success refund, Stripe replays never re-cancel, re-notify or flip the status', async (tx) => {
    await start(tx);
    await apply(tx, 're_p3', 'failed', 'lost_or_stolen_card');
    assert.equal((await resolve(tx)).shipment_cancelled, true);
    const before = await op(tx);
    const notices = await count(tx, `SELECT count(*)::int AS n FROM public.notifications WHERE event_payload->>'shipment_id' = '${ids.shipment}'`);
    assert.equal((await apply(tx, 're_p3', 'failed', 'lost_or_stolen_card')).outcome, 'unchanged');
    assert.equal((await apply(tx, 're_p3', 'succeeded')).outcome, 'after_resolution');
    assert.equal((await apply(tx, 're_other', 'succeeded')).outcome, 'after_resolution');
    assert.deepEqual(await op(tx), before);
    assert.equal(await shipmentStatus(tx), 'cancelled');
    assert.equal(await count(tx, `SELECT count(*)::int AS n FROM public.notifications WHERE event_payload->>'shipment_id' = '${ids.shipment}'`), notices);
    // A new caller cannot claim again; the direct complete is ALREADY_CANCELLED.
    await rejects(tx, (sp) => sp`SELECT public.fn_claim_shipment_cancellation(
      ${ids.shipment}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'again')`, 'SHIPMENT_NOT_CANCELABLE');
    const [direct] = await tx`SELECT * FROM public.fn_cancel_shipment(${ids.shipment}::uuid, 'buyer', 'x', 0::bigint)`;
    assert.equal(direct.success, true);
    assert.equal(direct.error_message, 'ALREADY_CANCELLED');
  }],
  ['P4 a cancellation failure inside the resolution commits nothing: no resolution, no audit row, no system_logs row, shipment still open', async (tx) => {
    await start(tx);
    await apply(tx, 're_p4', 'canceled');
    await asOwner(tx);
    await tx.unsafe("CREATE FUNCTION pg_temp.p4_boom() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''P4_BOOM''; END'");
    await tx.unsafe('CREATE TRIGGER p4_boom BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION pg_temp.p4_boom()');
    const logs = await count(tx, 'SELECT count(*)::int AS n FROM public.system_logs');
    await asService(tx);
    await rejects(tx, (sp) => resolve(sp), 'CANCELLATION_COMPLETE_FAILED');
    await asOwner(tx);
    const after = await op(tx);
    assert.equal(after.refund_resolved_at, null);
    assert.equal(after.refund_resolution_reference, null);
    assert.equal(await count(tx, `SELECT count(*)::int AS n FROM public.admin_audit_logs WHERE target_id = '${ids.shipment}'`), 0);
    assert.equal(await count(tx, 'SELECT count(*)::int AS n FROM public.system_logs'), logs);
    assert.equal(await shipmentStatus(tx), 'paid');
  }],
  ['P5 a preparing_timeout operation on a preparing shipment completes as system', async (tx) => {
    await start(tx, 'preparing_timeout');
    await apply(tx, 're_p5', 'failed');
    assert.deepEqual(await resolve(tx), { resolved: true, shipment_cancelled: true, amount_owed_cents: amount, reference });
    assert.equal(await shipmentStatus(tx), 'cancelled');
    const product = await tx`SELECT status FROM public.products WHERE id = ${ids.product}`;
    assert.equal(product[0].status, 'VERIFIED');
  }, 'preparing'],
  ['P6 ADMIN_REQUIRED for a banned admin and an unknown uuid; a NULL-status admin is accepted (is_admin rule)', async (tx) => {
    await start(tx);
    await apply(tx, 're_p6', 'failed');
    await rejects(tx, (sp) => resolve(sp, reference, '7b31f000-0000-4000-8000-0000000000ee'), 'ADMIN_REQUIRED');
    await asOwner(tx);
    await tx`UPDATE public.profiles_private SET status = 'banned' WHERE id = ${ids.admin}`;
    await asService(tx);
    await rejects(tx, (sp) => resolve(sp), 'ADMIN_REQUIRED');
    await asOwner(tx);
    await tx`UPDATE public.profiles_private SET status = NULL WHERE id = ${ids.admin}`;
    await asService(tx);
    assert.equal((await resolve(tx)).resolved, true);
  }],
  ['P7 the resolution leaves the B2.2.1 escalation markers untouched (clearing them is B2.4)', async (tx) => {
    await start(tx);
    await apply(tx, 're_p7', 'failed');
    await tx`SELECT public.fn_escalate_shipment_cancellation(${ids.shipment}::uuid, 'refund_not_found')`;
    const before = await op(tx);
    assert.ok(before.recovery_escalated_at instanceof Date);
    await resolve(tx);
    const after = await op(tx);
    assert.deepEqual(after.recovery_escalated_at, before.recovery_escalated_at);
    assert.equal(after.recovery_escalation_reason, 'refund_not_found');
  }],
  ['P8 admin and reference checks come first: a buyer id on a pending refund raises ADMIN_REQUIRED, then INVALID_RESOLUTION_REFERENCE, then REFUND_NOT_RESOLVABLE', async (tx) => {
    await start(tx);
    await apply(tx, 're_p8', 'pending');
    await rejects(tx, (sp) => resolve(sp, reference, ids.buyer), 'ADMIN_REQUIRED');
    await rejects(tx, (sp) => resolve(sp, '   ', ids.admin), 'INVALID_RESOLUTION_REFERENCE');
    await rejects(tx, (sp) => resolve(sp), 'REFUND_NOT_RESOLVABLE');
  }],
];

const sql = new SQL(databaseUrl(), { max: 1, connectionTimeout: 5 });
let failed = 0;
try {
  for (const [name, body, status] of cases) {
    try {
      await sql.begin(async (tx) => {
        await fixture(tx as Tx, status);
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
  const [left] = await sql`SELECT count(*)::int AS n FROM public.orders WHERE id = ${ids.order}`;
  assert.equal(left.n, 0);
} finally {
  await sql.close();
}
console.log(`${cases.length - failed} pass, ${failed} fail`);
if (failed) process.exit(1);
