import { SQL } from 'bun';
import assert from 'node:assert/strict';

const help =
  'Usage: bun scripts/test-shipment-carrier-review.ts [--help]\n' +
  'B4.4a SQL: carrier review marker (fn_mark_shipment_cancellation_review), read RPC (fn_get_shipment_carrier_cancellation),\n' +
  'admin resolution (fn_resolve_shipment_cancellation_review), list (fn_list_shipment_cancellation_reviews), the refund start that\n' +
  'accepts refund_approved, and the claim that rejects shipments under review or closed.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every case rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  buyer: '00000000-0000-4000-8000-000000000003',
  seller: '00000000-0000-4000-8000-000000000002',
  order: '7b440000-0000-4000-8000-000000000001',
  shipment: '7b440000-0000-4000-8000-000000000011',
  paid: '7b440000-0000-4000-8000-000000000012',
  second: '7b440000-0000-4000-8000-000000000013',
  third: '7b440000-0000-4000-8000-000000000014',
};
const paymentIntent = 'pi_b44a_local';
const labelCost = 8900;
const amounts: Record<string, number> = { [ids.shipment]: 11000, [ids.paid]: 7000 };
const reasons = ['tracking_unknown', 'carrier_refused', 'carrier_ambiguous'];

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
      label_generation_state, label_provider_cost_cents, tracking_number, carrier)
    VALUES (${ids.shipment}, ${ids.order}, ${ids.seller}, 'preparing', ${paymentIntent}, 'generated', ${labelCost}, 'TRK-B44A-1', 'estafeta'),
           (${ids.paid}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, 'unclaimed', NULL, NULL, NULL)`;
  await asService(tx);
}

async function claim(tx: Tx, shipmentId = ids.shipment, source: Source = 'preparing_timeout') {
  const [{ claim: claimed }] = await tx`SELECT public.fn_claim_shipment_cancellation(
    ${shipmentId}::uuid, ${ids.order}::uuid, NULL::uuid, ${source}, ${`${source} test`}) AS claim`;
  assert.equal(claimed.status, 'claimed');
  return claimed.claim_token as string;
}

async function expireClaim(tx: Tx, shipmentId = ids.shipment) {
  await tx`UPDATE public.shipment_cancellation_operations SET claim_expires_at = '-infinity' WHERE shipment_id = ${shipmentId}`;
}

async function outcomeRpc(tx: Tx, token: string, outcome: string, shipmentId = ids.shipment) {
  const [{ result }] = await tx`SELECT public.fn_record_shipment_carrier_cancellation(
    ${shipmentId}::uuid, ${token}::uuid, ${outcome}, NULL::boolean, NULL::timestamptz) AS result`;
  return result;
}

async function mark(tx: Tx, token: string, reason: string, shipmentId = ids.shipment) {
  const [{ result }] = await tx`SELECT public.fn_mark_shipment_cancellation_review(
    ${shipmentId}::uuid, ${token}::uuid, ${reason}) AS result`;
  return result;
}

async function getCarrier(tx: Tx, shipmentId = ids.shipment) {
  const [{ result }] = await tx`SELECT public.fn_get_shipment_carrier_cancellation(${shipmentId}::uuid) AS result`;
  return result;
}

async function resolve(
  tx: Tx,
  resolution: string,
  note: string | null = 'checked with the carrier',
  admin: string | null = ids.admin,
  shipmentId = ids.shipment,
) {
  const [{ result }] = await tx`SELECT public.fn_resolve_shipment_cancellation_review(
    ${shipmentId}::uuid, ${admin}::uuid, ${resolution}, ${note}) AS result`;
  return result;
}

async function list(tx: Tx) {
  return await tx`SELECT * FROM public.fn_list_shipment_cancellation_reviews()`;
}

async function operation(tx: Tx, shipmentId = ids.shipment) {
  const [row] = await tx`SELECT * FROM public.shipment_cancellation_operations WHERE shipment_id = ${shipmentId}`;
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

/** Claims, then marks the review; returns the claim token. */
async function reviewed(tx: Tx, reason = 'carrier_refused') {
  const token = await claim(tx);
  await mark(tx, token, reason);
  return token;
}

const cases: Array<[string, (tx: Tx) => Promise<void>]> = [
  [
    'mark returns marked true once and false on a repeat, for each reason, and keeps the first marker',
    async (tx) => {
      for (const reason of reasons) {
        const token = await claim(tx);
        const first = await mark(tx, token, reason);
        assert.equal(first.marked, true);
        assert.equal(first.review_reason, reason);
        assert.ok(first.review_required_at);
        const stored = await operation(tx);
        assert.equal(stored.review_reason, reason);
        assert.ok(stored.review_required_at);
        assert.equal(stored.review_resolution, null);
        assert.equal(stored.external_started_at, null);
        const again = await mark(tx, token, reasons.find((r) => r !== reason)!);
        assert.equal(again.marked, false);
        assert.equal(again.review_reason, reason);
        assert.deepEqual(await operation(tx), stored);
        await tx`DELETE FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
      }
    },
  ],
  [
    'mark rejects an invalid reason, a wrong token, an expired claim, a paid_timeout source, a started external call and a non-preparing shipment; rows stay unchanged',
    async (tx) => {
      const token = await claim(tx);
      const before = await operation(tx);
      await rejects(tx, (sp) => mark(sp, token, 'because'), 'INVALID_REVIEW_REASON');
      await rejects(tx, (sp) => mark(sp, token, '  '), 'INVALID_REVIEW_REASON');
      await rejects(tx, (sp) => mark(sp, '7b440000-0000-4000-8000-0000000000ff', 'carrier_refused'), 'STALE_CANCELLATION_CLAIM');
      assert.deepEqual(await operation(tx), before);

      await tx`UPDATE public.shipments SET status = 'shipped' WHERE id = ${ids.shipment}`;
      await rejects(tx, (sp) => mark(sp, token, 'carrier_refused'), 'SHIPMENT_NOT_CANCELABLE');
      assert.deepEqual(await operation(tx), before);
      await tx`UPDATE public.shipments SET status = 'preparing' WHERE id = ${ids.shipment}`;

      await tx`UPDATE public.shipment_cancellation_operations SET external_started_at = clock_timestamp() WHERE shipment_id = ${ids.shipment}`;
      const started = await operation(tx);
      await rejects(tx, (sp) => mark(sp, token, 'carrier_refused'), 'CANCELLATION_EXTERNAL_ALREADY_STARTED');
      assert.deepEqual(await operation(tx), started);
      await tx`UPDATE public.shipment_cancellation_operations SET external_started_at = NULL WHERE shipment_id = ${ids.shipment}`;

      await expireClaim(tx);
      const expired = await operation(tx);
      await rejects(tx, (sp) => mark(sp, token, 'carrier_refused'), 'CANCELLATION_CLAIM_EXPIRED');
      assert.deepEqual(await operation(tx), expired);

      const paidToken = await claim(tx, ids.paid, 'paid_timeout');
      const paidBefore = await operation(tx, ids.paid);
      await rejects(tx, (sp) => mark(sp, paidToken, 'carrier_refused', ids.paid), 'INVALID_CARRIER_CANCELLATION_SOURCE');
      assert.deepEqual(await operation(tx, ids.paid), paidBefore);

      await rejects(tx, (sp) => mark(sp, token, 'carrier_refused', '7b440000-0000-4000-8000-0000000000fe'), 'SHIPMENT_NOT_FOUND');
    },
  ],
  [
    'get returns the outcome, balance, loss and review fields, before and after a review',
    async (tx) => {
      const token = await claim(tx);
      const empty = await getCarrier(tx);
      assert.equal(empty.carrier_cancellation_outcome, null);
      assert.equal(empty.carrier_balance_returned, null);
      assert.equal(empty.label_cost_loss_cents, null);
      assert.equal(empty.review_reason, null);
      assert.equal(empty.review_required_at, null);
      assert.equal(empty.review_resolution, null);
      assert.equal(empty.review_resolved_at, null);
      assert.equal(empty.review_resolved_by, null);
      assert.equal(empty.review_resolution_note, null);

      await outcomeRpc(tx, token, 'refused');
      await mark(tx, token, 'carrier_refused');
      const pending = await getCarrier(tx);
      assert.equal(pending.carrier_cancellation_outcome, 'refused');
      assert.ok(pending.carrier_cancellation_recorded_at);
      assert.equal(pending.review_reason, 'carrier_refused');
      assert.ok(pending.review_required_at);
      assert.equal(pending.review_resolution, null);

      await resolve(tx, 'refund_approved', 'seller confirmed');
      const resolved = await getCarrier(tx);
      assert.equal(resolved.review_resolution, 'refund_approved');
      assert.ok(resolved.review_resolved_at);
      assert.equal(resolved.review_resolved_by, ids.admin);
      assert.equal(resolved.review_resolution_note, 'seller confirmed');
      assert.equal(Number(resolved.label_cost_loss_cents), labelCost);
      assert.equal(resolved.carrier_balance_returned, null);

      // An accepted outcome with the balance returned is visible too.
      await tx`DELETE FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
      const next = await claim(tx);
      await tx`SELECT public.fn_record_shipment_carrier_cancellation(${ids.shipment}::uuid, ${next}::uuid, 'accepted', true, '2026-10-23T10:00:00Z'::timestamptz)`;
      const accepted = await getCarrier(tx);
      assert.equal(accepted.carrier_cancellation_outcome, 'accepted');
      assert.equal(accepted.carrier_balance_returned, true);
      assert.ok(accepted.carrier_balance_returned_at);
      assert.equal(Number(accepted.label_cost_loss_cents), 0);
      assert.equal(accepted.review_reason, null);
    },
  ],
  [
    'get rejects a missing shipment and a shipment without an operation',
    async (tx) => {
      await rejects(tx, (sp) => getCarrier(sp, '7b440000-0000-4000-8000-0000000000fe'), 'SHIPMENT_NOT_FOUND');
      await rejects(tx, (sp) => getCarrier(sp), 'CANCELLATION_OPERATION_NOT_FOUND');
    },
  ],
  [
    'claim on a pending review raises SHIPMENT_CANCELLATION_UNDER_REVIEW and does not rotate the token',
    async (tx) => {
      const token = await reviewed(tx);
      await expireClaim(tx);
      const before = await operation(tx);
      await rejects(tx, (sp) => claim(sp), 'SHIPMENT_CANCELLATION_UNDER_REVIEW');
      assert.deepEqual(await operation(tx), before);
      assert.equal((await operation(tx)).claim_token, token);
    },
  ],
  [
    'claim after closed_no_refund raises SHIPMENT_CANCELLATION_REVIEW_CLOSED and does not rotate the token',
    async (tx) => {
      const token = await reviewed(tx);
      await resolve(tx, 'closed_no_refund', 'the package travels');
      await expireClaim(tx);
      const before = await operation(tx);
      await rejects(tx, (sp) => claim(sp), 'SHIPMENT_CANCELLATION_REVIEW_CLOSED');
      assert.deepEqual(await operation(tx), before);
      assert.equal((await operation(tx)).claim_token, token);
    },
  ],
  [
    'resolve refund_approved sets the loss to the label provider cost and records who, when and why',
    async (tx) => {
      await reviewed(tx);
      const result = await resolve(tx, 'refund_approved', '  checked with the carrier  ');
      assert.equal(result.review_resolution, 'refund_approved');
      assert.equal(Number(result.label_cost_loss_cents), labelCost);
      assert.equal(result.review_resolution_note, 'checked with the carrier');
      const row = await operation(tx);
      assert.equal(row.review_resolution, 'refund_approved');
      assert.ok(row.review_resolved_at);
      assert.equal(row.review_resolved_by, ids.admin);
      assert.equal(row.review_resolution_note, 'checked with the carrier');
      assert.equal(Number(row.label_cost_loss_cents), labelCost);
      assert.equal(row.carrier_balance_returned, null);
      assert.equal(row.external_started_at, null);
      assert.equal(row.cancellation_loss_cents, null);
      assert.equal(row.refund_request, null);
    },
  ],
  [
    'resolve refund_approved with an unknown label cost leaves the loss NULL',
    async (tx) => {
      await tx`UPDATE public.shipments SET label_provider_cost_cents = NULL WHERE id = ${ids.shipment}`;
      await reviewed(tx);
      const result = await resolve(tx, 'refund_approved');
      assert.equal(result.label_cost_loss_cents, null);
      const row = await operation(tx);
      assert.equal(row.review_resolution, 'refund_approved');
      assert.equal(row.label_cost_loss_cents, null);
    },
  ],
  [
    'resolve refund_approved never overwrites a loss already recorded by an accepted outcome',
    async (tx) => {
      const token = await claim(tx);
      await tx`SELECT public.fn_record_shipment_carrier_cancellation(${ids.shipment}::uuid, ${token}::uuid, 'accepted', true, '2026-10-23T10:00:00Z'::timestamptz)`;
      await mark(tx, token, 'carrier_ambiguous');
      await resolve(tx, 'refund_approved');
      const row = await operation(tx);
      assert.equal(Number(row.label_cost_loss_cents), 0);
      assert.equal(row.carrier_balance_returned, true);
    },
  ],
  [
    'resolve closed_no_refund leaves the loss NULL and records the resolution',
    async (tx) => {
      await reviewed(tx);
      const result = await resolve(tx, 'closed_no_refund', 'the package was delivered');
      assert.equal(result.review_resolution, 'closed_no_refund');
      assert.equal(result.label_cost_loss_cents, null);
      const row = await operation(tx);
      assert.equal(row.review_resolution, 'closed_no_refund');
      assert.ok(row.review_resolved_at);
      assert.equal(row.review_resolved_by, ids.admin);
      assert.equal(row.review_resolution_note, 'the package was delivered');
      assert.equal(row.label_cost_loss_cents, null);
      assert.equal(row.external_started_at, null);
    },
  ],
  [
    'resolve rejects a non-admin, a missing admin, a blank note, an invalid resolution; the row stays unchanged',
    async (tx) => {
      await reviewed(tx);
      const before = await operation(tx);
      await rejects(tx, (sp) => resolve(sp, 'refund_approved', 'ok', ids.buyer), 'ADMIN_REQUIRED');
      await rejects(tx, (sp) => resolve(sp, 'refund_approved', 'ok', ids.seller), 'ADMIN_REQUIRED');
      await rejects(tx, (sp) => resolve(sp, 'refund_approved', 'ok', null), 'ADMIN_REQUIRED');
      await rejects(tx, (sp) => resolve(sp, 'refund_approved', '   '), 'INVALID_REVIEW_NOTE');
      await rejects(tx, (sp) => resolve(sp, 'refund_approved', null), 'INVALID_REVIEW_NOTE');
      await rejects(tx, (sp) => resolve(sp, 'refund_approved', 'x'.repeat(501)), 'INVALID_REVIEW_NOTE');
      await rejects(tx, (sp) => resolve(sp, 'approved'), 'INVALID_REVIEW_RESOLUTION');
      await rejects(tx, (sp) => resolve(sp, ''), 'INVALID_REVIEW_RESOLUTION');
      assert.deepEqual(await operation(tx), before);
    },
  ],
  [
    'resolve rejects a missing shipment, no operation, no pending review, an already resolved review, a started external call and a non-preparing shipment',
    async (tx) => {
      await rejects(tx, (sp) => resolve(sp, 'refund_approved', 'ok', ids.admin, '7b440000-0000-4000-8000-0000000000fe'), 'SHIPMENT_NOT_FOUND');
      await rejects(tx, (sp) => resolve(sp, 'refund_approved'), 'CARRIER_REVIEW_NOT_PENDING');

      const token = await claim(tx);
      const unmarked = await operation(tx);
      await rejects(tx, (sp) => resolve(sp, 'refund_approved'), 'CARRIER_REVIEW_NOT_PENDING');
      assert.deepEqual(await operation(tx), unmarked);

      await mark(tx, token, 'tracking_unknown');
      await tx`UPDATE public.shipments SET status = 'shipped' WHERE id = ${ids.shipment}`;
      const pending = await operation(tx);
      await rejects(tx, (sp) => resolve(sp, 'refund_approved'), 'SHIPMENT_NOT_CANCELABLE');
      assert.deepEqual(await operation(tx), pending);
      await tx`UPDATE public.shipments SET status = 'preparing' WHERE id = ${ids.shipment}`;

      await tx`UPDATE public.shipment_cancellation_operations SET external_started_at = clock_timestamp() WHERE shipment_id = ${ids.shipment}`;
      const started = await operation(tx);
      await rejects(tx, (sp) => resolve(sp, 'refund_approved'), 'CANCELLATION_EXTERNAL_ALREADY_STARTED');
      assert.deepEqual(await operation(tx), started);
      await tx`UPDATE public.shipment_cancellation_operations SET external_started_at = NULL WHERE shipment_id = ${ids.shipment}`;

      await resolve(tx, 'closed_no_refund', 'first decision');
      const resolved = await operation(tx);
      await rejects(tx, (sp) => resolve(sp, 'refund_approved', 'second decision'), 'CARRIER_REVIEW_ALREADY_RESOLVED');
      await rejects(tx, (sp) => resolve(sp, 'closed_no_refund', 'again'), 'CARRIER_REVIEW_ALREADY_RESOLVED');
      assert.deepEqual(await operation(tx), resolved);
    },
  ],
  [
    'after refund_approved a fresh claim succeeds and the refund start succeeds even with a refused outcome',
    async (tx) => {
      const token = await claim(tx);
      await outcomeRpc(tx, token, 'refused');
      await mark(tx, token, 'carrier_refused');
      await resolve(tx, 'refund_approved');
      await expireClaim(tx);
      const fresh = await claim(tx);
      assert.notEqual(fresh, token);
      const result = await startRefund(tx, fresh);
      assert.equal(result.operation_key, `cancel_shipment_${ids.shipment}`);
      assert.deepEqual(result.refund_request, request(ids.shipment, 'preparing_timeout'));
      const row = await operation(tx);
      assert.ok(row.external_started_at);
      assert.equal(row.carrier_cancellation_outcome, 'refused');
      assert.equal(Number(row.label_cost_loss_cents), labelCost);
    },
  ],
  [
    'after refund_approved with no recorded outcome the refund start succeeds',
    async (tx) => {
      await reviewed(tx, 'tracking_unknown');
      await resolve(tx, 'refund_approved');
      await expireClaim(tx);
      const fresh = await claim(tx);
      const result = await startRefund(tx, fresh);
      assert.equal(result.operation_key, `cancel_shipment_${ids.shipment}`);
      assert.ok((await operation(tx)).external_started_at);
    },
  ],
  [
    'start still raises CARRIER_CANCELLATION_NOT_CONFIRMED with a pending review and after closed_no_refund',
    async (tx) => {
      const token = await reviewed(tx);
      const pending = await operation(tx);
      await rejects(tx, (sp) => startRefund(sp, token), 'CARRIER_CANCELLATION_NOT_CONFIRMED');
      assert.deepEqual(await operation(tx), pending);

      await resolve(tx, 'closed_no_refund', 'no refund');
      const closed = await operation(tx);
      await rejects(tx, (sp) => startRefund(sp, token), 'CARRIER_CANCELLATION_NOT_CONFIRMED');
      assert.deepEqual(await operation(tx), closed);
      assert.equal(closed.external_started_at, null);
    },
  ],
  [
    'list returns only pending reviews, oldest first, with the review columns',
    async (tx) => {
      assert.equal((await list(tx)).length, 0);
      await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id,
          label_generation_state, label_provider_cost_cents, tracking_number, carrier)
        VALUES (${ids.second}, ${ids.order}, ${ids.seller}, 'preparing', ${paymentIntent}, 'generated', NULL, 'TRK-B44A-2', 'fedex'),
               (${ids.third}, ${ids.order}, ${ids.seller}, 'preparing', ${paymentIntent}, 'generated', 5000, 'TRK-B44A-3', 'dhl')`;
      const first = await claim(tx, ids.shipment);
      const second = await claim(tx, ids.second);
      const third = await claim(tx, ids.third);
      await outcomeRpc(tx, first, 'ambiguous');
      await mark(tx, first, 'carrier_ambiguous');
      await mark(tx, second, 'tracking_unknown', ids.second);
      await mark(tx, third, 'carrier_refused', ids.third);
      // The third is decided, so it leaves the list; the first becomes the newest pending.
      await resolve(tx, 'closed_no_refund', 'done', ids.admin, ids.third);
      await tx`UPDATE public.shipment_cancellation_operations SET review_required_at = '2026-10-20T00:00:00Z' WHERE shipment_id = ${ids.second}`;
      await tx`UPDATE public.shipment_cancellation_operations SET review_required_at = '2026-10-21T00:00:00Z' WHERE shipment_id = ${ids.shipment}`;

      const rows = await list(tx);
      assert.deepEqual(rows.map((row: { shipment_id: string }) => row.shipment_id), [ids.second, ids.shipment]);
      assert.deepEqual(Object.keys(rows[0]).sort(), [
        'carrier',
        'carrier_cancellation_outcome',
        'label_provider_cost_cents',
        'order_id',
        'review_reason',
        'review_required_at',
        'seller_id',
        'shipment_id',
        'tracking_number',
      ]);
      assert.equal(rows[0].order_id, ids.order);
      assert.equal(rows[0].seller_id, ids.seller);
      assert.equal(rows[0].tracking_number, 'TRK-B44A-2');
      assert.equal(rows[0].carrier, 'fedex');
      assert.equal(rows[0].label_provider_cost_cents, null);
      assert.equal(rows[0].review_reason, 'tracking_unknown');
      assert.equal(rows[0].carrier_cancellation_outcome, null);
      assert.equal(rows[1].review_reason, 'carrier_ambiguous');
      assert.equal(rows[1].carrier_cancellation_outcome, 'ambiguous');
      assert.equal(Number(rows[1].label_provider_cost_cents), labelCost);
    },
  ],
  [
    'the label loss is still forbidden without an accepted outcome or an approved refund (CHECK)',
    async (tx) => {
      const token = await claim(tx);
      await outcomeRpc(tx, token, 'refused');
      await rejects(
        tx,
        (sp) => sp`UPDATE public.shipment_cancellation_operations SET label_cost_loss_cents = 100 WHERE shipment_id = ${ids.shipment}`,
        'shipment_cancellation_operations_carrier_balance_consistent',
      );
      await mark(tx, token, 'carrier_refused');
      await rejects(
        tx,
        (sp) => sp`UPDATE public.shipment_cancellation_operations SET label_cost_loss_cents = 100 WHERE shipment_id = ${ids.shipment}`,
        'shipment_cancellation_operations_carrier_balance_consistent',
      );
      await rejects(
        tx,
        (sp) => sp`UPDATE public.shipment_cancellation_operations SET review_resolution = 'refund_approved' WHERE shipment_id = ${ids.shipment}`,
        'review',
      );
    },
  ],
  [
    'an accepted outcome marked for review cannot start the refund while pending or after closed_no_refund, with the live token',
    async (tx) => {
      const token = await claim(tx);
      await tx`SELECT public.fn_record_shipment_carrier_cancellation(${ids.shipment}::uuid, ${token}::uuid, 'accepted', true, '2026-10-23T10:00:00Z'::timestamptz)`;
      await mark(tx, token, 'carrier_ambiguous');
      const pending = await operation(tx);
      await rejects(tx, (sp) => startRefund(sp, token), 'CARRIER_CANCELLATION_NOT_CONFIRMED');
      assert.deepEqual(await operation(tx), pending);
      assert.equal(pending.external_started_at, null);

      await resolve(tx, 'closed_no_refund', 'no refund');
      const closed = await operation(tx);
      await rejects(tx, (sp) => startRefund(sp, token), 'CARRIER_CANCELLATION_NOT_CONFIRMED');
      assert.deepEqual(await operation(tx), closed);
      assert.equal(closed.external_started_at, null);
    },
  ],
  [
    'an accepted outcome marked for review starts the refund with the live token once refund_approved',
    async (tx) => {
      const token = await claim(tx);
      await tx`SELECT public.fn_record_shipment_carrier_cancellation(${ids.shipment}::uuid, ${token}::uuid, 'accepted', true, '2026-10-23T10:00:00Z'::timestamptz)`;
      await mark(tx, token, 'carrier_ambiguous');
      await resolve(tx, 'refund_approved', 'approved');
      const result = await startRefund(tx, token);
      assert.equal(result.operation_key, `cancel_shipment_${ids.shipment}`);
      assert.ok((await operation(tx)).external_started_at);
    },
  ],
  [
    'direct writes that break the carrier and review invariants are rejected by constraints',
    async (tx) => {
      const token = await claim(tx);
      await tx`RESET ROLE`;
      await rejects(
        tx,
        (sp) => sp`UPDATE public.shipment_cancellation_operations
          SET carrier_balance_returned = true, carrier_balance_returned_at = clock_timestamp()
          WHERE shipment_id = ${ids.shipment}`,
        'shipment_cancellation_operations_carrier_balance_consistent',
      );
      await asService(tx);
      await outcomeRpc(tx, token, 'refused');
      await mark(tx, token, 'carrier_refused');
      await tx`RESET ROLE`;
      await rejects(
        tx,
        (sp) => sp`UPDATE public.shipment_cancellation_operations SET label_cost_loss_cents = 100 WHERE shipment_id = ${ids.shipment}`,
        'shipment_cancellation_operations_carrier_balance_consistent',
      );
      await asService(tx);
      await resolve(tx, 'closed_no_refund', 'no refund');
      await tx`RESET ROLE`;
      await rejects(
        tx,
        (sp) => sp`UPDATE public.shipment_cancellation_operations SET label_cost_loss_cents = 100 WHERE shipment_id = ${ids.shipment}`,
        'shipment_cancellation_operations_carrier_balance_consistent',
      );
      await tx`DELETE FROM public.shipment_cancellation_operations WHERE shipment_id = ${ids.shipment}`;
      await asService(tx);
      await claim(tx);
      await tx`RESET ROLE`;
      await rejects(
        tx,
        (sp) => sp`UPDATE public.shipment_cancellation_operations
          SET review_resolution = 'refund_approved', review_resolved_at = clock_timestamp(),
              review_resolved_by = ${ids.admin}, review_resolution_note = 'x'
          WHERE shipment_id = ${ids.shipment}`,
        'shipment_cancellation_operations_review_resolution_after_requir', // Postgres truncates names to 63 bytes
      );
    },
  ],
  [
    'a suspended admin gets ADMIN_REQUIRED on resolve and the row stays unchanged',
    async (tx) => {
      await reviewed(tx);
      const before = await operation(tx);
      await tx`RESET ROLE`;
      await tx`UPDATE public.profiles_private SET status = 'suspended' WHERE id = ${ids.admin}`;
      await asService(tx);
      await rejects(tx, (sp) => resolve(sp, 'refund_approved'), 'ADMIN_REQUIRED');
      assert.deepEqual(await operation(tx), before);
    },
  ],
  [
    'resolve leaves the claim, external start, refund request and shipment status unchanged',
    async (tx) => {
      await reviewed(tx);
      const before = await operation(tx);
      const [shipmentBefore] = await tx`SELECT status FROM public.shipments WHERE id = ${ids.shipment}`;
      await resolve(tx, 'refund_approved', 'approved');
      const after = await operation(tx);
      assert.equal(after.claim_token, before.claim_token);
      assert.deepEqual(after.claim_expires_at, before.claim_expires_at);
      assert.equal(after.external_started_at, null);
      assert.equal(after.refund_request, before.refund_request);
      const [shipmentAfter] = await tx`SELECT status FROM public.shipments WHERE id = ${ids.shipment}`;
      assert.equal(shipmentAfter.status, shipmentBefore.status);
    },
  ],
  [
    'a live claim with a pending review raises SHIPMENT_CANCELLATION_UNDER_REVIEW, not busy',
    async (tx) => {
      await reviewed(tx);
      const live = await operation(tx);
      assert.ok(new Date(live.claim_expires_at) > new Date());
      await rejects(tx, (sp) => claim(sp), 'SHIPMENT_CANCELLATION_UNDER_REVIEW');
      assert.deepEqual(await operation(tx), live);
    },
  ],
  [
    'anon and authenticated cannot execute any new RPC (grants)',
    async (tx) => {
      const token = await reviewed(tx);
      const before = await operation(tx);
      for (const role of ['anon', 'authenticated'] as const) {
        for (const action of [
          (inner: Tx) => mark(inner, token, 'carrier_refused'),
          (inner: Tx) => getCarrier(inner),
          (inner: Tx) => resolve(inner, 'refund_approved'),
          (inner: Tx) => list(inner),
        ]) {
          await tx.savepoint(async (sp) => {
            await asRole(sp as Tx, role);
            await rejects(sp as Tx, action, 'permission denied');
          });
        }
      }
      await tx`RESET ROLE`;
      await asService(tx);
      assert.deepEqual(await operation(tx), before);
    },
  ],
  [
    'the body checks the service role even when the grant is bypassed',
    async (tx) => {
      const token = await reviewed(tx);
      const before = await operation(tx);
      await tx`RESET ROLE`;
      await tx`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await rejects(tx, (sp) => mark(sp, token, 'carrier_refused'), 'UNAUTHORIZED');
      await rejects(tx, (sp) => getCarrier(sp), 'UNAUTHORIZED');
      await rejects(tx, (sp) => resolve(sp, 'refund_approved'), 'UNAUTHORIZED');
      await rejects(tx, (sp) => list(sp), 'UNAUTHORIZED');
      await asService(tx);
      assert.deepEqual(await operation(tx), before);
    },
  ],
  [
    'the claim and start grants are still service-only and the private start stays unreachable',
    async (tx) => {
      const token = await claim(tx);
      for (const role of ['anon', 'authenticated'] as const) {
        await tx.savepoint(async (sp) => {
          await asRole(sp as Tx, role);
          await rejects(sp as Tx, (inner) => claim(inner), 'permission denied');
          await rejects(sp as Tx, (inner) => startRefund(inner, token), 'permission denied');
        });
      }
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
    },
  ],
  [
    'paid_timeout claim and refund start are unaffected, and a claim with no review keeps working (busy, then rotation after expiry)',
    async (tx) => {
      const paidToken = await claim(tx, ids.paid, 'paid_timeout');
      const result = await startRefund(tx, paidToken, ids.paid, 'paid_timeout');
      assert.equal(result.operation_key, `cancel_shipment_${ids.paid}`);
      assert.ok((await operation(tx, ids.paid)).external_started_at);

      const token = await claim(tx);
      const [{ claim: busy }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.shipment}::uuid, ${ids.order}::uuid, NULL::uuid, 'preparing_timeout', 'preparing_timeout test') AS claim`;
      assert.equal(busy.status, 'busy');
      await expireClaim(tx);
      const rotated = await claim(tx);
      assert.notEqual(rotated, token);
    },
  ],
  [
    'a preparing_timeout claim re-owns an expired pre-start operation of another source; record and mark then succeed',
    async (tx) => {
      const [{ claim: buyerClaim }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'buyer asked') AS claim`;
      assert.equal(buyerClaim.status, 'claimed');
      await expireClaim(tx, ids.paid);
      await tx`UPDATE public.shipments SET status = 'preparing', label_generation_state = 'generated',
        label_provider_cost_cents = ${labelCost}, tracking_number = 'TRK-B44B-1', carrier = 'estafeta' WHERE id = ${ids.paid}`;
      const [{ claim: takeover }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, NULL::uuid, 'preparing_timeout', 'preparing timeout reason') AS claim`;
      assert.equal(takeover.status, 'claimed');
      assert.equal(takeover.source, 'preparing_timeout');
      assert.equal(takeover.actor_id, null);
      assert.equal(takeover.reason, 'preparing timeout reason');
      assert.notEqual(takeover.claim_token, buyerClaim.claim_token);
      const stored = await operation(tx, ids.paid);
      assert.equal(stored.source, 'preparing_timeout');
      assert.equal(stored.actor_id, null);
      assert.equal(stored.reason, 'preparing timeout reason');
      assert.equal(stored.external_started_at, null);
      const recorded = await outcomeRpc(tx, takeover.claim_token, 'refused', ids.paid);
      assert.equal(recorded.carrier_cancellation_outcome, 'refused');
      const marked = await mark(tx, takeover.claim_token, 'carrier_refused', ids.paid);
      assert.equal(marked.marked, true);
    },
  ],
  [
    'after the preparing takeover of an expired buyer claim the old buyer token is stale for record, mark and start; the new token needs an accepted outcome to start',
    async (tx) => {
      // The takeover case above already asserts the re-owned source, actor, reason, a new token, and that record and mark succeed with it.
      const [{ claim: buyerClaim }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'buyer asked') AS claim`;
      assert.equal(buyerClaim.status, 'claimed');
      await expireClaim(tx, ids.paid);
      await tx`UPDATE public.shipments SET status = 'preparing', label_generation_state = 'generated',
        label_provider_cost_cents = ${labelCost}, tracking_number = 'TRK-B44B-2', carrier = 'estafeta' WHERE id = ${ids.paid}`;
      // The refund metadata reason must equal the stored operation reason, which the takeover re-owns.
      const [{ claim: takeover }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, NULL::uuid, 'preparing_timeout', 'preparing_timeout test') AS claim`;
      assert.equal(takeover.status, 'claimed');
      assert.equal(takeover.operation_key, buyerClaim.operation_key);
      assert.equal(takeover.operation_key, `cancel_shipment_${ids.paid}`);
      assert.notEqual(takeover.claim_token, buyerClaim.claim_token);

      const before = await operation(tx, ids.paid);
      assert.equal(before.operation_key, buyerClaim.operation_key);
      await rejects(tx, (sp) => outcomeRpc(sp, buyerClaim.claim_token, 'refused', ids.paid), 'STALE_CANCELLATION_CLAIM');
      await rejects(tx, (sp) => mark(sp, buyerClaim.claim_token, 'carrier_refused', ids.paid), 'STALE_CANCELLATION_CLAIM');
      // The token check runs before the carrier-confirmation guard.
      await rejects(tx, (sp) => startRefund(sp, buyerClaim.claim_token, ids.paid), 'STALE_CANCELLATION_CLAIM');
      assert.deepEqual(await operation(tx, ids.paid), before);
      await rejects(tx, (sp) => startRefund(sp, takeover.claim_token, ids.paid), 'CARRIER_CANCELLATION_NOT_CONFIRMED');
      assert.deepEqual(await operation(tx, ids.paid), before);

      await tx`SELECT public.fn_record_shipment_carrier_cancellation(${ids.paid}::uuid, ${takeover.claim_token}::uuid, 'accepted', true, '2026-10-23T10:00:00Z'::timestamptz)`;
      const accepted = await operation(tx, ids.paid);
      await rejects(tx, (sp) => startRefund(sp, buyerClaim.claim_token, ids.paid), 'STALE_CANCELLATION_CLAIM');
      assert.deepEqual(await operation(tx, ids.paid), accepted);
      const result = await startRefund(tx, takeover.claim_token, ids.paid);
      assert.equal(result.operation_key, `cancel_shipment_${ids.paid}`);
      const started = await operation(tx, ids.paid);
      assert.ok(started.external_started_at);
      assert.equal(started.source, 'preparing_timeout');
      assert.equal(started.carrier_cancellation_outcome, 'accepted');
    },
  ],
  [
    'an expired buyer operation with a started external call stays recovery_required for the preparing claim, keeps the buyer source, returns no token and is byte-identical',
    async (tx) => {
      const [{ claim: buyerClaim }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'buyer asked') AS claim`;
      assert.equal(buyerClaim.status, 'claimed');
      await tx`UPDATE public.shipment_cancellation_operations SET external_started_at = clock_timestamp(), claim_expires_at = '-infinity' WHERE shipment_id = ${ids.paid}`;
      await tx`UPDATE public.shipments SET status = 'preparing', label_generation_state = 'generated',
        label_provider_cost_cents = ${labelCost}, tracking_number = 'TRK-B44B-3', carrier = 'estafeta' WHERE id = ${ids.paid}`;
      const before = await operation(tx, ids.paid);
      const [{ claim: recovery }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, NULL::uuid, 'preparing_timeout', 'preparing timeout reason') AS claim`;
      assert.equal(recovery.status, 'recovery_required');
      assert.equal(recovery.source, 'buyer');
      assert.equal(recovery.actor_id, ids.buyer);
      assert.equal(recovery.reason, 'buyer asked');
      assert.equal(recovery.operation_key, `cancel_shipment_${ids.paid}`);
      assert.equal('claim_token' in recovery, false);
      assert.deepEqual(await operation(tx, ids.paid), before);
    },
  ],
  [
    'a seller takeover of an expired buyer claim on a paid shipment keeps the buyer source, actor and reason; a paid_timeout claim then reports busy',
    async (tx) => {
      const [{ claim: buyerClaim }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'buyer asked') AS claim`;
      assert.equal(buyerClaim.status, 'claimed');
      await expireClaim(tx, ids.paid);
      const [{ claim: takeover }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, ${ids.seller}::uuid, 'seller', 'seller asked') AS claim`;
      assert.equal(takeover.status, 'claimed');
      assert.equal(takeover.source, 'buyer');
      assert.equal(takeover.actor_id, ids.buyer);
      assert.equal(takeover.reason, 'buyer asked');
      assert.equal(takeover.operation_key, buyerClaim.operation_key);
      assert.notEqual(takeover.claim_token, buyerClaim.claim_token);

      const live = await operation(tx, ids.paid);
      assert.equal(live.source, 'buyer');
      assert.equal(live.actor_id, ids.buyer);
      assert.equal(live.reason, 'buyer asked');
      assert.equal(live.claim_token, takeover.claim_token);
      const [{ claim: busy }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, NULL::uuid, 'paid_timeout', 'paid_timeout test') AS claim`;
      assert.equal(busy.status, 'busy');
      assert.equal(busy.source, 'buyer');
      assert.equal(busy.actor_id, ids.buyer);
      assert.equal('claim_token' in busy, false);
      assert.deepEqual(await operation(tx, ids.paid), live);
    },
  ],
  [
    'a live non-preparing claim stays busy and a started operation stays recovery_required for the preparing claim; nothing changes',
    async (tx) => {
      await claim(tx, ids.paid, 'paid_timeout');
      await tx`UPDATE public.shipments SET status = 'preparing', label_generation_state = 'generated' WHERE id = ${ids.paid}`;
      const before = await operation(tx, ids.paid);
      const [{ claim: busy }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, NULL::uuid, 'preparing_timeout', 'preparing timeout reason') AS claim`;
      assert.equal(busy.status, 'busy');
      assert.equal(busy.source, 'paid_timeout');
      assert.deepEqual(await operation(tx, ids.paid), before);

      await tx`UPDATE public.shipment_cancellation_operations SET external_started_at = clock_timestamp(), claim_expires_at = '-infinity' WHERE shipment_id = ${ids.paid}`;
      const started = await operation(tx, ids.paid);
      const [{ claim: recovery }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, NULL::uuid, 'preparing_timeout', 'preparing timeout reason') AS claim`;
      assert.equal(recovery.status, 'recovery_required');
      assert.equal(recovery.source, 'paid_timeout');
      assert.deepEqual(await operation(tx, ids.paid), started);
    },
  ],
  [
    'a buyer takeover of an expired paid_timeout claim keeps the paid_timeout context',
    async (tx) => {
      await claim(tx, ids.paid, 'paid_timeout');
      await expireClaim(tx, ids.paid);
      const [{ claim: takeover }] = await tx`SELECT public.fn_claim_shipment_cancellation(
        ${ids.paid}::uuid, ${ids.order}::uuid, ${ids.buyer}::uuid, 'buyer', 'buyer asked') AS claim`;
      assert.equal(takeover.status, 'claimed');
      assert.equal(takeover.source, 'paid_timeout');
      assert.equal(takeover.actor_id, null);
      assert.equal(takeover.reason, 'paid_timeout test');
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
