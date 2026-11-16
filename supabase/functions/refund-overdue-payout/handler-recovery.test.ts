import { describe, expect, test } from 'bun:test';

import { REFUND_REPLAY_WINDOW_MS } from '../_shared/cancellation/shipment-cancellation.ts';
import type { RefundOverduePayoutDeps } from './handler.ts';
import {
  SHIP,
  OTHER_SHIP,
  KEY,
  STARTED,
  shipmentRow,
  frozenRequest,
  startedOperation,
  stripeRefund,
  harness,
  stripeCalls,
  writes,
} from './handler.test-support.ts';

describe('refund-overdue-payout: recovery of a started refund', () => {
  const recovering = (
    operation: Record<string, unknown>,
    extra: Partial<RefundOverduePayoutDeps> = {},
  ) =>
    harness({
      loadStartedOperation: async () => operation,
      claim: async () => ({
        data: { status: 'recovery_required', operation_key: KEY },
        error: null,
      }),
      retrieveAccount: async () => {
        throw new Error('recovery must not depend on the account');
      },
      retrievePaymentIntent: async () => {
        throw new Error('recovery must not read the charge');
      },
      ...extra,
    });

  test('skips the eligibility checks and completes a recorded succeeded refund without a new one', async () => {
    const { rec, call } = recovering(
      startedOperation({ refund_id: 're_overdue', refund_status: 'succeeded' }),
      {
        loadShipment: async () =>
          shipmentRow({
            is_payout_overdue: false,
            stripe_onboarding_status: 'complete',
          }),
      },
    );
    expect(await call()).toEqual({
      status: 200,
      body: {
        status: 'refunded',
        shipment_id: SHIP,
        refund_id: 're_overdue',
        amount_cents: 10600,
      },
    });
    expect(rec.refundRequests).toEqual([]);
    expect(stripeCalls(rec)).toEqual([]);
  });

  test('retrieves a recorded pending refund and completes it once Stripe reports succeeded', async () => {
    const { rec, call } = recovering(
      startedOperation({ refund_id: 're_overdue', refund_status: 'pending' }),
    );
    expect((await call()).status).toBe(200);
    expect(stripeCalls(rec)).toEqual(['stripe:retrieveRefund']);
    expect(rec.refundRequests).toEqual([]);
  });

  test('finds the refund at Stripe by shipment metadata and records it', async () => {
    const { rec, call } = recovering(startedOperation(), {
      listRefunds: async () => {
        rec.calls.push('stripe:listRefunds');
        return [
          stripeRefund({
            id: 're_sibling',
            metadata: { shipment_id: OTHER_SHIP },
          }),
          stripeRefund(),
        ];
      },
    });
    expect((await call()).status).toBe(200);
    expect(rec.refundRequests).toEqual([]);
    expect(rec.records.map((r) => r.refundId)).toEqual(['re_overdue']);
  });

  test('within the replay window it replays the frozen request with the same idempotency key', async () => {
    const { rec, call } = recovering(startedOperation());
    expect((await call()).status).toBe(200);
    expect(rec.refundRequests).toEqual([
      { request: frozenRequest(), idempotencyKey: KEY },
    ]);
  });

  test('past the window with no refund it escalates once and answers 409 REFUND_RECOVERY_REQUIRED', async () => {
    const { rec, call } = recovering(startedOperation(), {
      now: () => Date.parse(STARTED) + REFUND_REPLAY_WINDOW_MS + 1,
    });
    expect(await call()).toEqual({
      status: 409,
      body: { error: 'REFUND_RECOVERY_REQUIRED' },
    });
    expect(rec.refundRequests).toEqual([]);
    expect(writes(rec)).toEqual(['escalate']);
    expect(rec.criticals).toEqual(['CANCELLATION_REFUND_NOT_FOUND']);
  });

  test('an escalated operation with no refund at Stripe is resolved by retrying: same request and key', async () => {
    const { rec, call } = recovering(
      startedOperation({ recovery_escalated_at: '2026-11-11T00:00:00.000Z' }),
      { now: () => Date.parse(STARTED) + 3 * REFUND_REPLAY_WINDOW_MS },
    );
    expect((await call()).status).toBe(200);
    expect(rec.refundRequests).toEqual([
      { request: frozenRequest(), idempotencyKey: KEY },
    ]);
  });

  test('a recorded failed refund answers 409 REFUND_FAILED and calls nothing at Stripe', async () => {
    const { rec, call } = recovering(
      startedOperation({ refund_id: 're_overdue', refund_status: 'failed' }),
    );
    expect(await call()).toEqual({
      status: 409,
      body: { error: 'REFUND_FAILED' },
    });
    expect(stripeCalls(rec)).toEqual([]);
    expect(writes(rec)).toEqual([]);
  });
});
