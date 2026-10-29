import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-shipment-label-reconciliation.ts [--help]\n' +
  'SQL: the admin bucket for shipments stuck in label generation (B6.1a): fn_list_shipment_label_reconciliations and\n' +
  'fn_resolve_shipment_label_reconciliation (label_found, no_label), then the readers that must accept a released row\n' +
  '(fn_claim_shipment_cancellation, fn_claim_shipment_label, the auto-cancel-orders selection). A FAIL shows the observed outcome.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  seller: '00000000-0000-4000-8000-000000000002',
  buyer: '00000000-0000-4000-8000-000000000003',
  order: '7b6a0000-0000-4000-8000-000000000001',
  orphan: '7b6a0000-0000-4000-8000-000000000011',
  staleClaimed: '7b6a0000-0000-4000-8000-000000000012',
  staleSent: '7b6a0000-0000-4000-8000-000000000013',
  freshClaimed: '7b6a0000-0000-4000-8000-000000000014',
  unclaimed: '7b6a0000-0000-4000-8000-000000000015',
  generated: '7b6a0000-0000-4000-8000-000000000016',
  preparingOrphan: '7b6a0000-0000-4000-8000-000000000017',
  unknown: '7b6a0000-0000-4000-8000-0000000000ff',
};
const paymentIntent = 'pi_b61a_local';

