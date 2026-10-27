import { SQL } from 'bun';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const help =
  'Usage: bun scripts/test-auto-cancel-paid-timeout.ts [--help]\n' +
  'B3.3 live: drives the REAL served auto-cancel-orders function over HTTP and checks its effects in the\n' +
  'database: paid-timeout boundaries with a live order_expiration_hours (just expired vs not yet, tracked and\n' +
  'non-paid and label-blocked orphan_pending shipments excluded), rerun idempotence, a held lease ("Already running"), two simultaneous runs,\n' +
  'an invalid live setting (500 AUTO_CANCEL_SETTINGS_INVALID) and a free lease after every run.\n' +
  'Fixtures have no Stripe payment intent, so every selected shipment stops at the AUTO_CANCEL_MISSING_PAYMENT_INTENT\n' +
  'gate after its cancellation operation is claimed: Stripe is never reached and no money moves.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`) with the function served:\n" +
  '  supabase functions serve --no-verify-jwt --env-file supabase/functions/.env\n' +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.\n' +
  'Fixtures, created operations, the setting and the lease columns are restored at the end, also on failure.';

const HOURS = 5;
const ids = {
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b430000-0000-4000-8000-000000000001',
};
const productIds = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-0000000000b${n}`);
const shipments = {
  expired: { id: '7b430000-0000-4000-8000-000000000011', status: 'paid', tracking: null, minutesOld: HOURS * 60 + 2 },
  fresh: { id: '7b430000-0000-4000-8000-000000000012', status: 'paid', tracking: null, minutesOld: HOURS * 60 - 2 },
  tracked: { id: '7b430000-0000-4000-8000-000000000013', status: 'paid', tracking: 'TRK-B33', minutesOld: 10 * 60 },
  preparing: { id: '7b430000-0000-4000-8000-000000000014', status: 'preparing', tracking: null, minutesOld: 10 * 60 },
  // Expired like `expired`, but a label operation blocks it: B4.1 leaves it out of the candidates.
  orphan: {
    id: '7b430000-0000-4000-8000-000000000015',
    status: 'paid',
    tracking: null,
    minutesOld: HOURS * 60 + 2,
    labelState: 'orphan_pending',
  },
} as Record<string, { id: string; status: string; tracking: string | null; minutesOld: number; labelState?: string }>;
const shipmentIds = Object.values(shipments).map((shipment) => shipment.id);

function status(): Record<string, string> {
  const result = Bun.spawnSync(['supabase', 'status', '--env'], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0)
    throw new Error('Local Supabase stack is not running for this worktree: run `supabase start`.');
  return JSON.parse(result.stdout.toString());
}

function localOnly(url: string, label: string): string {
  // Never touch a remote project: this harness writes data.
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-local ${label} host: ${host}`);
  return url;
}

