import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-shipment-carrier-cancellation.ts [--help]\n' +
  'B4.2 SQL: carrier cancellation outcome (accepted/refused/ambiguous) and label-cost loss on the cancellation operation\n' +
  "(fn_record_shipment_carrier_cancellation) and the CARRIER_CANCELLATION_NOT_CONFIRMED guard of fn_start_shipment_cancellation_refund.\n" +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b400000-0000-4000-8000-000000000001',
  shipment: '7b400000-0000-4000-8000-000000000011',
  paid: '7b400000-0000-4000-8000-000000000012',
};
const paymentIntent = 'pi_b42_local';
const labelCost = 8900;
const amounts: Record<string, number> = { [ids.shipment]: 11000, [ids.paid]: 7000 };

type Tx = SQL;
type Source = 'preparing_timeout' | 'paid_timeout';

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

async function asRole(tx: Tx, role: 'anon' | 'authenticated' | 'service_role') {
  await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ role })}, true)`;
  await tx.unsafe(`SET LOCAL ROLE ${role}`);
}

function request(shipmentId: string, source: Source) {
  return {
    payment_intent: paymentIntent,
    amount: amounts[shipmentId],
    reason: 'requested_by_customer',
    metadata: {
      shipment_id: shipmentId,
      order_id: ids.order,
      caller_role: 'system',
      reason: `${source} test`,
      seguro_share_cents: 500,
    },
  };
}

async function fixture(tx: Tx) {
  await tx`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id)
    VALUES (${ids.order}, ${ids.buyer}, 180, '{}'::jsonb, 'paid', ${paymentIntent})`;
  await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id,
      label_generation_state, label_provider_cost_cents)
    VALUES (${ids.shipment}, ${ids.order}, ${ids.seller}, 'preparing', ${paymentIntent}, 'generated', ${labelCost}),
           (${ids.paid}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'unclaimed', NULL)`;
  await asService(tx);
}

