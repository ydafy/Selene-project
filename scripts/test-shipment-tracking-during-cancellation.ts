import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-shipment-tracking-during-cancellation.ts [--help]\n' +
  'SQL: what can move a shipment while its cancellation operation is claimed or started (external_started_at set,\n' +
  'refund in flight): fn_record_tracking_event, fn_mark_shipment_delivered, fn_confirm_shipment_delivery, then\n' +
  'fn_cancel_shipment and fn_begin_shipment_transfer. Each case asserts the safe outcome; a FAIL shows the observed one.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b5a0000-0000-4000-8000-000000000001',
  preparing: '7b5a0000-0000-4000-8000-000000000011',
  paid: '7b5a0000-0000-4000-8000-000000000012',
  run: '7b5a0000-0000-4000-8000-000000000021',
};
const paymentIntent = 'pi_b58_local';
const amounts: Record<string, number> = { [ids.preparing]: 11000, [ids.paid]: 7000 };

type Tx = SQL;
type Source = 'preparing_timeout' | 'paid_timeout' | 'buyer' | 'seller';

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
    VALUES (${ids.order}, ${ids.buyer}, 180, '{}'::jsonb, 'paid', ${paymentIntent})`;
  await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id,
      label_generation_state, label_provider_cost_cents, tracking_number, carrier)
    VALUES (${ids.preparing}, ${ids.order}, ${ids.seller}, 'preparing', ${paymentIntent}, 'generated', 8900, 'TRK-B58-1', 'estafeta'),
           (${ids.paid}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'unclaimed', NULL, NULL, NULL)`;
  await tx`INSERT INTO public.connect_payout_runs (id, idempotency_key, seller_id, actor_id, amount, release_stage)
    VALUES (${ids.run}::uuid, 'b58-key', ${ids.seller}::uuid, ${ids.buyer}::uuid, 11000, 'release_accepted')`;
  await tx`INSERT INTO public.connect_payout_run_shipments (run_id, shipment_id, net_payout)
    VALUES (${ids.run}::uuid, ${ids.preparing}::uuid, 10000)`;
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
}

function refundRequest(shipmentId: string, source: Source) {
  return {
    payment_intent: paymentIntent,
    amount: amounts[shipmentId],
    reason: 'requested_by_customer',
    metadata: {
      shipment_id: shipmentId,
      order_id: ids.order,
      caller_role: source === 'buyer' || source === 'seller' ? source : 'system',
      reason: `${source} test`,
      seguro_share_cents: 500,
    },
  };
}

