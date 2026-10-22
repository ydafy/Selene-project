import { describe, expect, test } from 'bun:test';
import {
  REFUND_REPLAY_WINDOW_MS,
  runShipmentCancellation,
  type CancellationRefundRecordInput,
  type ShipmentCancellationPorts,
} from './shipment-cancellation.ts';

// Escalation boundary probes from the B2.2.1 independent verification (odd/tasks/shipment-cancellations-b2.md L23).

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
  external_started_at: STARTED, recovery_escalated_at: null, ...o,
});
const own = (o: Record<string, unknown> = {}) => ({
  id: 're_own', payment_intent: 'pi_shared', amount: 5000, status: 'succeeded', failure_reason: null,
  metadata: { shipment_id: SHIP }, ...o,
});

interface State {
  creates: unknown[][];
  records: CancellationRefundRecordInput[];
  completes: unknown[][];
  lists: number;
  retrieves: string[];
  crit: string[];
  critData: Record<string, unknown>[];
  escalations: unknown[][];
  prepares: number;
  starts: number;
}
function h(operation: unknown, o: Record<string, unknown> = {}, now = T0 + 1000) {
  const s: State = { creates: [], records: [], completes: [], lists: 0, retrieves: [], crit: [], critData: [], escalations: [], prepares: 0, starts: 0 };
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
    reportCritical: async (m: string, d: Record<string, unknown>) => { s.crit.push(m); s.critData.push(d); },
    escalate: async (id: string, r: string) => { s.escalations.push([id, r]); return { escalated: true }; },
    now: () => now,
    complete: async (w: unknown, f: unknown) => { s.completes.push([w, f]); return 'ok'; },
  };
  for (const [k, v] of Object.entries(o)) ports[k] = typeof v === 'function' ? (v as (state: State) => unknown)(s) : v;
  return { s, run: () => runShipmentCancellation(ports as unknown as ShipmentCancellationPorts<string>) };
}

const list = (items: unknown[]) => (s: State) => async () => { s.lists++; return items; };
const late = T0 + REFUND_REPLAY_WINDOW_MS;
const esc = (result: unknown) => (s: State) => async (id: string, r: string) => { s.escalations.push([id, r]); return result; };
const none = (s: State) => s.creates.length + s.completes.length + s.records.length;

describe('shipment cancellation escalation boundaries (S1, S4)', () => {
  for (const [name, result] of [['escalated false', { escalated: false }], ['extra key', { escalated: true, extra: 1 }], ['string true', { escalated: 'true' }], ['null', null], ['array', [true]], ['empty object', {}]] as const)
    test(`NOT_FOUND with escalate result ${name}: no alert, no money`, async () => {
      const { s, run } = h(op(), { escalate: esc(result) }, late);
      expect(await run()).toEqual({ status: 'recovery_required' });
      expect(s.escalations).toEqual([[SHIP, 'refund_not_found']]);
      expect(s.crit).toEqual([]);
      expect(none(s)).toBe(0);
    });
  test('AMBIGUOUS escalate throws: alerts with escalationFailed, no money', async () => {
    const { s, run } = h(op(), { listRefunds: list([own(), own({ id: 're_two' })]), escalate: (st: State) => async (id: string, r: string) => { st.escalations.push([id, r]); throw new Error('rpc down'); } });
    expect(await run()).toEqual({ status: 'recovery_required' });
    expect(s.crit).toEqual(['CANCELLATION_REFUND_AMBIGUOUS']);
    expect(s.critData[0]).toMatchObject({ escalationFailed: true, refundIds: ['re_own', 're_two'] });
    expect(none(s)).toBe(0);
  });
  test('escalated inside the 23 h window: no list, replay, escalate or alert', async () => {
    const { s, run } = h(op({ recovery_escalated_at: STARTED }), {}, T0 + 1000);
    expect(await run()).toEqual({ status: 'recovery_required' });
    expect(s.lists + s.retrieves.length + s.escalations.length + s.crit.length + none(s)).toBe(0);
  });
  test('escalated + recorded requires_action is retrieved and settled', async () => {
    const { s, run } = h(op({ recovery_escalated_at: STARTED, refund_id: 're_own', refund_status: 'requires_action' }), {}, late);
    expect(await run()).toEqual({ status: 'cancelled', value: 'ok' });
    expect(s.retrieves).toEqual(['re_own']);
    expect(s.creates).toEqual([]);
  });
  test('deploy order: old read without recovery_escalated_at never completes or refunds', async () => {
    const legacy: Record<string, unknown> = op({ refund_id: 're_own', refund_status: 'succeeded' });
    delete legacy.recovery_escalated_at;
    const { s, run } = h(legacy);
    expect(await run()).toEqual({ status: 'recovery_required' });
    expect(s.lists + s.retrieves.length + s.escalations.length + s.crit.length + none(s)).toBe(0);
  });
  for (const bad of ['', 'not-a-date', 0, false])
    test(`malformed recovery_escalated_at ${JSON.stringify(bad)} fails closed`, async () => {
      const { s, run } = h(op({ recovery_escalated_at: bad }));
      expect(await run()).toEqual({ status: 'recovery_required' });
      expect(s.lists + none(s)).toBe(0);
    });
});
