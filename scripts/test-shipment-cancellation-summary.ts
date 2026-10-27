import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-shipment-cancellation-summary.ts [--help]\n' +
  'B5.5 SQL: fn_get_shipment_cancellation_summary per caller (buyer, seller, other user, anon, service role) and per\n' +
  'refund_state (processing, refunded, delayed).\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  seller: '00000000-0000-4000-8000-000000000002',
  buyer: '00000000-0000-4000-8000-000000000003',
  other: '00000000-0000-4000-8000-000000000004',
  order: '7b550000-0000-4000-8000-000000000001',
  shipment: '7b550000-0000-4000-8000-000000000011',
  paid: '7b550000-0000-4000-8000-000000000012',
  unknown: '7b550000-0000-4000-8000-0000000000ff',
};
const paymentIntent = 'pi_b55_local';

type Tx = SQL;
type Who = 'buyer' | 'seller' | 'other' | 'anon';
type Source = 'buyer' | 'seller' | 'paid_timeout' | 'preparing_timeout';

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
  await tx`RESET ROLE`;
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
}

/** Same session state PostgREST sets for a signed-in user or the anon key. */
async function as(tx: Tx, who: Who) {
  const claims = who === 'anon' ? { role: 'anon' } : { role: 'authenticated', sub: ids[who] };
  await tx`RESET ROLE`;
  await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
  await tx.unsafe(`SET LOCAL ROLE ${who === 'anon' ? 'anon' : 'authenticated'}`);
}

async function fixture(tx: Tx) {
  await tx`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id)
    VALUES (${ids.order}, ${ids.buyer}, 180, '{}'::jsonb, 'paid', ${paymentIntent})`;
  await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id, label_generation_state)
    VALUES (${ids.shipment}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'unclaimed'),
           (${ids.paid}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'unclaimed')`;
  await asService(tx);
}

async function claim(tx: Tx, source: Source = 'seller') {
  const actor = source === 'buyer' ? ids.buyer : source === 'seller' ? ids.seller : null;
  const [{ claim: claimed }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${ids.shipment}::uuid, ${ids.order}::uuid, ${actor}::uuid, ${source}, 'private free-text reason') AS claim`;
  assert.equal(claimed.status, 'claimed');
}

/** Direct row edits put the operation into each state the cancellation RPCs can leave it in. */
async function set(tx: Tx, assignments: string) {
  await tx.unsafe(
    `UPDATE public.shipment_cancellation_operations SET ${assignments} WHERE shipment_id = '${ids.shipment}'`,
  );
}

async function summary(tx: Tx, who: Who, shipmentId = ids.shipment) {
  await as(tx, who);
  const rows = await tx`SELECT * FROM public.fn_get_shipment_cancellation_summary(${shipmentId}::uuid)`;
  await asService(tx);
  return rows;
}

async function stateFor(tx: Tx, who: 'buyer' | 'seller' = 'buyer') {
  const [row] = await summary(tx, who);
  assert.ok(row, 'expected one row');
  return row.refund_state as string;
}

