import { describe, expect, test } from 'bun:test';
import {
  REFUND_REPLAY_WINDOW_MS,
  runShipmentCancellation,
  type CancellationRefundRecordInput,
  type ShipmentCancellationPorts,
} from './shipment-cancellation.ts';

// Boundary probes from the B2.2 independent verification (odd/tasks/shipment-cancellations-b2.md L17).

const SHIP = 'ship-1';
const ORDER = 'order-1';
const KEY = `cancel_shipment_${SHIP}`;
const STARTED = '2026-10-20T00:00:00.000Z';
const T0 = Date.parse(STARTED);
const frozen = {
  amount: 5000,
  reason: 'requested_by_customer',
  metadata: { reason: 'Stored', order_id: ORDER, caller_role: 'seller', shipment_id: SHIP, seguro_share_cents: 300 },
  payment_intent: 'pi_shared',
};
const op = (o: Record<string, unknown> = {}) => ({
  operation_key: KEY, order_id: ORDER, source: 'seller', actor_id: 'seller-1', reason: 'Stored',
  refund_request: frozen, cancellation_loss_cents: 77, refund_id: null, refund_status: null,
  external_started_at: STARTED, ...o,
});
const own = (o: Record<string, unknown> = {}) => ({
  id: 're_own', payment_intent: 'pi_shared', amount: 5000, status: 'succeeded', failure_reason: null,
  metadata: { shipment_id: SHIP }, ...o,
});
const sibling = { id: 're_sib', payment_intent: 'pi_shared', amount: 5000, status: 'succeeded', metadata: { shipment_id: 'ship-2' } };

interface State {
  creates: unknown[][];
  records: CancellationRefundRecordInput[];
  completes: unknown[][];
  lists: number;
  retrieves: string[];
  crit: string[];
  prepares: number;
  starts: number;
}
function h(operation: unknown, o: Record<string, unknown> = {}, now = T0 + 1000) {
  const s: State = { creates: [], records: [], completes: [], lists: 0, retrieves: [], crit: [], prepares: 0, starts: 0 };
  const ports: Record<string, unknown> = {
    context: { shipmentId: SHIP, orderId: ORDER, actorId: 'buyer-9', source: 'buyer', reason: 'Caller reason' },
    claim: async () => ({ status: 'recovery_required', operation_key: KEY }),
    prepare: async () => { s.prepares++; throw new Error('prepare'); },
    start: async () => { s.starts++; throw new Error('start'); },
    refund: async (req: unknown, opts: unknown) => { s.creates.push([req, opts]); return own(); },
    recordRefund: async (i: CancellationRefundRecordInput) => { s.records.push(i); return { refund_id: i.refundId, refund_status: i.status }; },
    loadRecovery: async () => operation,
    listRefunds: async () => { s.lists++; return []; },
    retrieveRefund: async (id: string) => { s.retrieves.push(id); return own(); },
    reportCritical: async (m: string) => { s.crit.push(m); },
    now: () => now,
    complete: async (w: unknown, f: unknown) => { s.completes.push([w, f]); return 'ok'; },
  };
  for (const [k, v] of Object.entries(o)) ports[k] = typeof v === 'function' ? (v as (state: State) => unknown)(s) : v;
  return { s, run: () => runShipmentCancellation(ports as unknown as ShipmentCancellationPorts<string>) };
}
const list = (items: unknown[]) => (s: State) => async () => { s.lists++; return items; };

