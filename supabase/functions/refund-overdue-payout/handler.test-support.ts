/**
 * Shared fixtures and the fake-port harness of the refund-overdue-payout handler tests
 * (handler-*.test.ts). Not a test file: it registers no tests.
 */

import {
  createRefundOverduePayoutHandler,
  type OverdueOrder,
  type OverdueShipment,
  type RefundOverduePayoutDeps,
} from './handler.ts';

export const ADMIN = '00000000-0000-4000-8000-000000000001';
export const SHIP = '7b310000-0000-4000-8000-000000000011';
export const OTHER_SHIP = '7b310000-0000-4000-8000-000000000012';
export const ORDER = '7b310000-0000-4000-8000-000000000001';
export const KEY = `cancel_shipment_${SHIP}`;
export const REASON = 'overdue_payout_seller_rejected';
export const STARTED = '2026-11-10T00:00:00.000Z';

export const shipmentRow = (
  overrides: Partial<OverdueShipment> = {},
): OverdueShipment => ({
  shipment_id: SHIP,
  order_id: ORDER,
  status: 'completed',
  stripe_payment_intent_id: 'pi_overdue',
  stripe_account_id: 'acct_rejected',
  stripe_onboarding_status: 'rejected',
  is_payout_overdue: true,
  ...overrides,
});

// Two shipments: this one sells 10000 and the other 5000; the buyer paid 15900 (900 Seguro).
// This shipment's share: 10000 + round(900 * 10000 / 15000) = 10600.
export const orderRow = (
  overrides: Partial<OverdueOrder> = {},
): OverdueOrder => ({
  stripe_payment_intent_id: 'pi_overdue',
  actual_stripe_fee_cents: 585,
  items: [
    {
      price_at_purchase_cents: 10000,
      shipping_amount_cents: 0,
      shipment_id: SHIP,
    },
    {
      price_at_purchase_cents: 5000,
      shipping_amount_cents: 0,
      shipment_id: OTHER_SHIP,
    },
  ],
  ...overrides,
});

export const paymentIntent = (charge: Record<string, unknown> = {}) => ({
  id: 'pi_overdue',
  latest_charge: {
    id: 'ch_overdue',
    amount: 15900,
    amount_refunded: 0,
    payment_method_details: { type: 'card' },
    balance_transaction: { id: 'txn_1', fee: 585 },
    ...charge,
  },
});

export const frozenRequest = (amount = 10600, seguro = 600) => ({
  payment_intent: 'pi_overdue',
  amount,
  reason: 'requested_by_customer',
  metadata: {
    shipment_id: SHIP,
    order_id: ORDER,
    caller_role: 'admin',
    reason: REASON,
    seguro_share_cents: seguro,
  },
});

export const startedOperation = (overrides: Record<string, unknown> = {}) => ({
  operation_key: KEY,
  order_id: ORDER,
  source: 'admin_overdue_payout',
  actor_id: ADMIN,
  reason: REASON,
  refund_request: frozenRequest(),
  cancellation_loss_cents: 390,
  refund_id: null,
  refund_status: null,
  external_started_at: STARTED,
  recovery_escalated_at: null,
  ...overrides,
});

export const stripeRefund = (overrides: Record<string, unknown> = {}) => ({
  id: 're_overdue',
  payment_intent: 'pi_overdue',
  amount: 10600,
  status: 'succeeded',
  failure_reason: null,
  metadata: { shipment_id: SHIP },
  ...overrides,
});

export type Recorder = {
  calls: string[];
  refundRequests: { request: unknown; idempotencyKey: string }[];
  starts: Record<string, unknown>[];
  records: Record<string, unknown>[];
  fees: unknown[][];
  criticals: string[];
  logs: string[];
};

