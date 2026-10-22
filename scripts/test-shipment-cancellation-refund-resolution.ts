import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-shipment-cancellation-refund-resolution.ts [--help]\n' +
  'B2.3.1 SQL: the service-only fn_resolve_shipment_cancellation_refund lets an admin mark a failed/canceled\n' +
  'shipment refund as resolved with a reference (audited), and completes a cancellation whose refund failed\n' +
  'before success. fn_cancel_shipment accepts a resolved refund.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b310000-0000-4000-8000-000000000001',
  shipment: '7b310000-0000-4000-8000-000000000011',
  sibling: '7b310000-0000-4000-8000-000000000012',
  product: '00000000-0000-4000-8000-0000000000b1',
  siblingProduct: '00000000-0000-4000-8000-0000000000b2',
};
const paymentIntent = 'pi_b231_local';
const amounts: Record<string, number> = { [ids.shipment]: 11000, [ids.sibling]: 7000 };
const reference = 'SPEI-2026-10-21-0001';

type Tx = SQL;
type Resolution = {
  resolved: boolean;
  shipment_cancelled: boolean;
  amount_owed_cents: number;
  reference: string;
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

async function asOwner(tx: Tx) {
  await tx`RESET ROLE`;
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
  await tx`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id, actual_stripe_fee_cents)
    VALUES (${ids.order}, ${ids.buyer}, 180, '{}'::jsonb, 'paid', ${paymentIntent}, 500)`;
  await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id)
    VALUES (${ids.shipment}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}),
           (${ids.sibling}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent})`;
  await tx`INSERT INTO public.order_items (order_id, product_id, seller_id, price_at_purchase, net_payout, shipment_id)
    VALUES (${ids.order}, ${ids.product}, ${ids.seller}, 7500, 7000, ${ids.shipment}),
           (${ids.order}, ${ids.siblingProduct}, ${ids.seller}, 3900, 3500, ${ids.sibling})`;
  await tx`UPDATE public.products SET status = 'SOLD' WHERE id IN (${ids.product}, ${ids.siblingProduct})`;
  await tx`UPDATE public.wallets SET pending_balance = 20000 WHERE user_id = ${ids.seller}`;
  await asService(tx);
}

/** Claims and starts through the real B1 RPCs, so the fence is genuine. */
async function start(
  tx: Tx,
  shipmentId: string,
  source: 'buyer' | 'seller' | 'paid_timeout' = 'buyer',
  lossCents = 0,
) {
  const actor = source === 'buyer' ? ids.buyer : source === 'seller' ? ids.seller : null;
  const [{ claim }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${shipmentId}::uuid, ${ids.order}::uuid, ${actor}::uuid, ${source}, 'Changed my mind') AS claim`;
  assert.equal(claim.status, 'claimed');
  await tx`SELECT public.fn_start_shipment_cancellation_refund(
    ${shipmentId}::uuid, ${claim.claim_token}::uuid, ${JSON.stringify(request(shipmentId, source === 'paid_timeout' ? 'system' : source))}::text::jsonb, ${lossCents}::bigint)`;
}

/** Applies a Stripe refund snapshot through the B2.3 RPC (the real path for async outcomes). */
async function apply(tx: Tx, shipmentId: string, refundId: string, status: string, reason: string | null = null) {
  const [{ result }] = await tx`SELECT public.fn_apply_shipment_cancellation_refund_event(
    ${shipmentId}::uuid, ${refundId}, ${paymentIntent}, ${amounts[shipmentId]}::bigint, ${status}, ${reason}) AS result`;
  return result as { outcome: string };
}

async function resolve(
  tx: Tx,
  shipmentId: string,
  ref: string | null = reference,
  admin: string | null = ids.admin,
): Promise<Resolution> {
  const [{ result }] = await tx`SELECT public.fn_resolve_shipment_cancellation_refund(
    ${shipmentId}::uuid, ${admin}::uuid, ${ref}) AS result`;
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
  return await tx`SELECT user_id, event_payload FROM public.notifications
    WHERE event_kind = ${kind} AND event_payload->>'shipment_id' = ${shipmentId} ORDER BY user_id`;
}

async function auditRows(tx: Tx, shipmentId = ids.shipment) {
  return await tx`SELECT admin_id, action_type, target_id, details FROM public.admin_audit_logs
    WHERE action_type = 'SHIPMENT_REFUND_RESOLVED' AND target_id = ${shipmentId}`;
}