describe('shipment cancellation recovery boundaries', () => {
  test('S1/S2 recorded succeeded completes with stored winner, no Stripe, no prepare/start', async () => {
    const { s, run } = h(op({ refund_id: 're_own', refund_status: 'succeeded' }));
    expect(await run()).toEqual({ status: 'cancelled', value: 'ok' });
    expect(s.creates.length + s.lists + s.retrieves.length + s.prepares + s.starts).toBe(0);
    expect(s.completes[0]![0]).toMatchObject({ source: 'seller', actorId: 'seller-1', reason: 'Stored', shipmentId: SHIP });
    expect(s.completes[0]![1]).toEqual({ operationKey: KEY, refundRequest: frozen, cancellationLossCents: 77 });
  });
  test('status succeeded without refund_id never completes', async () => {
    const { s, run } = h(op({ refund_status: 'succeeded' }));
    expect(await run()).toEqual({ status: 'recovery_required' });
    expect(s.completes.length + s.creates.length).toBe(0);
  });
  for (const st of ['failed', 'canceled'])
    test(`recorded ${st}: no Stripe call, no completion`, async () => {
      const { s, run } = h(op({ refund_id: 're_own', refund_status: st }));
      expect(await run()).toEqual({ status: 'recovery_required' });
      expect(s.creates.length + s.lists + s.retrieves.length + s.completes.length).toBe(0);
    });
  test('S5 sibling-only list under 23h replays frozen request with the same key exactly once', async () => {
    const { s, run } = h(op(), { listRefunds: list([sibling]) });
    expect(await run()).toEqual({ status: 'cancelled', value: 'ok' });
    expect(s.creates).toEqual([[frozen, { idempotencyKey: KEY }]]);
    expect(s.records[0]).toMatchObject({ refundId: 're_own', paymentIntentId: 'pi_shared', amountCents: 5000, status: 'succeeded' });
  });
  test('S5 sibling never adopted at >=23h: no create, no record, CRITICAL', async () => {
    const { s, run } = h(op(), { listRefunds: list([sibling]) }, T0 + REFUND_REPLAY_WINDOW_MS);
    expect(await run()).toEqual({ status: 'recovery_required' });
    expect(s.creates.length + s.records.length + s.completes.length).toBe(0);
    expect(s.crit).toEqual(['CANCELLATION_REFUND_NOT_FOUND']);
  });
  test('S4 boundary: 23h minus 1ms still replays once', async () => {
    const { s, run } = h(op(), {}, T0 + REFUND_REPLAY_WINDOW_MS - 1);
    expect((await run()).status).toBe('cancelled');
    expect(s.creates.length).toBe(1);
    expect(REFUND_REPLAY_WINDOW_MS).toBe(23 * 3600 * 1000);
  });
  test('S4 after 48h with own refund listed: uses it, never creates', async () => {
    const { s, run } = h(op(), { listRefunds: list([sibling, own()]) }, T0 + 48 * 3600e3);
    expect(await run()).toEqual({ status: 'cancelled', value: 'ok' });
    expect(s.creates.length).toBe(0);
    expect(s.records.map((r: CancellationRefundRecordInput) => r.refundId)).toEqual(['re_own']);
  });
  test('>1 match under 23h: never creates, CRITICAL', async () => {
    const { s, run } = h(op(), { listRefunds: list([own(), own({ id: 're_two' })]) });
    expect(await run()).toEqual({ status: 'recovery_required' });
    expect(s.creates.length + s.records.length + s.completes.length).toBe(0);
    expect(s.crit).toEqual(['CANCELLATION_REFUND_AMBIGUOUS']);
  });
  test('listed own refund failed: recorded failed, not completed, no create', async () => {
    const { s, run } = h(op(), {
      listRefunds: list([own({ status: 'failed', failure_reason: 'expired_or_canceled_card' })]),
      recordRefund: (s: State) => async (i: CancellationRefundRecordInput) => { s.records.push(i); return { refund_id: i.refundId, refund_status: 'failed' }; },
    });
    await expect(run()).rejects.toMatchObject({ message: 'CANCELLATION_REFUND_UNCONFIRMED' });
    expect(s.creates.length + s.completes.length).toBe(0);
    expect(s.records[0]).toMatchObject({ status: 'failed', failureReason: 'expired_or_canceled_card' });
  });
  test('retrieved refund of another shipment fails closed without record', async () => {
    const { s, run } = h(op({ refund_id: 're_own', refund_status: 'pending' }), { retrieveRefund: () => async () => own({ metadata: { shipment_id: 'ship-2' } }) });
    await expect(run()).rejects.toMatchObject({ message: 'CANCELLATION_REFUND_UNCONFIRMED' });
    expect(s.records.length + s.completes.length + s.creates.length).toBe(0);
  });
  test('retrieved refund with a different id fails closed', async () => {
    const { s, run } = h(op({ refund_id: 're_own', refund_status: 'requires_action' }), { retrieveRefund: () => async () => own({ id: 're_other' }) });
    await expect(run()).rejects.toMatchObject({ message: 'CANCELLATION_REFUND_UNCONFIRMED' });
    expect(s.records.length + s.completes.length).toBe(0);
  });
  test('replayed response for another shipment fails closed without record', async () => {
    const { s, run } = h(op(), { refund: (s: State) => async (r: unknown, o: unknown) => { s.creates.push([r, o]); return own({ metadata: { shipment_id: 'ship-2' } }); } });
    await expect(run()).rejects.toMatchObject({ message: 'CANCELLATION_REFUND_UNCONFIRMED' });
    expect(s.records.length + s.completes.length).toBe(0);
  });
  test('record returns pending -> not completed', async () => {
    const { s, run } = h(op(), { listRefunds: list([own()]), recordRefund: () => async () => ({ refund_id: 're_own', refund_status: 'pending' }) });
    await expect(run()).rejects.toMatchObject({ message: 'CANCELLATION_REFUND_UNCONFIRMED' });
    expect(s.completes.length).toBe(0);
  });
  const bads: Array<[string, unknown]> = [
    ['null', null], ['wrong key', op({ operation_key: 'cancel_shipment_x' })], ['other order', op({ order_id: 'o2' })],
    ['frozen for other shipment', op({ refund_request: { ...frozen, metadata: { ...frozen.metadata, shipment_id: 'ship-2' } } })],
    ['no frozen request', op({ refund_request: null })], ['bad started_at', op({ external_started_at: 'nope' })],
    ['timeout source with actor', op({ source: 'paid_timeout' })], ['negative loss', op({ cancellation_loss_cents: -1 })],
    ['status without id', op({ refund_status: 'pending' })],
  ];
  for (const [label, bad] of bads)
    test(`invalid operation (${label}) -> recovery_required, no Stripe`, async () => {
      const { s, run } = h(bad);
      expect(await run()).toEqual({ status: 'recovery_required' });
      expect(s.creates.length + s.lists + s.retrieves.length + s.completes.length).toBe(0);
    });
  test('record failure + sync-throwing reporter: original error kept, no completion', async () => {
    const { s, run } = h(op(), { listRefunds: list([own()]), recordRefund: () => async () => { throw new Error('rpc down'); }, reportCritical: () => () => { throw new Error('sentry'); } });
    await expect(run()).rejects.toThrow('rpc down');
    expect(s.completes.length + s.creates.length).toBe(0);
  });
  test('rejecting reporter in ambiguous path still returns recovery_required', async () => {
    const { s, run } = h(op(), { listRefunds: list([own(), own({ id: 'x' })]), reportCritical: () => async () => { throw new Error('sentry'); } });
    expect(await run()).toEqual({ status: 'recovery_required' });
    expect(s.creates.length).toBe(0);
  });
});