export function harness(overrides: Partial<RefundOverduePayoutDeps> = {}) {
  const rec: Recorder = {
    calls: [],
    refundRequests: [],
    starts: [],
    records: [],
    fees: [],
    criticals: [],
    logs: [],
  };
  const ok = (data: unknown) => ({ data, error: null });
  const deps: RefundOverduePayoutDeps = {
    getUserId: async (token) => (token === 'admin-token' ? ADMIN : null),
    isAdmin: async (userId) => userId === ADMIN,
    loadShipment: async () => {
      rec.calls.push('loadShipment');
      return shipmentRow();
    },
    loadStartedOperation: async () => {
      rec.calls.push('loadStartedOperation');
      return null;
    },
    loadOrder: async () => {
      rec.calls.push('loadOrder');
      return orderRow();
    },
    saveActualStripeFee: async (...args) => {
      rec.fees.push(args);
    },
    retrieveAccount: async () => {
      rec.calls.push('stripe:account');
      return {
        id: 'acct_rejected',
        requirements: { disabled_reason: 'rejected.fraud' },
      };
    },
    retrievePaymentIntent: async () => {
      rec.calls.push('stripe:paymentIntent');
      return paymentIntent();
    },
    claim: async () => {
      rec.calls.push('claim');
      return ok({
        status: 'claimed',
        operation_key: KEY,
        claim_token: 'token-1',
        source: 'admin_overdue_payout',
        actor_id: ADMIN,
        reason: REASON,
      });
    },
    start: async (input) => {
      rec.calls.push('start');
      rec.starts.push(input as unknown as Record<string, unknown>);
      return ok({
        operation_key: KEY,
        refund_request: input.refundRequest,
        cancellation_loss_cents: input.cancellationLossCents,
      });
    },
    createRefund: async (request, options) => {
      rec.calls.push('stripe:refund');
      rec.refundRequests.push({
        request,
        idempotencyKey: options.idempotencyKey,
      });
      return stripeRefund();
    },
    recordRefund: async (input) => {
      rec.calls.push('record');
      rec.records.push(input as unknown as Record<string, unknown>);
      return ok({
        refund_id: input.refundId,
        refund_status: input.status,
        changed: true,
      });
    },
    listRefunds: async () => {
      rec.calls.push('stripe:listRefunds');
      return [];
    },
    retrieveRefund: async () => {
      rec.calls.push('stripe:retrieveRefund');
      return stripeRefund();
    },
    escalate: async () => {
      rec.calls.push('escalate');
      return ok({ escalated: true });
    },
    leaseReplay: async () => {
      rec.calls.push('lease');
      return ok({ status: 'leased', lease_expires_at: STARTED });
    },
    complete: async () => {
      rec.calls.push('complete');
      return ok({
        shipment_id: SHIP,
        order_id: ORDER,
        shipment_status: 'refunded',
        refund_id: 're_overdue',
        refund_amount_cents: 10600,
        cancellation_loss_cents: 390,
        label_cost_loss_cents: 0,
      });
    },
    reportCritical: (message) => {
      rec.criticals.push(message);
    },
    log: (_level, msg, data) => {
      rec.logs.push([msg, ...Object.values(data ?? {}).map(String)].join(' '));
    },
    now: () => Date.parse(STARTED) + 60_000,
    ...overrides,
  };
  const handler = createRefundOverduePayoutHandler(deps);
  const call = async (
    body: unknown = { shipment_id: SHIP },
    init: { method?: string; token?: string | null } = {},
  ) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = init.token === undefined ? 'admin-token' : init.token;
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    const response = await handler(
      new Request('http://localhost/refund-overdue-payout', {
        method: init.method ?? 'POST',
        headers,
        body: init.method === 'GET' ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  return { rec, call };
}

export const stripeCalls = (rec: Recorder) =>
  rec.calls.filter((c) => c.startsWith('stripe:'));
export const writes = (rec: Recorder) =>
  rec.calls.filter((c) =>
    ['claim', 'start', 'record', 'complete', 'escalate', 'lease'].includes(c),
  );