function cronSecret(): string {
  const line = readFileSync(new URL('../supabase/functions/.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith('CRON_SECRET='));
  const value = line?.slice('CRON_SECRET='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!value) throw new Error('CRON_SECRET is missing from supabase/functions/.env.');
  return value;
}

type Reply = { status: number; text: string };

async function post(functionsUrl: string, headers: Record<string, string>): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch(`${functionsUrl}/auto-cancel-orders`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    throw new Error(
      `auto-cancel-orders is not reachable (${(error as Error).message}). Serve it with: ` +
        'supabase functions serve --no-verify-jwt --env-file supabase/functions/.env',
    );
  }
  return { status: response.status, text: await response.text() };
}

async function operationCount(sql: SQL, only?: string): Promise<number> {
  const rows = only
    ? await sql`SELECT count(*)::int AS n FROM public.shipment_cancellation_operations WHERE shipment_id = ${only}::uuid`
    : await sql`SELECT count(*)::int AS n FROM public.shipment_cancellation_operations WHERE shipment_id IN ${sql(shipmentIds)}`;
  return rows[0].n as number;
}

async function operatedIds(sql: SQL): Promise<string[]> {
  const rows = await sql`SELECT shipment_id FROM public.shipment_cancellation_operations
    WHERE shipment_id IN ${sql(shipmentIds)} ORDER BY shipment_id`;
  return rows.map((row: { shipment_id: string }) => row.shipment_id);
}

async function leaseFree(sql: SQL): Promise<boolean> {
  const [row] = await sql`SELECT auto_cancel_orders_lease_id IS NULL AS free FROM public.system_settings WHERE id = 1`;
  return row.free as boolean;
}

async function setHours(sql: SQL, hours: number) {
  await sql`UPDATE public.system_settings SET order_expiration_hours = ${hours} WHERE id = 1`;
}

async function cleanup(sql: SQL) {
  await sql`DELETE FROM public.shipment_cancellation_operations WHERE shipment_id IN ${sql(shipmentIds)}`;
  await sql`DELETE FROM public.order_items WHERE order_id = ${ids.order}`;
  await sql`DELETE FROM public.shipments WHERE id IN ${sql(shipmentIds)}`;
  await sql`DELETE FROM public.orders WHERE id = ${ids.order}`;
}

async function fixture(sql: SQL) {
  // No stripe_payment_intent_id anywhere and no stripe_charge_id: the handler cannot reach Stripe.
  await sql`INSERT INTO public.orders (id, buyer_id, total_amount, shipping_address, status)
    VALUES (${ids.order}, ${ids.buyer}, 500, '{}'::jsonb, 'paid')`;
  for (const [index, shipment] of Object.values(shipments).entries()) {
    await sql`INSERT INTO public.shipments (id, order_id, seller_id, status, tracking_number, created_at)
      VALUES (${shipment.id}, ${ids.order}, ${ids.seller}, ${shipment.status}, ${shipment.tracking},
        now() - (${shipment.minutesOld}::int * interval '1 minute'))`;
    // shipments_label_claim_check requires a claim_token for every state past unclaimed.
    if (shipment.labelState)
      await sql`UPDATE public.shipments SET label_generation_state = ${shipment.labelState}, claim_token = gen_random_uuid()
        WHERE id = ${shipment.id}`;
    await sql`INSERT INTO public.order_items (order_id, product_id, seller_id, price_at_purchase, net_payout, shipment_id)
      VALUES (${ids.order}, ${productIds[index]}, ${ids.seller}, 1000, 900, ${shipment.id})`;
  }
}

async function run() {
  const env = status();
  const functionsUrl = localOnly(env.FUNCTIONS_URL, 'functions');
  const sql = new SQL(localOnly(process.env.SELENE_LOCAL_DB_URL ?? env.DB_URL, 'database'), {
    max: 5,
    connectionTimeout: 5,
  });
  const headers = {
    'Content-Type': 'application/json',
    'x-cron-secret': cronSecret(),
    Authorization: `Bearer ${env.ANON_KEY}`,
    apikey: env.ANON_KEY,
  };
  const call = () => post(functionsUrl, headers);
  const cases: Array<[string, () => Promise<void>]> = [];
  const check = (name: string, body: () => Promise<void>) => cases.push([name, body]);
  let failed = 0;

  const [prior] = await sql`SELECT order_expiration_hours, auto_cancel_orders_lease_id, auto_cancel_orders_lease_expires_at,
      auto_cancel_preparing_lease_id, auto_cancel_preparing_lease_expires_at
    FROM public.system_settings WHERE id = 1`;
  try {
    assert.equal(prior.auto_cancel_orders_lease_id, null, 'The local orders lease must be free before the harness runs.');
    await cleanup(sql);
    const [{ n: foreign }] = await sql`SELECT count(*)::int AS n FROM public.shipments
      WHERE status = 'paid' AND tracking_number IS NULL AND created_at < now() - interval '1 hour'`;
    assert.equal(foreign, 0, 'Other paid shipments older than 1 h exist locally; the live run would cancel them.');
    await fixture(sql);
    await setHours(sql, HOURS);

    check('an invalid live setting (0) returns 500 AUTO_CANCEL_SETTINGS_INVALID, selects nothing and frees the lease', async () => {
      await setHours(sql, 0);
      try {
        const reply = await call();
        assert.equal(reply.status, 500);
        assert.equal(reply.text, '{"error":"AUTO_CANCEL_SETTINGS_INVALID"}');
        assert.equal(await operationCount(sql), 0);
        assert.equal(await leaseFree(sql), true);
      } finally {
        await setHours(sql, HOURS);
      }
    });

    check('a lease held elsewhere returns 200 "Already running" and touches nothing; the lease stays the holder\'s until released', async () => {
      const [held] = await sql.begin(async (tx) => {
        await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
        await tx`SET LOCAL ROLE service_role`;
        return tx`SELECT * FROM public.fn_acquire_auto_cancel_lease('orders')`;
      });
      assert.equal(held.acquired, true);
      try {
        const reply = await call();
        assert.equal(reply.status, 200);
        assert.equal(reply.text, '{"message":"Already running"}');
        assert.equal(await operationCount(sql), 0);
        const [row] = await sql`SELECT auto_cancel_orders_lease_id AS id FROM public.system_settings WHERE id = 1`;
        assert.equal(row.id, held.lease_id, 'the run must not release a lease it does not hold');
      } finally {
        await sql.begin(async (tx) => {
          await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
          await tx`SET LOCAL ROLE service_role`;
          await tx`SELECT public.fn_release_auto_cancel_lease('orders', ${held.lease_id}::uuid)`;
        });
      }
      assert.equal(await leaseFree(sql), true);
    });

    check(`with order_expiration_hours = ${HOURS} only the paid untracked shipment older than the limit is selected`, async () => {
      const reply = await call();
      assert.equal(reply.status, 200, reply.text);
      assert.deepEqual(await operatedIds(sql), [shipments.expired.id]);
      assert.equal(await operationCount(sql, shipments.orphan.id), 0, 'orphan must not be selected');
      assert.match(reply.text, /"processed":1,/, `only the expired shipment is processed: ${reply.text}`);
      const [operation] = await sql`SELECT source, actor_id FROM public.shipment_cancellation_operations
        WHERE shipment_id = ${shipments.expired.id}`;
      assert.equal(operation.source, 'paid_timeout');
      assert.equal(operation.actor_id, null);
      for (const key of ['fresh', 'tracked', 'preparing'] as const)
        assert.equal(await operationCount(sql, shipments[key].id), 0, `${key} must not be selected`);
      const rows = await sql`SELECT id, status FROM public.shipments WHERE id IN ${sql(shipmentIds)}`;
      for (const row of rows) {
        const expected = Object.values(shipments).find((shipment) => shipment.id === row.id)!.status;
        assert.equal(row.status, expected, 'no shipment may change status: the run stops before any refund');
      }
      assert.equal(await leaseFree(sql), true);
    });

    check('a rerun returns 200 and creates no second operation for the same shipment', async () => {
      const [before] = await sql`SELECT claim_token, created_at FROM public.shipment_cancellation_operations
        WHERE shipment_id = ${shipments.expired.id}`;
      const reply = await call();
      assert.equal(reply.status, 200, reply.text);
      assert.deepEqual(await operatedIds(sql), [shipments.expired.id]);
      const [after] = await sql`SELECT claim_token, created_at FROM public.shipment_cancellation_operations
        WHERE shipment_id = ${shipments.expired.id}`;
      assert.equal(after.claim_token, before.claim_token);
      assert.equal(new Date(after.created_at).getTime(), new Date(before.created_at).getTime());
      assert.equal(await leaseFree(sql), true);
    });

    check('two simultaneous runs end with 200s, one operation per shipment and a free lease', async () => {
      await sql`DELETE FROM public.shipment_cancellation_operations WHERE shipment_id IN ${sql(shipmentIds)}`;
      const replies = await Promise.all([call(), call()]);
      for (const reply of replies) assert.equal(reply.status, 200, reply.text);
      const overlapped = replies.filter((reply) => reply.text === '{"message":"Already running"}').length;
      assert.ok(overlapped <= 1, `at most one run may be refused: ${JSON.stringify(replies)}`);
      assert.deepEqual(await operatedIds(sql), [shipments.expired.id]);
      assert.equal(await leaseFree(sql), true);
      console.log(`  (${overlapped} of 2 simultaneous runs overlapped and got "Already running")`);
    });

    for (const [name, body] of cases) {
      try {
        await body();
        console.log(`PASS ${name}`);
      } catch (error) {
        failed++;
        console.log(`FAIL ${name}\n  ${(error as Error).message}`);
      }
    }
    console.log(`${cases.length - failed} pass, ${failed} fail`);
  } catch (error) {
    failed++;
    console.log(`FAIL setup\n  ${(error as Error).message}`);
  } finally {
    await cleanup(sql).catch((error) => {
      failed++;
      console.log(`FAIL cleanup\n  ${(error as Error).message}`);
    });
    await sql`UPDATE public.system_settings SET
        order_expiration_hours = ${prior.order_expiration_hours},
        auto_cancel_orders_lease_id = ${prior.auto_cancel_orders_lease_id},
        auto_cancel_orders_lease_expires_at = ${prior.auto_cancel_orders_lease_expires_at},
        auto_cancel_preparing_lease_id = ${prior.auto_cancel_preparing_lease_id},
        auto_cancel_preparing_lease_expires_at = ${prior.auto_cancel_preparing_lease_expires_at}
      WHERE id = 1`.catch((error) => {
      failed++;
      console.log(`FAIL restore\n  ${(error as Error).message}`);
    });
    await sql.close();
  }
  if (failed) process.exit(1);
}

if (process.argv.includes('--help')) console.log(help);
else await run();