const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  [
    'buyer and seller of the shipment each get one row with only source, refund_state and refund_updated_at',
    async (tx) => {
      await claim(tx, 'seller');
      for (const who of ['buyer', 'seller'] as const) {
        const rows = await summary(tx, who);
        assert.equal(rows.length, 1);
        assert.deepEqual(Object.keys(rows[0]).sort(), [
          'refund_state',
          'refund_updated_at',
          'source',
        ]);
        assert.equal(rows[0].source, 'seller');
        assert.equal(rows[0].refund_state, 'processing');
        assert.equal(rows[0].refund_updated_at, null);
      }
    },
  ],
  [
    'another signed-in user, an unknown shipment and a shipment without an operation get zero rows and no error',
    async (tx) => {
      await claim(tx, 'buyer');
      assert.equal((await summary(tx, 'other')).length, 0);
      assert.equal((await summary(tx, 'buyer', ids.unknown)).length, 0);
      assert.equal((await summary(tx, 'buyer', ids.paid)).length, 0);
      assert.equal((await summary(tx, 'seller', ids.paid)).length, 0);
    },
  ],
  [
    'anon cannot execute it (permission denied); the service role gets zero rows (no auth.uid())',
    async (tx) => {
      await claim(tx);
      await assert.rejects(
        tx.savepoint(async (sp) => {
          await as(sp as Tx, 'anon');
          await (sp as Tx)`SELECT * FROM public.fn_get_shipment_cancellation_summary(${ids.shipment}::uuid)`;
        }),
        (error: Error) => error.message.includes('permission denied'),
      );
      await asService(tx);
      const rows = await tx`SELECT * FROM public.fn_get_shipment_cancellation_summary(${ids.shipment}::uuid)`;
      assert.equal(rows.length, 0);
    },
  ],
  [
    'source is returned verbatim for each of the four sources',
    async (tx) => {
      for (const source of ['buyer', 'seller', 'paid_timeout'] as const) {
        await tx`DELETE FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
        await claim(tx, source);
        const [row] = await summary(tx, 'buyer');
        assert.equal(row.source, source);
      }
      await tx`DELETE FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
      await tx`UPDATE public.shipments SET status = 'preparing', label_generation_state = 'generated' WHERE id = ${ids.shipment}`;
      await claim(tx, 'preparing_timeout');
      assert.equal((await summary(tx, 'seller'))[0].source, 'preparing_timeout');
    },
  ],
  [
    'processing: no refund yet, pending, requires_action, and approved-after-review without a refund',
    async (tx) => {
      await claim(tx);
      assert.equal(await stateFor(tx), 'processing');
      for (const status of ['pending', 'requires_action']) {
        await set(
          tx,
          `refund_id = 're_b55', refund_status = '${status}', refund_status_updated_at = '2026-01-02T03:04:05Z'`,
        );
        assert.equal(await stateFor(tx), 'processing');
        const [row] = await summary(tx, 'seller');
        assert.equal(new Date(row.refund_updated_at).toISOString(), '2026-01-02T03:04:05.000Z');
      }
      await set(
        tx,
        `refund_id = NULL, refund_status = NULL, refund_status_updated_at = NULL,
        review_reason = 'carrier_refused', review_required_at = now(), review_resolution = 'refund_approved',
        review_resolved_at = now(), review_resolved_by = '${ids.admin}', review_resolution_note = 'approved'`,
      );
      assert.equal(await stateFor(tx), 'processing');
    },
  ],
  [
    'refunded: succeeded; a failed refund an admin marked resolved',
    async (tx) => {
      await claim(tx);
      await set(tx, `refund_id = 're_b55', refund_status = 'succeeded', refund_status_updated_at = now()`);
      assert.equal(await stateFor(tx), 'refunded');
      await set(tx, `refund_status = 'failed', refund_failure_reason = 'lost_or_stolen_card'`);
      assert.equal(await stateFor(tx), 'delayed');
      await set(
        tx,
        `refund_resolved_at = now(), refund_resolved_by = '${ids.admin}', refund_resolution_reference = 'SPEI-1'`,
      );
      assert.equal(await stateFor(tx), 'refunded');
    },
  ],
  [
    'delayed: failed, canceled, escalated without a refund, under carrier review, review closed without refund',
    async (tx) => {
      await claim(tx);
      for (const status of ['failed', 'canceled']) {
        await set(
          tx,
          `refund_id = 're_b55', refund_status = '${status}', refund_status_updated_at = now()`,
        );
        assert.equal(await stateFor(tx), 'delayed');
      }
      await set(
        tx,
        `refund_id = NULL, refund_status = NULL, refund_status_updated_at = NULL,
        recovery_escalated_at = now(), recovery_escalation_reason = 'refund_not_found'`,
      );
      assert.equal(await stateFor(tx), 'delayed');
      await set(
        tx,
        `recovery_escalated_at = NULL, recovery_escalation_reason = NULL,
        review_reason = 'tracking_unknown', review_required_at = now()`,
      );
      assert.equal(await stateFor(tx), 'delayed');
      await set(
        tx,
        `review_resolution = 'closed_no_refund', review_resolved_at = now(),
        review_resolved_by = '${ids.admin}', review_resolution_note = 'no refund'`,
      );
      assert.equal(await stateFor(tx), 'delayed');
    },
  ],
  [
    'a co-seller of the same order and a non-participant admin get zero rows',
    async (tx) => {
      await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id, label_generation_state)
        VALUES ('7b550000-0000-4000-8000-000000000013', ${ids.order}, ${ids.other}, 'paid', ${paymentIntent}, 'unclaimed')`;
      await claim(tx, 'seller');
      assert.equal((await summary(tx, 'other')).length, 0);
      await tx`RESET ROLE`;
      await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ role: 'authenticated', sub: ids.admin })}, true)`;
      await tx`SET LOCAL ROLE authenticated`;
      assert.equal(
        (await tx`SELECT * FROM public.fn_get_shipment_cancellation_summary(${ids.shipment}::uuid)`).length,
        0,
      );
      await asService(tx);
    },
  ],
  [
    'the buyer is read from the order recorded on the cancellation operation',
    async (tx) => {
      await claim(tx, 'seller');
      await tx`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id)
        VALUES ('7b550000-0000-4000-8000-000000000002', ${ids.other}, 180, '{}'::jsonb, 'paid', 'pi_b55_other')`;
      await tx`UPDATE public.shipments SET order_id = '7b550000-0000-4000-8000-000000000002' WHERE id = ${ids.shipment}`;
      assert.equal((await summary(tx, 'other')).length, 0);
      assert.equal((await summary(tx, 'buyer')).length, 1);
      assert.equal((await summary(tx, 'seller')).length, 1);
    },
  ],
  [
    'catalog: definer, STABLE, empty search_path, anon cannot execute',
    async (tx) => {
      await tx`RESET ROLE`;
      const [p] = await tx`SELECT prosecdef, provolatile, proconfig,
        has_function_privilege('anon', oid, 'EXECUTE') AS anon_x,
        has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_x
        FROM pg_proc WHERE oid = 'public.fn_get_shipment_cancellation_summary(uuid)'::regprocedure`;
      assert.deepEqual(
        [p.prosecdef, p.provolatile, p.proconfig, p.anon_x, p.auth_x],
        [true, 's', ['search_path=""'], false, true],
      );
      await asService(tx);
    },
  ],
  [
    'reading writes nothing: the operation row is unchanged',
    async (tx) => {
      await claim(tx);
      const [before] = await tx`SELECT * FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
      await summary(tx, 'buyer');
      await summary(tx, 'other');
      const [after] = await tx`SELECT * FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
      assert.deepEqual(after, before);
    },
  ],
];

async function main() {
  if (process.argv.includes('--help')) {
    console.log(help);
    return;
  }
  const db = new SQL(databaseUrl());
  let failures = 0;
  for (const [name, run] of cases) {
    try {
      await db.begin(async (tx) => {
        await fixture(tx as Tx);
        await run(tx as Tx);
        throw new Rollback();
      });
    } catch (error) {
      if (error instanceof Rollback) {
        console.log(`ok - ${name}`);
      } else {
        failures += 1;
        console.log(`not ok - ${name}\n  ${(error as Error).message}`);
      }
    }
  }
  await db.close();
  console.log(`${cases.length - failures}/${cases.length} passed`);
  if (failures > 0) process.exit(1);
}

await main();
