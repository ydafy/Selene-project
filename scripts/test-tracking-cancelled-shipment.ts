import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-tracking-cancelled-shipment.ts [--help]\n' +
  'B4.4b SQL (S4): fn_record_tracking_event never moves a cancelled shipment, whatever transition the carrier event carries,\n' +
  'and still records the event row; a preparing shipment still advances (control).\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b440000-0000-4000-8000-0000000000a1',
  cancelled: '7b440000-0000-4000-8000-0000000000a2',
  preparing: '7b440000-0000-4000-8000-0000000000a3',
};
const eventTypes = [
  'created',
  'information',
  'in_transit',
  'delivered',
  'exception',
  'returned',
];
const transitions = ['shipped', 'delivered', null] as const;

type Tx = SQL;

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

async function fixture(tx: Tx) {
  await tx`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status)
    VALUES (${ids.order}, ${ids.buyer}, 180, '{}'::jsonb, 'paid')`;
  await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, label_generation_state, tracking_number, carrier)
    VALUES (${ids.cancelled}, ${ids.order}, ${ids.seller}, 'cancelled', 'generated', 'TRK-B44B-1', 'estafeta'),
           (${ids.preparing}, ${ids.order}, ${ids.seller}, 'preparing', 'generated', 'TRK-B44B-2', 'estafeta')`;
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
}

async function record(
  tx: Tx,
  shipmentId: string,
  eventType: string,
  transition: string | null,
  eventAt: string,
  rawStatus: string,
) {
  const [{ result }] = await tx`SELECT public.fn_record_tracking_event(
    ${shipmentId}::uuid, NULL::uuid, ${eventType}::public.shipment_tracking_event_type, ${eventAt}::timestamptz,
    ${rawStatus}, 'CDMX', NULL::text, 'Estafeta', NULL::uuid, NULL::uuid,
    ${transition}::public.order_status_enum) AS result`;
  return result;
}

async function shipment(tx: Tx, shipmentId: string) {
  const [row] = await tx`SELECT status, shipped_at, delivered_at FROM public.shipments WHERE id = ${shipmentId}`;
  return row;
}

async function eventCount(tx: Tx, shipmentId: string) {
  const [{ n }] = await tx`SELECT count(*)::int AS n FROM public.shipment_tracking_events WHERE shipment_id = ${shipmentId}`;
  return n as number;
}

const cases: [string, (tx: Tx) => Promise<void>][] = [];

for (const eventType of eventTypes) {
  for (const transition of transitions) {
    cases.push([
      `cancelled shipment stays cancelled and the event is recorded: ${eventType} / ${transition ?? 'no transition'}`,
      async (tx) => {
        const before = await shipment(tx, ids.cancelled);
        const result = await record(
          tx,
          ids.cancelled,
          eventType,
          transition,
          '2026-10-22T10:00:00Z',
          `raw ${eventType} ${transition}`,
        );
        assert.equal(result.inserted, true);
        assert.equal(result.shipment_status, 'cancelled');
        assert.deepEqual(await shipment(tx, ids.cancelled), before);
        assert.equal(before.status, 'cancelled');
        assert.equal(before.shipped_at, null);
        assert.equal(before.delivered_at, null);
        assert.equal(await eventCount(tx, ids.cancelled), 1);
      },
    ]);
  }
}

cases.push(
  [
    'a shipped then delivered sequence on a cancelled shipment moves nothing and keeps both events',
    async (tx) => {
      await record(tx, ids.cancelled, 'in_transit', 'shipped', '2026-10-22T10:00:00Z', 'Picked up');
      const second = await record(tx, ids.cancelled, 'delivered', 'delivered', '2026-10-23T10:00:00Z', 'Delivered');
      assert.equal(second.shipment_status, 'cancelled');
      const row = await shipment(tx, ids.cancelled);
      assert.equal(row.status, 'cancelled');
      assert.equal(row.shipped_at, null);
      assert.equal(row.delivered_at, null);
      assert.equal(await eventCount(tx, ids.cancelled), 2);
    },
  ],
  [
    'replaying the same event on a cancelled shipment is a no-op that stays cancelled',
    async (tx) => {
      await record(tx, ids.cancelled, 'in_transit', 'shipped', '2026-10-22T10:00:00Z', 'Picked up');
      const replay = await record(tx, ids.cancelled, 'in_transit', 'shipped', '2026-10-22T10:00:00Z', 'Picked up');
      assert.equal(replay.inserted, false);
      assert.equal(replay.shipment_status, 'cancelled');
      assert.equal((await shipment(tx, ids.cancelled)).status, 'cancelled');
      assert.equal(await eventCount(tx, ids.cancelled), 1);
    },
  ],
  [
    'control: a preparing shipment still advances to shipped on a shipped transition (the check can detect movement)',
    async (tx) => {
      const result = await record(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-22T10:00:00Z', 'Picked up');
      assert.equal(result.inserted, true);
      assert.equal(result.shipment_status, 'shipped');
      const row = await shipment(tx, ids.preparing);
      assert.equal(row.status, 'shipped');
      assert.ok(row.shipped_at);
    },
  ],
);

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