async function claim(tx: Tx, shipmentId = ids.shipment, source: Source = 'preparing_timeout') {
  const [{ claim: claimed }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${shipmentId}::uuid, ${ids.order}::uuid, NULL::uuid, ${source}, ${`${source} test`}) AS claim`;
  assert.equal(claimed.status, 'claimed');
  return claimed.claim_token as string;
}

async function outcomeRpc(
  tx: Tx,
  token: string,
  outcome: string,
  balanceReturned: boolean | null = null,
  balanceReturnedAt: string | null = null,
  shipmentId = ids.shipment,
) {
  const [{ result }] = await tx`SELECT public.fn_record_shipment_carrier_cancellation(
    ${shipmentId}::uuid, ${token}::uuid, ${outcome}, ${balanceReturned}::boolean,
    ${balanceReturnedAt}::timestamptz) AS result`;
  return result;
}

async function operation(tx: Tx, shipmentId = ids.shipment) {
  const [row] = await tx`SELECT carrier_cancellation_outcome, carrier_cancellation_recorded_at,
      carrier_balance_returned, carrier_balance_returned_at, label_cost_loss_cents,
      cancellation_loss_cents, external_started_at, refund_request
    FROM public.shipment_cancellation_operations WHERE shipment_id = ${shipmentId}`;
  return row;
}

async function startRefund(tx: Tx, token: string, shipmentId = ids.shipment, source: Source = 'preparing_timeout') {
  const [{ result }] = await tx`SELECT public.fn_start_shipment_cancellation_refund(
    ${shipmentId}::uuid, ${token}::uuid, ${JSON.stringify(request(shipmentId, source))}::text::jsonb, 0::bigint) AS result`;
  return result;
}

async function rejects(tx: Tx, action: (sp: Tx) => Promise<unknown>, message: string) {
  await assert.rejects(
    tx.savepoint((sp) => action(sp as Tx)),
    (error: Error) => error.message.includes(message),
    `expected ${message}`,
  );
}

const returnedAt = '2026-10-23T10:00:00Z';

const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  [
    'accepted with the balance returned records loss 0',
    async (tx) => {
      const token = await claim(tx);
      const result = await outcomeRpc(tx, token, 'accepted', true, returnedAt);
      assert.equal(result.carrier_cancellation_outcome, 'accepted');
      assert.equal(result.carrier_balance_returned, true);
      assert.equal(Number(result.label_cost_loss_cents), 0);
      assert.equal(result.changed, true);
      const row = await operation(tx);
      assert.equal(row.carrier_cancellation_outcome, 'accepted');
      assert.ok(row.carrier_cancellation_recorded_at);
      assert.equal(row.carrier_balance_returned, true);
      assert.equal(new Date(row.carrier_balance_returned_at).toISOString(), '2026-10-23T10:00:00.000Z');
      assert.equal(Number(row.label_cost_loss_cents), 0);
      assert.equal(row.cancellation_loss_cents, null);
      assert.equal(row.external_started_at, null);
    },
  ],
  [
    'accepted without the balance returned records loss = the label provider cost',
    async (tx) => {
      const token = await claim(tx);
      const result = await outcomeRpc(tx, token, 'accepted', false);
      assert.equal(result.carrier_balance_returned, false);
      assert.equal(result.carrier_balance_returned_at, null);
      assert.equal(Number(result.label_cost_loss_cents), labelCost);
      const row = await operation(tx);
      assert.equal(row.carrier_balance_returned, false);
      assert.equal(row.carrier_balance_returned_at, null);
      assert.equal(Number(row.label_cost_loss_cents), labelCost);
    },
  ],
  [
    'accepted without the balance and with an unknown label cost records a NULL loss (unknown, not zero)',
    async (tx) => {
      await tx`UPDATE public.shipments SET label_provider_cost_cents = NULL WHERE id = ${ids.shipment}`;
      const token = await claim(tx);
      const result = await outcomeRpc(tx, token, 'accepted', false);
      assert.equal(result.label_cost_loss_cents, null);
      const row = await operation(tx);
      assert.equal(row.carrier_cancellation_outcome, 'accepted');
      assert.equal(row.label_cost_loss_cents, null);
    },
  ],
  [
    'refused and ambiguous record no balance and no loss',
    async (tx) => {
      for (const outcome of ['refused', 'ambiguous']) {
        const token = await claim(tx);
        const result = await outcomeRpc(tx, token, outcome);
        assert.equal(result.carrier_cancellation_outcome, outcome);
        assert.equal(result.carrier_balance_returned, null);
        assert.equal(result.label_cost_loss_cents, null);
        const row = await operation(tx);
        assert.equal(row.carrier_cancellation_outcome, outcome);
        assert.ok(row.carrier_cancellation_recorded_at);
        assert.equal(row.carrier_balance_returned, null);
        assert.equal(row.carrier_balance_returned_at, null);
        assert.equal(row.label_cost_loss_cents, null);
        await tx`DELETE FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
      }
    },
  ],
  [
    'refused and ambiguous reject balance inputs; accepted needs a balance flag; unknown outcomes are rejected',
    async (tx) => {
      const token = await claim(tx);
      const before = await operation(tx);
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'refused', true), 'INVALID_CARRIER_CANCELLATION_OUTCOME');
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'ambiguous', null, returnedAt), 'INVALID_CARRIER_CANCELLATION_OUTCOME');
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'accepted', null), 'INVALID_CARRIER_CANCELLATION_OUTCOME');
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'accepted', false, returnedAt), 'INVALID_CARRIER_CANCELLATION_OUTCOME');
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'cancelled', false), 'INVALID_CARRIER_CANCELLATION_OUTCOME');
      await rejects(tx, (sp) => outcomeRpc(sp, token, '  ', false), 'INVALID_CARRIER_CANCELLATION_OUTCOME');
      assert.deepEqual(await operation(tx), before);
    },
  ],
  [
    'an identical replay returns the stored row and changes nothing',
    async (tx) => {
      const token = await claim(tx);
      const first = await outcomeRpc(tx, token, 'accepted', true, returnedAt);
      const stored = await operation(tx);
      const replay = await outcomeRpc(tx, token, 'accepted', true, returnedAt);
      assert.equal(replay.changed, false);
      assert.deepEqual({ ...replay, changed: true }, first);
      assert.deepEqual(await operation(tx), stored);
    },
  ],
  [
    'a different replay raises CARRIER_CANCELLATION_ALREADY_RECORDED and keeps the stored outcome',
    async (tx) => {
      const token = await claim(tx);
      await outcomeRpc(tx, token, 'accepted', false);
      const stored = await operation(tx);
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'refused'), 'CARRIER_CANCELLATION_ALREADY_RECORDED');
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'accepted', true, returnedAt), 'CARRIER_CANCELLATION_ALREADY_RECORDED');
      assert.deepEqual(await operation(tx), stored);
    },
  ],
  [
    'a wrong claim token is rejected and the row is unchanged',
    async (tx) => {
      await claim(tx);
      const before = await operation(tx);
      await rejects(tx, (sp) => outcomeRpc(sp, '7b400000-0000-4000-8000-0000000000ff', 'refused'), 'STALE_CANCELLATION_CLAIM');
      assert.deepEqual(await operation(tx), before);
    },
  ],
  [
    'an expired claim is rejected and the row is unchanged',
    async (tx) => {
      const token = await claim(tx);
      await tx`UPDATE public.shipment_cancellation_operations SET claim_expires_at = '-infinity' WHERE shipment_id = ${ids.shipment}`;
      const before = await operation(tx);
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'refused'), 'CANCELLATION_CLAIM_EXPIRED');
      assert.deepEqual(await operation(tx), before);
    },
  ],
  [
    'a paid_timeout operation cannot record a carrier outcome',
    async (tx) => {
      const token = await claim(tx, ids.paid, 'paid_timeout');
      const before = await operation(tx, ids.paid);
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'accepted', true, returnedAt, ids.paid), 'INVALID_CARRIER_CANCELLATION_SOURCE');
      assert.deepEqual(await operation(tx, ids.paid), before);
    },
  ],
  [
    'a shipment that is no longer preparing is rejected and the row is unchanged',
    async (tx) => {
      const token = await claim(tx);
      await tx`UPDATE public.shipments SET status = 'shipped' WHERE id = ${ids.shipment}`;
      const before = await operation(tx);
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'refused'), 'SHIPMENT_NOT_CANCELABLE');
      assert.deepEqual(await operation(tx), before);
    },
  ],
  [
    'an operation whose external call already started is rejected and the row is unchanged',
    async (tx) => {
      const token = await claim(tx);
      await outcomeRpc(tx, token, 'accepted', true, returnedAt);
      await tx`UPDATE public.shipment_cancellation_operations SET carrier_cancellation_outcome = NULL,
          carrier_cancellation_recorded_at = NULL, carrier_balance_returned = NULL,
          carrier_balance_returned_at = NULL, label_cost_loss_cents = NULL,
          external_started_at = clock_timestamp() WHERE shipment_id = ${ids.shipment}`;
      const before = await operation(tx);
      assert.ok(before.external_started_at);
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'accepted', true, returnedAt), 'CANCELLATION_EXTERNAL_ALREADY_STARTED');
      assert.deepEqual(await operation(tx), before);
    },
  ],
  [
    'a missing operation or shipment is rejected',
    async (tx) => {
      await rejects(tx, (sp) => outcomeRpc(sp, ids.buyer, 'refused'), 'STALE_CANCELLATION_CLAIM');
      await rejects(
        tx,
        (sp) => outcomeRpc(sp, ids.buyer, 'refused', null, null, '7b400000-0000-4000-8000-0000000000fe'),
        'SHIPMENT_NOT_FOUND',
      );
    },
  ],
  [
    'anon and authenticated cannot execute the record RPC (grants)',
    async (tx) => {
      const token = await claim(tx);
      for (const role of ['anon', 'authenticated'] as const) {
        await tx.savepoint(async (sp) => {
          await asRole(sp as Tx, role);
          await rejects(sp as Tx, (inner) => outcomeRpc(inner, token, 'refused'), 'permission denied');
        });
      }
      await tx`RESET ROLE`;
      await asService(tx);
      assert.equal((await operation(tx)).carrier_cancellation_outcome, null);
    },
  ],
  [
    'no role can call the private start directly, so the carrier guard cannot be bypassed (grants match the remote project)',
    async (tx) => {
      const token = await claim(tx);
      for (const role of ['anon', 'authenticated', 'service_role'] as const) {
        await tx.savepoint(async (sp) => {
          await asRole(sp as Tx, role);
          await rejects(
            sp as Tx,
            (inner) => inner`SELECT public.fn_start_shipment_cancellation(${ids.shipment}::uuid, ${token}::uuid)`,
            'permission denied',
          );
        });
      }
      await tx`RESET ROLE`;
      await asService(tx);
      assert.equal((await operation(tx)).external_started_at, null);
    },
  ],
  [
    'the body checks the service role even when the grant is bypassed',
    async (tx) => {
      const token = await claim(tx);
      await tx`RESET ROLE`;
      await tx`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await rejects(tx, (sp) => outcomeRpc(sp, token, 'refused'), 'UNAUTHORIZED');
      await asService(tx);
      assert.equal((await operation(tx)).carrier_cancellation_outcome, null);
    },
  ],
  [
    'the refund start for a preparing timeout without an outcome fails and external_started_at stays NULL',
    async (tx) => {
      const token = await claim(tx);
      const before = await operation(tx);
      await rejects(tx, (sp) => startRefund(sp, token), 'CARRIER_CANCELLATION_NOT_CONFIRMED');
      assert.deepEqual(await operation(tx), before);
      assert.equal((await operation(tx)).external_started_at, null);
    },
  ],
  [
    'the refund start for a preparing timeout with a refused or ambiguous outcome fails and external_started_at stays NULL',
    async (tx) => {
      for (const outcome of ['refused', 'ambiguous']) {
        const token = await claim(tx);
        await outcomeRpc(tx, token, outcome);
        const before = await operation(tx);
        await rejects(tx, (sp) => startRefund(sp, token), 'CARRIER_CANCELLATION_NOT_CONFIRMED');
        assert.deepEqual(await operation(tx), before);
        assert.equal((await operation(tx)).external_started_at, null);
        await tx`DELETE FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
      }
    },
  ],
  [
    'the refund start for a preparing timeout with an accepted outcome succeeds and freezes the request',
    async (tx) => {
      const token = await claim(tx);
      await outcomeRpc(tx, token, 'accepted', false);
      const result = await startRefund(tx, token);
      assert.equal(result.operation_key, `cancel_shipment_${ids.shipment}`);
      assert.deepEqual(result.refund_request, request(ids.shipment, 'preparing_timeout'));
      const row = await operation(tx);
      assert.ok(row.external_started_at);
      assert.equal(Number(row.cancellation_loss_cents), 0);
      assert.equal(row.carrier_cancellation_outcome, 'accepted');
      assert.equal(Number(row.label_cost_loss_cents), labelCost);
    },
  ],
  [
    'a paid_timeout refund start is unaffected by the guard',
    async (tx) => {
      const token = await claim(tx, ids.paid, 'paid_timeout');
      const result = await startRefund(tx, token, ids.paid, 'paid_timeout');
      assert.equal(result.operation_key, `cancel_shipment_${ids.paid}`);
      const row = await operation(tx, ids.paid);
      assert.ok(row.external_started_at);
      assert.equal(row.carrier_cancellation_outcome, null);
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