type Tx = SQL;
type Json = Record<string, unknown>;

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
  await tx`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status, stripe_payment_intent_id)
    VALUES (${ids.order}, ${ids.buyer}, 900, '{"city":"Guadalajara","zip_code":"44100"}'::jsonb, 'paid', ${paymentIntent})`;
  await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id,
      label_generation_state, claim_token, claim_expires_at, created_at, origin_address,
      label_quote_carrier, label_quote_service, label_quote_cost_cents, label_quote_rated_at)
    VALUES
      (${ids.orphan}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'orphan_pending', gen_random_uuid(), NULL,
        now() - interval '5 days', '{"city":"CDMX","zip_code":"06600","street_number":"1"}'::jsonb,
        'paquetexpress', 'ground', 9100, now() - interval '5 days'),
      (${ids.staleClaimed}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'claimed', gen_random_uuid(),
        now() - interval '2 hours', now() - interval '4 days', NULL, NULL, NULL, NULL, NULL),
      (${ids.staleSent}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'generation_sent', gen_random_uuid(),
        now() - interval '1 hour', now() - interval '3 days', NULL, NULL, NULL, NULL, NULL),
      (${ids.freshClaimed}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'claimed', gen_random_uuid(),
        now() + interval '10 minutes', now() - interval '2 days', NULL, NULL, NULL, NULL, NULL),
      (${ids.unclaimed}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'unclaimed', NULL, NULL,
        now() - interval '2 days', NULL, NULL, NULL, NULL, NULL),
      (${ids.generated}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'generated', NULL, NULL,
        now() - interval '2 days', NULL, NULL, NULL, NULL, NULL),
      (${ids.preparingOrphan}, ${ids.order}, ${ids.seller}, 'preparing', ${paymentIntent}, 'orphan_pending', gen_random_uuid(), NULL,
        now() - interval '2 days', NULL, NULL, NULL, NULL, NULL)`;
  await tx`INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id, metadata, created_at)
    VALUES (${ids.orphan}, 'claimed', ${ids.seller}, '{}'::jsonb, now() - interval '5 days 1 hour'),
           (${ids.orphan}, 'orphaned', NULL, '{"errorClass":"timeout"}'::jsonb, now() - interval '5 days')`;
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
}

const found = {
  envia: 'ENV-123',
  tracking: 'PXTRACK123',
  url: 'https://labels.example/pxtrack123.pdf',
  cost: 9300,
};

async function resolve(
  tx: Tx,
  shipmentId: string,
  resolution: string,
  note: string | null,
  extra: Partial<{
    envia: string | null;
    tracking: string | null;
    url: string | null;
    cost: number | null;
  }> = {},
  actor: string | null = ids.admin,
): Promise<Json> {
  const f = { envia: null, tracking: null, url: null, cost: null, ...extra };
  const [{ result }] =
    await tx`SELECT public.fn_resolve_shipment_label_reconciliation(
    ${shipmentId}::uuid, ${actor}::uuid, ${resolution}::text, ${note}::text,
    ${f.envia}::text, ${f.tracking}::text, ${f.url}::text, ${f.cost}::bigint) AS result`;
  return result as Json;
}

const labelFound = (
  tx: Tx,
  shipmentId: string,
  note: string | null = 'Guia vista en el panel de Envia',
) =>
  resolve(tx, shipmentId, 'label_found', note, {
    envia: found.envia,
    tracking: found.tracking,
    url: found.url,
    cost: found.cost,
  });

async function snapshot(tx: Tx) {
  const [row] = await tx`SELECT
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.shipments s WHERE s.order_id = ${ids.order}) AS shipments,
    (SELECT count(*)::int FROM public.shipment_label_events e JOIN public.shipments s ON s.id = e.shipment_id WHERE s.order_id = ${ids.order}) AS events,
    (SELECT to_jsonb(o) FROM public.orders o WHERE o.id = ${ids.order}) AS orders,
    (SELECT count(*)::int FROM public.shipment_cancellation_operations) AS operations,
    (SELECT count(*)::int FROM public.notifications) AS notifications`;
  return JSON.stringify(row);
}

// Runs the call in a savepoint, requires the failure message, then proves the data did not move.
async function rejects(
  tx: Tx,
  body: (sp: Tx) => Promise<unknown>,
  message: string,
) {
  const before = await snapshot(tx);
  await tx`SAVEPOINT attempt`;
  let error: Error | undefined;
  try {
    await body(tx);
  } catch (caught) {
    error = caught as Error;
  }
  await tx`ROLLBACK TO SAVEPOINT attempt`;
  assert.ok(error, `expected "${message}" but the call succeeded`);
  assert.ok(
    error.message.includes(message),
    `expected "${message}", got "${error.message}"`,
  );
  assert.equal(await snapshot(tx), before, 'a rejected call changed data');
}

const shipment = async (tx: Tx, id: string) =>
  (await tx`SELECT * FROM public.shipments WHERE id = ${id}`)[0]!;
const events = (tx: Tx, id: string) =>
  tx`SELECT * FROM public.shipment_label_events WHERE shipment_id = ${id} ORDER BY created_at, id`;
const listed = async (tx: Tx) =>
  (
    await tx`SELECT shipment_id FROM public.fn_list_shipment_label_reconciliations()`
  ).map((r: Json) => r.shipment_id);

const cases: [string, (tx: Tx) => Promise<void>][] = [
  [
    'list includes orphan, stale claimed and stale generation_sent, oldest first, with context',
    async (tx) => {
      const rows =
        await tx`SELECT * FROM public.fn_list_shipment_label_reconciliations()`;
      assert.deepEqual(
        rows.map((r: Json) => r.shipment_id),
        [ids.orphan, ids.staleClaimed, ids.staleSent],
      );
      const orphan = rows[0];
      assert.equal(orphan.order_id, ids.order);
      assert.equal(orphan.seller_id, ids.seller);
      assert.equal(orphan.seller_name, 'hardware_seller');
      assert.equal(orphan.buyer_name, 'pc_buyer');
      assert.equal(orphan.label_generation_state, 'orphan_pending');
      assert.equal(orphan.quote_carrier, 'paquetexpress');
      assert.equal(orphan.quote_service, 'ground');
      assert.equal(String(orphan.quote_cost_cents), '9100');
      assert.equal(orphan.origin_postal_code, '06600');
      assert.equal(orphan.origin_city, 'CDMX');
      assert.equal(orphan.destination_postal_code, '44100');
      assert.equal(orphan.destination_city, 'Guadalajara');
      // stuck_at is the orphaned event for an orphan and claim_expires_at for a stale claim.
      const [{ orphanedAt }] =
        await tx`SELECT created_at AS "orphanedAt" FROM public.shipment_label_events
        WHERE shipment_id = ${ids.orphan} AND event_type = 'orphaned'`;
      assert.equal(
        new Date(orphan.stuck_at).getTime(),
        new Date(orphanedAt).getTime(),
      );
      assert.equal(
        new Date(rows[1].stuck_at).getTime(),
        new Date(rows[1].claim_expires_at).getTime(),
      );
    },
  ],
  [
    'list excludes fresh claimed, unclaimed, generated and non-paid shipments',
    async (tx) => {
      const ids_ = await listed(tx);
      for (const id of [
        ids.freshClaimed,
        ids.unclaimed,
        ids.generated,
        ids.preparingOrphan,
      ])
        assert.ok(!ids_.includes(id), `${id} must not be listed`);
    },
  ],
  [
    'label_found makes an orphan generated and preparing and writes the audit event',
    async (tx) => {
      const result = await labelFound(tx, ids.orphan);
      assert.equal(result.result, 'resolved');
      assert.equal(result.resolution, 'label_found');
      const row = await shipment(tx, ids.orphan);
      assert.equal(row.status, 'preparing');
      assert.equal(row.label_generation_state, 'generated');
      assert.equal(row.tracking_number, found.tracking);
      assert.equal(row.label_url, found.url);
      assert.equal(row.envia_shipment_id, found.envia);
      assert.equal(row.carrier, 'paquetexpress');
      assert.equal(String(row.label_provider_cost_cents), String(found.cost));
      assert.ok(
        row.print_format && row.print_size,
        'print settings come from system_settings',
      );
      assert.equal(row.claim_token, null);
      assert.equal(row.claim_expires_at, null);
      const last = (await events(tx, ids.orphan)).at(-1)!;
      assert.equal(last.event_type, 'reconciled');
      assert.equal(last.actor_id, ids.admin);
      assert.deepEqual(last.metadata, {
        resolution: 'label_found',
        from_state: 'orphan_pending',
        note: 'Guia vista en el panel de Envia',
      });
      assert.ok(!(await listed(tx)).includes(ids.orphan));
    },
  ],
  [
    'label_found works for stale claimed and generation_sent, and leaves siblings untouched',
    async (tx) => {
      for (const id of [ids.staleClaimed, ids.staleSent]) {
        const sibling = JSON.stringify(await shipment(tx, ids.orphan));
        assert.equal((await labelFound(tx, id)).result, 'resolved');
        const row = await shipment(tx, id);
        assert.equal(row.status, 'preparing');
        assert.equal(row.label_generation_state, 'generated');
        assert.equal(JSON.stringify(await shipment(tx, ids.orphan)), sibling);
      }
      assert.equal(
        (await shipment(tx, ids.freshClaimed)).label_generation_state,
        'claimed',
      );
    },
  ],
  [
    'no_label releases to unclaimed, keeps status paid, writes the audit event and moves no money',
    async (tx) => {
      const before = JSON.parse(await snapshot(tx));
      const result = await resolve(
        tx,
        ids.orphan,
        'no_label',
        '  Sin guia en Envia  ',
      );
      assert.equal(result.result, 'resolved');
      assert.equal(result.resolution, 'no_label');
      const row = await shipment(tx, ids.orphan);
      assert.equal(row.status, 'paid');
      assert.equal(row.label_generation_state, 'unclaimed');
      assert.equal(row.claim_token, null);
      assert.equal(row.claim_expires_at, null);
      assert.equal(row.tracking_number, null);
      const last = (await events(tx, ids.orphan)).at(-1)!;
      assert.equal(last.event_type, 'released');
      assert.equal(last.actor_id, ids.admin);
      assert.deepEqual(last.metadata, {
        resolution: 'no_label',
        from_state: 'orphan_pending',
        note: 'Sin guia en Envia',
      });
      const after = JSON.parse(await snapshot(tx));
      assert.deepEqual(after.orders, before.orders);
      assert.equal(after.operations, before.operations);
      assert.equal(after.notifications, before.notifications);
      assert.equal(after.events, before.events + 1);
    },
  ],
  [
    'no_label releases stale claimed and generation_sent too',
    async (tx) => {
      for (const id of [ids.staleClaimed, ids.staleSent]) {
        assert.equal(
          (await resolve(tx, id, 'no_label', 'Sin guia')).result,
          'resolved',
        );
        assert.equal(
          (await shipment(tx, id)).label_generation_state,
          'unclaimed',
        );
      }
    },
  ],
  [
    'replays and non-stuck shipments return already_resolved and change nothing',
    async (tx) => {
      await labelFound(tx, ids.orphan);
      await resolve(tx, ids.staleClaimed, 'no_label', 'Sin guia');
      const before = await snapshot(tx);
      for (const call of [
        () => labelFound(tx, ids.orphan),
        () => resolve(tx, ids.orphan, 'no_label', 'Otra vez'),
        () => resolve(tx, ids.staleClaimed, 'no_label', 'Sin guia'),
        () => labelFound(tx, ids.freshClaimed),
        () => resolve(tx, ids.unclaimed, 'no_label', 'Nada'),
        () => resolve(tx, ids.generated, 'no_label', 'Nada'),
        () => resolve(tx, ids.preparingOrphan, 'no_label', 'Nada'),
      ]) {
        assert.equal((await call()).result, 'already_resolved');
      }
      assert.equal(await snapshot(tx), before);
    },
  ],
  [
    'bad inputs and bad actors are rejected and every touched table stays unchanged',
    async (tx) => {
      const bad: [string, () => Promise<unknown>][] = [
        [
          'ADMIN_REQUIRED',
          () => resolve(tx, ids.orphan, 'no_label', 'x', {}, ids.buyer),
        ],
        [
          'ADMIN_REQUIRED',
          () => resolve(tx, ids.orphan, 'no_label', 'x', {}, ids.seller),
        ],
        [
          'ADMIN_REQUIRED',
          () => resolve(tx, ids.orphan, 'no_label', 'x', {}, null),
        ],
        [
          'ADMIN_REQUIRED',
          () => resolve(tx, ids.orphan, 'no_label', 'x', {}, ids.unknown),
        ],
        ['INVALID_RESOLUTION', () => resolve(tx, ids.orphan, 'refund', 'x')],
        ['INVALID_RESOLUTION', () => resolve(tx, ids.orphan, '', 'x')],
        [
          'INVALID_RESOLUTION_NOTE',
          () => resolve(tx, ids.orphan, 'no_label', null),
        ],
        [
          'INVALID_RESOLUTION_NOTE',
          () => resolve(tx, ids.orphan, 'no_label', '   '),
        ],
        [
          'INVALID_RESOLUTION_NOTE',
          () => resolve(tx, ids.orphan, 'no_label', 'x'.repeat(201)),
        ],
        ['SHIPMENT_NOT_FOUND', () => resolve(tx, ids.unknown, 'no_label', 'x')],
        [
          'INVALID_PROVIDER_RESULT',
          () => resolve(tx, ids.orphan, 'label_found', 'x'),
        ],
        [
          'INVALID_PROVIDER_RESULT',
          () =>
            resolve(tx, ids.orphan, 'label_found', 'x', {
              envia: 'E',
              tracking: 'T',
              url: 'U',
              cost: -1,
            }),
        ],
        [
          'INVALID_PROVIDER_RESULT',
          () =>
            resolve(tx, ids.orphan, 'label_found', 'x', {
              envia: 'E',
              tracking: ' ',
              url: 'U',
              cost: 1,
            }),
        ],
        [
          'INVALID_PROVIDER_RESULT',
          () =>
            resolve(tx, ids.orphan, 'label_found', 'x', {
              envia: 'E',
              tracking: 'T',
              url: null,
              cost: 1,
            }),
        ],
        [
          'UNEXPECTED_PROVIDER_FIELDS',
          () => resolve(tx, ids.orphan, 'no_label', 'x', { tracking: 'T' }),
        ],
      ];
      for (const [message, call] of bad) await rejects(tx, call, message);
      // A suspended or banned admin is not an admin for this rule (same as is_admin()).
      for (const status of ['suspended', 'banned']) {
        await tx`RESET ROLE`;
        await tx`UPDATE public.profiles_private SET status = ${status}::public.account_status WHERE id = ${ids.admin}`;
        await tx`SET LOCAL ROLE service_role`;
        await rejects(
          tx,
          () => resolve(tx, ids.orphan, 'no_label', 'x'),
          'ADMIN_REQUIRED',
        );
        await rejects(tx, () => labelFound(tx, ids.orphan), 'ADMIN_REQUIRED');
      }
    },
  ],
  [
    'only service_role can execute either RPC',
    async (tx) => {
      for (const role of ['anon', 'authenticated']) {
        for (const call of [
          (sp: Tx) =>
            sp`SELECT * FROM public.fn_list_shipment_label_reconciliations()`,
          (sp: Tx) => resolve(sp, ids.orphan, 'no_label', 'x'),
        ]) {
          await rejects(
            tx,
            async (sp) => {
              await sp.unsafe(`SET LOCAL ROLE ${role}`);
              await call(sp);
            },
            'permission denied',
          );
        }
      }
      await rejects(
        tx,
        async (sp) => {
          await sp`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
          await resolve(sp, ids.orphan, 'no_label', 'x');
        },
        'UNAUTHORIZED',
      );
    },
  ],
  [
    'cancellation claims are blocked while stuck and succeed after no_label; a sibling stays blocked',
    async (tx) => {
      const claim = async (id: string, source: string, actor: string | null) =>
        (
          await tx`SELECT public.fn_claim_shipment_cancellation(${id}::uuid, ${ids.order}::uuid,
            ${actor}::uuid, ${source}, 'test') AS claim`
        )[0]!.claim as Json;
      await rejects(
        tx,
        () => claim(ids.orphan, 'buyer', ids.buyer),
        'SHIPMENT_LABEL_OPERATION_ACTIVE',
      );
      await rejects(
        tx,
        () => claim(ids.staleClaimed, 'paid_timeout', null),
        'SHIPMENT_LABEL_OPERATION_ACTIVE',
      );
      await resolve(tx, ids.orphan, 'no_label', 'Sin guia');
      await resolve(tx, ids.staleClaimed, 'no_label', 'Sin guia');
      assert.equal(
        (await claim(ids.orphan, 'buyer', ids.buyer)).status,
        'claimed',
      );
      assert.equal(
        (await claim(ids.staleClaimed, 'paid_timeout', null)).status,
        'claimed',
      );
      await rejects(
        tx,
        () => claim(ids.staleSent, 'buyer', ids.buyer),
        'SHIPMENT_LABEL_OPERATION_ACTIVE',
      );
    },
  ],
  [
    'a released shipment enters the auto-cancel selection and the seller can claim a label again',
    async (tx) => {
      const selected = async () =>
        (
          await tx`SELECT id FROM public.shipments WHERE status = 'paid' AND tracking_number IS NULL
            AND created_at < now() - interval '1 hour'
            AND label_generation_state IN ('unclaimed', 'retryable_rejected') AND order_id = ${ids.order}`
        ).map((r: Json) => r.id);
      assert.ok(!(await selected()).includes(ids.orphan));
      await resolve(tx, ids.orphan, 'no_label', 'Sin guia');
      assert.ok((await selected()).includes(ids.orphan));
      const [{ claim }] = await tx`SELECT public.fn_claim_shipment_label(
        ${ids.orphan}::uuid, ${ids.seller}::uuid, NULL::uuid) AS claim`;
      assert.equal((claim as Json).status, 'claimed');
    },
  ],
];

async function run() {
  const sql = new SQL(databaseUrl(), { max: 1, connectionTimeout: 5 });
  let failed = 0;
  try {
    for (const [name, body] of cases) {
      console.log(`CASE ${name}`);
      try {
        await sql.begin(async (tx) => {
          await fixture(tx as Tx);
          await body(tx as Tx);
          throw new Rollback();
        });
      } catch (error) {
        if (error instanceof Rollback) {
          console.log('  PASS');
          continue;
        }
        failed++;
        console.log(`  FAIL ${(error as Error).message}`);
      }
    }
    // Every case rolled back: nothing from this harness may persist.
    const [left] =
      await sql`SELECT count(*)::int AS n FROM public.orders WHERE id = ${ids.order}`;
    assert.equal(left.n, 0);
  } finally {
    await sql.close();
  }
  console.log(`${cases.length - failed} pass, ${failed} fail`);
  if (failed) process.exit(1);
}

if (process.argv.includes('--help')) console.log(help);
else await run();