async function claimRaw(tx: Tx, shipmentId: string, source: Source) {
  const actor = source === 'buyer' ? ids.buyer : source === 'seller' ? ids.seller : null;
  const [{ claim }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${shipmentId}::uuid, ${ids.order}::uuid, ${actor}::uuid, ${source}, ${`${source} test`}) AS claim`;
  return claim;
}

async function claim(tx: Tx, shipmentId: string, source: Source) {
  const claimed = await claimRaw(tx, shipmentId, source);
  assert.equal(claimed.status, 'claimed');
  return claimed.claim_token as string;
}

async function startRefund(tx: Tx, shipmentId: string, token: string, source: Source) {
  await tx`SELECT public.fn_start_shipment_cancellation_refund(
    ${shipmentId}::uuid, ${token}::uuid, ${JSON.stringify(refundRequest(shipmentId, source))}::text::jsonb, 0::bigint)`;
}

async function recordRefund(tx: Tx, shipmentId: string, status: 'pending' | 'succeeded') {
  await tx`SELECT public.fn_record_shipment_cancellation_refund(
    ${shipmentId}::uuid, 're_b58_local', ${paymentIntent}, ${amounts[shipmentId]}::bigint, ${status})`;
}

// A preparing_timeout cancellation as the cron runs it: claim, carrier accepted, refund started.
async function startPreparingCancellation(tx: Tx, refund: 'pending' | 'succeeded' | null) {
  const token = await claim(tx, ids.preparing, 'preparing_timeout');
  await tx`SELECT public.fn_record_shipment_carrier_cancellation(
    ${ids.preparing}::uuid, ${token}::uuid, 'accepted', true::boolean, '2026-10-23T10:00:00Z'::timestamptz)`;
  await startRefund(tx, ids.preparing, token, 'preparing_timeout');
  if (refund) await recordRefund(tx, ids.preparing, refund);
  return token;
}

async function startPaidCancellation(tx: Tx, refund: 'pending' | 'succeeded' | null) {
  const token = await claim(tx, ids.paid, 'paid_timeout');
  await startRefund(tx, ids.paid, token, 'paid_timeout');
  if (refund) await recordRefund(tx, ids.paid, refund);
  return token;
}

async function track(tx: Tx, shipmentId: string, eventType: string, transition: string | null, eventAt: string) {
  const [{ result }] = await tx`SELECT public.fn_record_tracking_event(
    ${shipmentId}::uuid, NULL::uuid, ${eventType}::public.shipment_tracking_event_type, ${eventAt}::timestamptz,
    ${`raw ${eventType} ${eventAt}`}, 'CDMX', NULL::text, 'Estafeta', NULL::uuid, NULL::uuid,
    ${transition}::public.order_status_enum) AS result`;
  return result;
}

async function markDelivered(tx: Tx, shipmentId: string) {
  const [row] = await tx`SELECT * FROM public.fn_mark_shipment_delivered(${shipmentId}::uuid)`;
  return row;
}

async function confirmAuto(tx: Tx, shipmentId: string) {
  const [row] = await tx`SELECT * FROM public.fn_confirm_shipment_delivery(
    ${shipmentId}::uuid, 'auto', NULL::uuid, ${`auto_completion_${shipmentId}`})`;
  return row;
}

async function cancelShipment(tx: Tx, shipmentId: string) {
  const [row] = await tx`SELECT * FROM public.fn_cancel_shipment(${shipmentId}::uuid, 'system', 'b58 test')`;
  return row;
}

async function shipment(tx: Tx, shipmentId: string) {
  const [row] = await tx`SELECT status, shipped_at, delivered_at, completed_at FROM public.shipments WHERE id = ${shipmentId}`;
  return row;
}

async function operation(tx: Tx, shipmentId: string) {
  const [row] = await tx`SELECT source, external_started_at, refund_status, late_carrier_activity_at, late_carrier_activity_event_type FROM public.shipment_cancellation_operations WHERE shipment_id = ${shipmentId}`;
  return row;
}

async function recovery(tx: Tx, shipmentId: string) {
  const [{ recovery: value }] = await tx`SELECT public.fn_get_shipment_cancellation_recovery(${shipmentId}::uuid) AS recovery`;
  return value;
}

async function acknowledge(tx: Tx, shipmentId: string, adminId: string | null, note: string | null) {
  const [{ result }] = await tx`SELECT public.fn_acknowledge_shipment_late_carrier_activity(
    ${shipmentId}::uuid, ${adminId}::uuid, ${note}) AS result`;
  return result;
}

// Everything on the operation except the three acknowledgement columns, as JSON.
async function operationWithoutAcknowledgement(tx: Tx, shipmentId: string) {
  const [row] = await tx`SELECT to_jsonb(o) - 'late_carrier_activity_acknowledged_at'
      - 'late_carrier_activity_acknowledged_by' - 'late_carrier_activity_acknowledged_note' AS op
    FROM public.shipment_cancellation_operations o WHERE shipment_id = ${shipmentId}`;
  return row.op;
}

async function withLateActivity(tx: Tx) {
  await startPreparingCancellation(tx, 'pending');
  await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-24T10:00:00Z');
}

function observe(label: string, value: unknown) {
  console.log(`  observed ${label}: ${JSON.stringify(value)}`);
}

async function rejects(tx: Tx, action: (sp: Tx) => Promise<unknown>, message: string) {
  await assert.rejects(
    tx.savepoint((sp) => action(sp as Tx)),
    (error: Error) => error.message.includes(message),
    `expected ${message}`,
  );
}

const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  // (a) fn_record_tracking_event
  [
    'tracking does not advance a preparing shipment whose cancellation refund is in flight (shipped)',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      const result = await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-24T10:00:00Z');
      observe('tracking result', result);
      observe('shipment', await shipment(tx, ids.preparing));
      observe('operation', await operation(tx, ids.preparing));
      assert.equal(result.inserted, true);
      assert.equal(result.shipment_status, 'preparing');
      const shipmentRow = await shipment(tx, ids.preparing);
      assert.equal(shipmentRow.status, 'preparing');
      assert.equal(shipmentRow.shipped_at, null);
      // The scan itself is still stored, and the first one is recorded on the operation.
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM public.shipment_tracking_events WHERE shipment_id = ${ids.preparing}`;
      assert.equal(n, 1);
      const op = await operation(tx, ids.preparing);
      assert.notEqual(op.late_carrier_activity_at, null);
      assert.equal(op.late_carrier_activity_event_type, 'in_transit');
    },
  ],
  [
    'tracking does not advance a preparing shipment whose cancellation refund is in flight (shipped, then delivered)',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-24T10:00:00Z');
      const result = await track(tx, ids.preparing, 'delivered', 'delivered', '2026-10-25T10:00:00Z');
      observe('tracking result', result);
      observe('shipment', await shipment(tx, ids.preparing));
      assert.equal((await shipment(tx, ids.preparing)).status, 'preparing');
      assert.equal((await shipment(tx, ids.preparing)).delivered_at, null);
      // Only the first scan is recorded; a repeat changes nothing.
      const op = await operation(tx, ids.preparing);
      assert.equal(op.late_carrier_activity_event_type, 'in_transit');
    },
  ],
  [
    'tracking does not advance a preparing shipment whose cancellation is started and refund not yet recorded',
    async (tx) => {
      await startPreparingCancellation(tx, null);
      const result = await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-24T10:00:00Z');
      observe('tracking result', result);
      observe('operation', await operation(tx, ids.preparing));
      assert.equal((await shipment(tx, ids.preparing)).status, 'preparing');
    },
  ],
  // (b) fn_mark_shipment_delivered
  [
    'fn_mark_shipment_delivered refuses a preparing shipment whose cancellation refund is in flight',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      const result = await markDelivered(tx, ids.preparing);
      observe('mark delivered', result);
      observe('shipment', await shipment(tx, ids.preparing));
      assert.equal(result.success, false);
      assert.equal(result.error_message, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE');
      assert.equal((await shipment(tx, ids.preparing)).status, 'preparing');
    },
  ],
  // what follows for fn_cancel_shipment
  [
    'fn_cancel_shipment cancels after the refund succeeded even though a tracking scan arrived mid-cancellation',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-24T10:00:00Z');
      await recordRefund(tx, ids.preparing, 'succeeded');
      const result = await cancelShipment(tx, ids.preparing);
      observe('fn_cancel_shipment', result);
      observe('shipment', await shipment(tx, ids.preparing));
      observe('operation', await operation(tx, ids.preparing));
      assert.equal(result.success, true);
      assert.equal((await shipment(tx, ids.preparing)).status, 'cancelled');
    },
  ],
  [
    'fn_cancel_shipment cancels after the refund succeeded even though fn_mark_shipment_delivered ran mid-cancellation',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      await markDelivered(tx, ids.preparing);
      await recordRefund(tx, ids.preparing, 'succeeded');
      const result = await cancelShipment(tx, ids.preparing);
      observe('fn_cancel_shipment', result);
      observe('shipment', await shipment(tx, ids.preparing));
      assert.equal(result.success, true);
      assert.equal((await shipment(tx, ids.preparing)).status, 'cancelled');
    },
  ],
  // (c) delivery confirmation, then the payout guard
  [
    'fn_confirm_shipment_delivery does not complete a shipment whose cancellation refund succeeded',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-18T10:00:00Z');
      await track(tx, ids.preparing, 'delivered', 'delivered', '2026-10-19T10:00:00Z');
      await recordRefund(tx, ids.preparing, 'succeeded');
      const result = await confirmAuto(tx, ids.preparing);
      observe('confirm delivery', result);
      observe('shipment', await shipment(tx, ids.preparing));
      assert.equal(result.success, false);
      assert.notEqual((await shipment(tx, ids.preparing)).status, 'completed');
    },
  ],
  [
    'a delivered shipment (state left by earlier code) whose cancellation refund started is neither completed nor marked delivered again',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      await tx`UPDATE public.shipments SET status = 'delivered', delivered_at = now() - interval '72 hours' WHERE id = ${ids.preparing}`;
      const confirmed = await confirmAuto(tx, ids.preparing);
      observe('confirm delivery', confirmed);
      assert.equal(confirmed.success, false);
      assert.equal(confirmed.error, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE');
      assert.equal((await shipment(tx, ids.preparing)).status, 'delivered');
      const marked = await markDelivered(tx, ids.preparing);
      assert.equal(marked.success, false);
      assert.equal(marked.error_message, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE');
    },
  ],
  [
    'the payout transfer start refuses a completed shipment whose cancellation refund started',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-18T10:00:00Z');
      await track(tx, ids.preparing, 'delivered', 'delivered', '2026-10-19T10:00:00Z');
      await recordRefund(tx, ids.preparing, 'succeeded');
      observe('confirm delivery', await confirmAuto(tx, ids.preparing));
      observe('shipment', await shipment(tx, ids.preparing));
      await rejects(
        tx,
        (sp) => sp`SELECT public.fn_begin_shipment_transfer(${ids.run}::uuid, ${ids.preparing}::uuid, 1::integer)`,
        'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
      );
    },
  ],
  // pre-start window: the start guard is the fence
  [
    'a tracking scan while the cancellation claim is live (refund not started) blocks the refund start',
    async (tx) => {
      const token = await claim(tx, ids.preparing, 'preparing_timeout');
      await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-24T10:00:00Z');
      observe('shipment', await shipment(tx, ids.preparing));
      await rejects(tx, (sp) => startRefund(sp, ids.preparing, token, 'preparing_timeout'), 'SHIPMENT_NOT_CANCELABLE');
      const op = await operation(tx, ids.preparing);
      assert.equal(op.external_started_at, null);
      // A scan before the refund started is a normal status change, not late activity.
      assert.equal(op.late_carrier_activity_at, null);
    },
  ],
  [
    'late carrier activity is listed for an admin with the shipment, source and refund state, and the list changes nothing',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-24T10:00:00Z');
      const before = await shipment(tx, ids.preparing);
      const rows = await tx`SELECT * FROM public.fn_list_shipment_late_carrier_activity()`;
      observe('list', rows);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].shipment_id, ids.preparing);
      assert.equal(rows[0].source, 'preparing_timeout');
      assert.equal(rows[0].refund_status, 'pending');
      assert.equal(rows[0].shipment_status, 'preparing');
      assert.equal(rows[0].late_carrier_activity_event_type, 'in_transit');
      assert.deepEqual(await shipment(tx, ids.preparing), before);
    },
  ],
  [
    'a cancellation without late carrier activity is not listed',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      const rows = await tx`SELECT * FROM public.fn_list_shipment_late_carrier_activity()`;
      assert.equal(rows.length, 0);
    },
  ],
  [
    'only the service role can run the changed and new functions',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      const calls: Array<[string, (sp: Tx) => Promise<unknown>]> = [
        ['fn_list_shipment_late_carrier_activity', (sp) => sp`SELECT * FROM public.fn_list_shipment_late_carrier_activity()`],
        ['fn_mark_shipment_delivered', (sp) => sp`SELECT * FROM public.fn_mark_shipment_delivered(${ids.preparing}::uuid)`],
        ['fn_confirm_shipment_delivery', (sp) => sp`SELECT * FROM public.fn_confirm_shipment_delivery(${ids.preparing}::uuid, 'auto', NULL::uuid, ${`auto_completion_${ids.preparing}`})`],
        [
          'fn_record_tracking_event',
          (sp) => sp`SELECT public.fn_record_tracking_event(${ids.preparing}::uuid, NULL::uuid, 'in_transit'::public.shipment_tracking_event_type, now(), 'raw', NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid, 'shipped'::public.order_status_enum)`,
        ],
      ];
      for (const role of ['anon', 'authenticated']) {
        for (const [, call] of calls) {
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
      assert.equal((await shipment(tx, ids.preparing)).status, 'preparing');
      assert.equal((await operation(tx, ids.preparing)).late_carrier_activity_at, null);
    },
  ],
  [
    'a shipped shipment cannot be claimed for cancellation',
    async (tx) => {
      await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-24T10:00:00Z');
      await rejects(tx, (sp) => claimRaw(sp, ids.preparing, 'preparing_timeout'), 'SHIPMENT_NOT_CANCELABLE');
    },
  ],
  // other cancellation entry points on a preparing shipment with a label
  [
    'manual (buyer, seller) and paid-timeout cancellation cannot claim a preparing shipment with a label',
    async (tx) => {
      for (const source of ['buyer', 'seller', 'paid_timeout'] as const) {
        await rejects(tx, (sp) => claimRaw(sp, ids.preparing, source), 'SHIPMENT_NOT_CANCELABLE');
      }
    },
  ],
  // paid shipment: no label, no tracking
  [
    'a paid shipment whose cancellation refund is in flight is not advanced by tracking, delivery marking or confirmation',
    async (tx) => {
      await startPaidCancellation(tx, 'pending');
      const result = await track(tx, ids.paid, 'in_transit', 'shipped', '2026-10-24T10:00:00Z');
      const delivered = await track(tx, ids.paid, 'delivered', 'delivered', '2026-10-25T10:00:00Z');
      observe('tracking results', [result, delivered]);
      assert.equal(result.shipment_status, 'paid');
      assert.equal(delivered.shipment_status, 'paid');
      const marked = await markDelivered(tx, ids.paid);
      observe('mark delivered', marked);
      assert.equal(marked.success, false);
      const confirmed = await confirmAuto(tx, ids.paid);
      observe('confirm delivery', confirmed);
      assert.equal(confirmed.success, false);
      assert.equal((await shipment(tx, ids.paid)).status, 'paid');
    },
  ],
  [
    'a paid shipment whose cancellation is started cannot get a label claimed, and then cancels',
    async (tx) => {
      await startPaidCancellation(tx, 'pending');
      await rejects(
        tx,
        (sp) => sp`SELECT public.fn_claim_shipment_label(${ids.paid}::uuid, ${ids.seller}::uuid, NULL::uuid)`,
        'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
      );
      await recordRefund(tx, ids.paid, 'succeeded');
      const result = await cancelShipment(tx, ids.paid);
      assert.equal(result.success, true);
      assert.equal((await shipment(tx, ids.paid)).status, 'cancelled');
    },
  ],
  // verifier regression cases
  [
    'a delivered scan after the refund started leaves the recovery read unchanged, and the cancellation still completes',
    async (tx) => {
      await startPreparingCancellation(tx, null);
      await recordRefund(tx, ids.preparing, 'succeeded');
      const before = await recovery(tx, ids.preparing);
      await track(tx, ids.preparing, 'in_transit', 'shipped', '2026-10-18T10:00:00Z');
      const delivered = await track(tx, ids.preparing, 'delivered', 'delivered', '2026-10-19T10:00:00Z');
      observe('tracking result', delivered);
      const after = await recovery(tx, ids.preparing);
      observe('recovery', after);
      assert.deepEqual(after, before);
      assert.equal(after.refund_status, 'succeeded');
      assert.equal('late_carrier_activity_at' in after, false);
      const result = await cancelShipment(tx, ids.preparing);
      assert.equal(result.success, true);
      assert.equal((await shipment(tx, ids.preparing)).status, 'cancelled');
    },
  ],
  [
    'a tracking event without a status transition after the refund started leaves late_carrier_activity_at NULL',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      const result = await track(tx, ids.preparing, 'in_transit', null, '2026-10-24T10:00:00Z');
      observe('tracking result', result);
      assert.equal(result.inserted, true);
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM public.shipment_tracking_events WHERE shipment_id = ${ids.preparing}`;
      assert.equal(n, 1);
      const op = await operation(tx, ids.preparing);
      assert.equal(op.late_carrier_activity_at, null);
      assert.equal(op.late_carrier_activity_event_type, null);
      assert.equal((await shipment(tx, ids.preparing)).status, 'preparing');
    },
  ],
  [
    'catalog: the tracking, delivery, list and acknowledge functions are SECURITY DEFINER, pin a search_path and grant only service_role',
    async (tx) => {
      const names = [
        'fn_record_tracking_event',
        'fn_mark_shipment_delivered',
        'fn_confirm_shipment_delivery',
        'fn_list_shipment_late_carrier_activity',
        'fn_acknowledge_shipment_late_carrier_activity',
      ];
      const rows = await tx`SELECT p.proname, p.prosecdef, p.proconfig,
          (SELECT array_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END)
             FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            WHERE a.privilege_type = 'EXECUTE') AS grantees,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ANY(string_to_array(${names.join(',')}, ','))
        ORDER BY p.proname`;
      observe('catalog', rows);
      assert.equal(rows.length, names.length);
      for (const row of rows) {
        assert.equal(row.prosecdef, true, `${row.proname} prosecdef`);
        assert.ok((row.proconfig ?? []).some((c: string) => c.startsWith('search_path=')), `${row.proname} search_path`);
        assert.equal(row.anon_execute, false, `${row.proname} anon`);
        assert.equal(row.authenticated_execute, false, `${row.proname} authenticated`);
        assert.equal(row.service_execute, true, `${row.proname} service_role`);
        assert.ok(!row.grantees.includes('PUBLIC'), `${row.proname} PUBLIC`);
        assert.deepEqual(
          row.grantees.filter((g: string) => g !== 'postgres' && g !== 'service_role'),
          [],
          `${row.proname} extra grantees`,
        );
      }
    },
  ],
  // acknowledge
  [
    'an admin acknowledges late carrier activity: the case leaves the list and only the acknowledgement columns change',
    async (tx) => {
      await withLateActivity(tx);
      const shipmentBefore = await shipment(tx, ids.preparing);
      const operationBefore = await operationWithoutAcknowledgement(tx, ids.preparing);
      const result = await acknowledge(tx, ids.preparing, ids.admin, '  Seller shipped it anyway; called the buyer  ');
      observe('acknowledge', result);
      assert.equal(result.acknowledged_by, ids.admin);
      assert.equal(result.acknowledged_note, 'Seller shipped it anyway; called the buyer');
      assert.equal(result.already_acknowledged, false);
      assert.notEqual(result.acknowledged_at, null);
      assert.equal((await tx`SELECT * FROM public.fn_list_shipment_late_carrier_activity()`).length, 0);
      assert.deepEqual(await shipment(tx, ids.preparing), shipmentBefore);
      assert.deepEqual(await operationWithoutAcknowledgement(tx, ids.preparing), operationBefore);
      const [{ orders }] = await tx`SELECT count(*)::int AS orders FROM public.orders WHERE id = ${ids.order} AND status = 'paid'`;
      assert.equal(orders, 1);
    },
  ],
  [
    'acknowledging twice is idempotent: the second call returns the stored acknowledgement and changes nothing',
    async (tx) => {
      await withLateActivity(tx);
      const first = await acknowledge(tx, ids.preparing, ids.admin, 'first note');
      const second = await acknowledge(tx, ids.preparing, ids.admin, 'a different note');
      observe('second acknowledge', second);
      assert.equal(second.already_acknowledged, true);
      assert.equal(second.acknowledged_note, 'first note');
      assert.equal(second.acknowledged_at, first.acknowledged_at);
      assert.equal(second.acknowledged_by, first.acknowledged_by);
    },
  ],
  [
    'acknowledging works after the cancellation completes, and the completed shipment stays cancelled',
    async (tx) => {
      await withLateActivity(tx);
      await recordRefund(tx, ids.preparing, 'succeeded');
      await cancelShipment(tx, ids.preparing);
      assert.equal((await tx`SELECT * FROM public.fn_list_shipment_late_carrier_activity()`).length, 1);
      const result = await acknowledge(tx, ids.preparing, ids.admin, 'reviewed after cancel');
      assert.equal(result.already_acknowledged, false);
      assert.equal((await shipment(tx, ids.preparing)).status, 'cancelled');
      assert.equal((await operation(tx, ids.preparing)).refund_status, 'succeeded');
    },
  ],
  [
    'only an active admin can acknowledge (ADMIN_REQUIRED for buyer, seller, unknown and NULL ids), and nothing is written',
    async (tx) => {
      await withLateActivity(tx);
      for (const who of [ids.buyer, ids.seller, '7b5a0000-0000-4000-8000-0000000000ff', null]) {
        await rejects(tx, (sp) => acknowledge(sp, ids.preparing, who, 'note'), 'ADMIN_REQUIRED');
      }
      await tx`UPDATE public.profiles_private SET status = 'suspended' WHERE id = ${ids.admin}::uuid`;
      await rejects(tx, (sp) => acknowledge(sp, ids.preparing, ids.admin, 'note'), 'ADMIN_REQUIRED');
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.preparing} AND late_carrier_activity_acknowledged_at IS NOT NULL`;
      assert.equal(n, 0);
    },
  ],
  [
    'the acknowledgement note must be 1-200 characters after trimming',
    async (tx) => {
      await withLateActivity(tx);
      for (const note of [null, '', '   ', 'x'.repeat(201), `  ${'x'.repeat(201)}  `]) {
        await rejects(tx, (sp) => acknowledge(sp, ids.preparing, ids.admin, note), 'INVALID_ACKNOWLEDGEMENT_NOTE');
      }
      const ok = await acknowledge(tx, ids.preparing, ids.admin, `  ${'x'.repeat(200)}  `);
      assert.equal(ok.acknowledged_note, 'x'.repeat(200));
    },
  ],
  [
    'acknowledge refuses an unknown shipment and an operation without late carrier activity',
    async (tx) => {
      await startPreparingCancellation(tx, 'pending');
      await rejects(tx, (sp) => acknowledge(sp, ids.preparing, ids.admin, 'note'), 'LATE_CARRIER_ACTIVITY_NOT_FOUND');
      await rejects(tx, (sp) => acknowledge(sp, ids.paid, ids.admin, 'note'), 'LATE_CARRIER_ACTIVITY_NOT_FOUND');
      await rejects(tx, (sp) => acknowledge(sp, '7b5a0000-0000-4000-8000-0000000000fe', ids.admin, 'note'), 'SHIPMENT_NOT_FOUND');
    },
  ],
  [
    'anon and authenticated cannot run acknowledge, and a non-service JWT role is refused',
    async (tx) => {
      await withLateActivity(tx);
      for (const role of ['anon', 'authenticated']) {
        await rejects(
          tx,
          async (sp) => {
            await sp.unsafe(`SET LOCAL ROLE ${role}`);
            await acknowledge(sp, ids.preparing, ids.admin, 'note');
          },
          'permission denied',
        );
      }
      await rejects(
        tx,
        async (sp) => {
          await sp`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
          await acknowledge(sp, ids.preparing, ids.admin, 'note');
        },
        'UNAUTHORIZED',
      );
      assert.equal((await tx`SELECT * FROM public.fn_list_shipment_late_carrier_activity()`).length, 1);
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