async function adjustments(tx: Tx) {
  return await tx`SELECT net_amount, description FROM public.wallet_transactions
    WHERE shipment_id = ${ids.shipment} AND type = 'adjustment'`;
}

async function rejects(tx: Tx, action: (sp: Tx) => Promise<unknown>, message: string) {
  await assert.rejects(
    tx.savepoint((sp) => action(sp as Tx)),
    (error: Error) => error.message.includes(message),
    `expected ${message}`,
  );
}

async function cancelDirect(tx: Tx, shipmentId = ids.shipment) {
  const [row] = await tx`SELECT * FROM public.fn_cancel_shipment(
    ${shipmentId}::uuid, 'buyer', 'Changed my mind', 0::bigint)`;
  return row as { success: boolean; error_message: string | null };
}

const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  [
    'resolving after a late failure keeps the shipment cancelled, writes one audit row and no second shipment.cancelled',
    async (tx) => {
      await start(tx, ids.shipment);
      assert.equal((await apply(tx, ids.shipment, 're_1', 'succeeded')).outcome, 'completed');
      assert.equal((await apply(tx, ids.shipment, 're_1', 'failed', 'expired_or_canceled_card')).outcome, 'failed_after_cancellation');
      const noticesBefore = (await notifications(tx, 'shipment.cancelled')).length;
      assert.equal(noticesBefore, 2);
      const adjustmentsBefore = (await adjustments(tx)).length;

      assert.deepEqual(await resolve(tx, ids.shipment, `  ${reference}  `), {
        resolved: true,
        shipment_cancelled: false,
        amount_owed_cents: 11000,
        reference,
      });

      const state = await snapshot(tx, ids.shipment);
      assert.equal(state.shipment, 'cancelled');
      assert.equal(state.operation.refund_status, 'failed');
      assert.equal(state.operation.refund_resolved_by, ids.admin);
      assert.equal(state.operation.refund_resolution_reference, reference);
      assert.ok(state.operation.refund_resolved_at instanceof Date);
      assert.equal((await notifications(tx, 'shipment.cancelled')).length, noticesBefore);
      assert.equal((await adjustments(tx)).length, adjustmentsBefore);

      const rows = await auditRows(tx);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].admin_id, ids.admin);
      assert.equal(rows[0].target_id, ids.shipment);
      assert.deepEqual(
        { ...rows[0].details },
        {
          refund_id: 're_1',
          refund_status: 'failed',
          amount_owed_cents: 11000,
          reference,
          shipment_status_before: 'cancelled',
        },
      );
    },
  ],
  [
    'resolving a refund that failed before success cancels the shipment: products VERIFIED, notices, wallet adjustment, frozen loss',
    async (tx) => {
      await start(tx, ids.shipment, 'buyer', 300);
      assert.equal((await apply(tx, ids.shipment, 're_1', 'pending')).outcome, 'recorded');
      assert.equal((await apply(tx, ids.shipment, 're_1', 'failed', 'lost_or_stolen_card')).outcome, 'failed_before_cancellation');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
      assert.equal(await productStatus(tx, ids.product), 'SOLD');
      assert.equal((await notifications(tx, 'shipment.cancelled')).length, 0);

      assert.deepEqual(await resolve(tx, ids.shipment), {
        resolved: true,
        shipment_cancelled: true,
        amount_owed_cents: 11000,
        reference,
      });

      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
      assert.equal(await productStatus(tx, ids.product), 'VERIFIED');
      assert.deepEqual(
        (await notifications(tx, 'shipment.cancelled'))
          .map((n: { event_payload: { recipient_role: string } }) => n.event_payload.recipient_role)
          .sort(),
        ['buyer', 'seller'],
      );
      const wallet = await adjustments(tx);
      assert.equal(wallet.length, 1);
      assert.equal(Number(wallet[0].net_amount), -7000);
      assert.ok(wallet[0].description.startsWith('Cancelación (buyer): Changed my mind'));
      const [order] = await tx`SELECT cancellation_loss_cents FROM public.orders WHERE id = ${ids.order}`;
      assert.equal(Number(order.cancellation_loss_cents), 300);
      const [audit] = await auditRows(tx);
      assert.equal(audit.details.shipment_status_before, 'paid');
      // The sibling shipment is untouched.
      assert.equal((await snapshot(tx, ids.sibling)).shipment, 'paid');
      assert.equal(await productStatus(tx, ids.siblingProduct), 'SOLD');
    },
  ],
  [
    'a canceled refund before success is resolvable too and completes with the stored winner (timeout -> system, seller -> seller)',
    async (tx) => {
      await start(tx, ids.shipment, 'paid_timeout');
      await start(tx, ids.sibling, 'seller');
      await apply(tx, ids.shipment, 're_1', 'requires_action');
      await apply(tx, ids.shipment, 're_1', 'canceled');
      await apply(tx, ids.sibling, 're_2', 'failed');
      assert.equal((await resolve(tx, ids.shipment)).shipment_cancelled, true);
      assert.equal((await resolve(tx, ids.sibling)).shipment_cancelled, true);
      const [system] = await tx`SELECT description FROM public.wallet_transactions
        WHERE shipment_id = ${ids.shipment} AND type = 'adjustment'`;
      const [seller] = await tx`SELECT description FROM public.wallet_transactions
        WHERE shipment_id = ${ids.sibling} AND type = 'adjustment'`;
      assert.ok(system.description.startsWith('Cancelación (system): '));
      assert.ok(seller.description.startsWith('Cancelación (seller): '));
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
      assert.equal((await snapshot(tx, ids.sibling)).shipment, 'cancelled');
    },
  ],
  [
    'a second resolve is idempotent: it never overwrites the reference or admin, writes no second audit row and cancels nothing twice',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'failed');
      await resolve(tx, ids.shipment);
      const before = await snapshot(tx, ids.shipment);
      const noticesBefore = (await notifications(tx, 'shipment.cancelled')).length;

      // A second, different admin: promote the seller inside this transaction.
      await asOwner(tx);
      await tx`UPDATE public.profiles_private SET role = 'admin' WHERE id = ${ids.seller}`;
      await asService(tx);
      const again = await resolve(tx, ids.shipment, 'OTHER-REFERENCE', ids.seller);
      assert.deepEqual(again, {
        resolved: false,
        shipment_cancelled: false,
        amount_owed_cents: 11000,
        reference,
      });
      assert.deepEqual(await snapshot(tx, ids.shipment), before);
      assert.equal((await auditRows(tx)).length, 1);
      assert.equal((await notifications(tx, 'shipment.cancelled')).length, noticesBefore);
      assert.equal((await adjustments(tx)).length, 1);
    },
  ],
  [
    'refuses a pending, requires_action or succeeded refund with REFUND_NOT_RESOLVABLE and leaves the state unchanged',
    async (tx) => {
      await start(tx, ids.shipment);
      await start(tx, ids.sibling);
      await apply(tx, ids.shipment, 're_1', 'pending');
      await apply(tx, ids.sibling, 're_2', 'requires_action');
      for (const id of [ids.shipment, ids.sibling]) {
        const before = await snapshot(tx, id);
        await rejects(tx, (sp) => resolve(sp, id), 'REFUND_NOT_RESOLVABLE');
        assert.deepEqual(await snapshot(tx, id), before);
        assert.equal((await auditRows(tx, id)).length, 0);
      }
      assert.equal(await productStatus(tx, ids.product), 'SOLD');

      // Succeeded (cancelled shipment): nothing is owed, so nothing to resolve.
      await apply(tx, ids.shipment, 're_1', 'succeeded');
      const before = await snapshot(tx, ids.shipment);
      await rejects(tx, (sp) => resolve(sp, ids.shipment), 'REFUND_NOT_RESOLVABLE');
      assert.deepEqual(await snapshot(tx, ids.shipment), before);
      assert.equal((await auditRows(tx)).length, 0);
    },
  ],
  [
    'refuses a shipment with no refund recorded: unstarted, claimed only, started without a refund, escalated without a refund',
    async (tx) => {
      // No operation at all.
      await rejects(tx, (sp) => resolve(sp, ids.shipment), 'REFUND_NOT_RESOLVABLE');
      // Unknown shipment.
      await rejects(tx, (sp) => resolve(sp, '7b310000-0000-4000-8000-0000000000ff'), 'REFUND_NOT_RESOLVABLE');
      // Claimed only.
      await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.shipment}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'Changed my mind')`;
      await rejects(tx, (sp) => resolve(sp, ids.shipment), 'REFUND_NOT_RESOLVABLE');
      // Started, Stripe result never recorded; then escalated by recovery.
      await start(tx, ids.sibling);
      await rejects(tx, (sp) => resolve(sp, ids.sibling), 'REFUND_NOT_RESOLVABLE');
      await tx`SELECT public.fn_escalate_shipment_cancellation(${ids.sibling}::uuid, 'refund_not_found')`;
      const before = await snapshot(tx, ids.sibling);
      await rejects(tx, (sp) => resolve(sp, ids.sibling), 'REFUND_NOT_RESOLVABLE');
      assert.deepEqual(await snapshot(tx, ids.sibling), before);
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');
      assert.equal(
        (await tx`SELECT count(*)::int AS n FROM public.admin_audit_logs WHERE action_type = 'SHIPMENT_REFUND_RESOLVED'`)[0].n,
        0,
      );
    },
  ],
  [
    'a blank, null or too-long reference, or a missing admin, raises before anything is written; 200 characters is accepted',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'failed');
      const before = await snapshot(tx, ids.shipment);
      await rejects(tx, (sp) => resolve(sp, ids.shipment, ''), 'INVALID_RESOLUTION_REFERENCE');
      await rejects(tx, (sp) => resolve(sp, ids.shipment, '   '), 'INVALID_RESOLUTION_REFERENCE');
      await rejects(tx, (sp) => resolve(sp, ids.shipment, null), 'INVALID_RESOLUTION_REFERENCE');
      await rejects(tx, (sp) => resolve(sp, ids.shipment, 'x'.repeat(201)), 'INVALID_RESOLUTION_REFERENCE');
      await rejects(tx, (sp) => resolve(sp, ids.shipment, ` ${'x'.repeat(201)} `), 'INVALID_RESOLUTION_REFERENCE');
      await rejects(tx, (sp) => resolve(sp, ids.shipment, reference, null), 'ADMIN_REQUIRED');
      assert.deepEqual(await snapshot(tx, ids.shipment), before);
      assert.equal((await auditRows(tx)).length, 0);

      const longest = 'x'.repeat(200);
      assert.equal((await resolve(tx, ids.shipment, ` ${longest} `)).reference, longest);
      assert.equal((await snapshot(tx, ids.shipment)).operation.refund_resolution_reference, longest);
    },
  ],
  [
    'an unexpected shipment status (shipped) raises SHIPMENT_STATUS_UNEXPECTED and commits nothing, audit row included',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'failed');
      await asOwner(tx);
      await tx`UPDATE public.shipments SET status = 'shipped' WHERE id = ${ids.shipment}`;
      await asService(tx);
      const before = await snapshot(tx, ids.shipment);
      await rejects(tx, (sp) => resolve(sp, ids.shipment), 'SHIPMENT_STATUS_UNEXPECTED');
      assert.deepEqual(await snapshot(tx, ids.shipment), before);
      assert.equal(before.operation.refund_resolved_at, null);
      assert.equal((await auditRows(tx)).length, 0);
      assert.equal(await productStatus(tx, ids.product), 'SOLD');
    },
  ],
  [
    'fn_cancel_shipment still returns REFUND_NOT_SUCCEEDED for an unresolved failed refund, and accepts it once resolved',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'failed');
      assert.deepEqual(await cancelDirect(tx), { success: false, error_message: 'REFUND_NOT_SUCCEEDED' });
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'paid');

      await asOwner(tx);
      await tx`UPDATE public.shipment_cancellation_operations
        SET refund_resolved_at = now(), refund_resolved_by = ${ids.admin}, refund_resolution_reference = ${reference}
        WHERE shipment_id = ${ids.shipment}`;
      await asService(tx);
      assert.deepEqual(await cancelDirect(tx), { success: true, error_message: null });
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
    },
  ],
  [
    'fn_cancel_shipment still returns REFUND_NOT_SUCCEEDED for a pending refund, a missing operation and a NULL status',
    async (tx) => {
      assert.deepEqual(await cancelDirect(tx), { success: false, error_message: 'REFUND_NOT_SUCCEEDED' });
      await start(tx, ids.shipment);
      assert.deepEqual(await cancelDirect(tx), { success: false, error_message: 'REFUND_NOT_SUCCEEDED' });
      await apply(tx, ids.shipment, 're_1', 'pending');
      assert.deepEqual(await cancelDirect(tx), { success: false, error_message: 'REFUND_NOT_SUCCEEDED' });
      await apply(tx, ids.shipment, 're_1', 'succeeded');
      assert.equal((await snapshot(tx, ids.shipment)).shipment, 'cancelled');
    },
  ],
  [
    'CHECKs reject resolution columns on a succeeded or unrecorded operation, partial sets and invalid references',
    async (tx) => {
      await start(tx, ids.shipment);
      await start(tx, ids.sibling);
      await apply(tx, ids.sibling, 're_2', 'failed');
      await asOwner(tx);
      const set = (conn: Tx, shipmentId: string, columns: { at?: boolean; by?: boolean; ref?: string | null }) =>
        conn`UPDATE public.shipment_cancellation_operations SET
            refund_resolved_at = ${columns.at ? new Date() : null},
            refund_resolved_by = ${columns.by ? ids.admin : null},
            refund_resolution_reference = ${columns.ref ?? null}
          WHERE shipment_id = ${shipmentId}`;
      const all = { at: true, by: true, ref: reference };
      const check = 'shipment_cancellation_operations_refund_resolution';
      // No refund recorded yet, then succeeded: nothing to resolve either way.
      await rejects(tx, (sp) => set(sp, ids.shipment, all), check);
      await tx`UPDATE public.shipment_cancellation_operations
        SET refund_id = 're_1', refund_status = 'succeeded', refund_status_updated_at = now()
        WHERE shipment_id = ${ids.shipment}`;
      await rejects(tx, (sp) => set(sp, ids.shipment, all), check);
      // Partial sets and invalid references on a failed operation.
      await rejects(tx, (sp) => set(sp, ids.sibling, { at: true }), check);
      await rejects(tx, (sp) => set(sp, ids.sibling, { at: true, by: true }), check);
      await rejects(tx, (sp) => set(sp, ids.sibling, { by: true, ref: reference }), check);
      await rejects(tx, (sp) => set(sp, ids.sibling, { at: true, by: true, ref: '' }), check);
      await rejects(tx, (sp) => set(sp, ids.sibling, { at: true, by: true, ref: ' padded ' }), check);
      await rejects(tx, (sp) => set(sp, ids.sibling, { at: true, by: true, ref: 'x'.repeat(201) }), check);
      // A failed operation accepts a complete, valid set.
      await set(tx, ids.sibling, all);
      assert.equal((await snapshot(tx, ids.sibling)).operation.refund_resolution_reference, reference);
    },
  ],
  [
    'the RPC is a SECURITY DEFINER with an empty search_path executable only by service_role',
    async (tx) => {
      const sig = 'public.fn_resolve_shipment_cancellation_refund(uuid,uuid,text)';
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
    'authenticated cannot resolve a refund (permission denied)',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'failed');
      await tx`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await tx`SET LOCAL ROLE authenticated`;
      await rejects(tx, (sp) => resolve(sp, ids.shipment), 'permission denied');
    },
  ],
  [
    'anon cannot resolve a refund either (permission denied)',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'failed');
      await tx`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`;
      await tx`SET LOCAL ROLE anon`;
      await rejects(tx, (sp) => resolve(sp, ids.shipment), 'permission denied');
    },
  ],
  [
    'the admin id must be an active admin in profiles_private: a buyer or a suspended admin raises ADMIN_REQUIRED and writes nothing',
    async (tx) => {
      await start(tx, ids.shipment);
      await apply(tx, ids.shipment, 're_1', 'failed');
      const before = await snapshot(tx, ids.shipment);
      await rejects(tx, (sp) => resolve(sp, ids.shipment, reference, ids.buyer), 'ADMIN_REQUIRED');
      await asOwner(tx);
      await tx`UPDATE public.profiles_private SET status = 'suspended' WHERE id = ${ids.admin}`;
      await asService(tx);
      await rejects(tx, (sp) => resolve(sp, ids.shipment, reference, ids.admin), 'ADMIN_REQUIRED');
      assert.deepEqual(await snapshot(tx, ids.shipment), before);
      assert.equal((await auditRows(tx)).length, 0);
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
