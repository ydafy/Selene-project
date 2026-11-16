import { describe, expect, test } from 'bun:test';

import { REFUND_REPLAY_WINDOW_MS } from '../_shared/cancellation/shipment-cancellation.ts';
import type { RefundOverduePayoutDeps } from './handler.ts';
import {
  SHIP,
  OTHER_SHIP,
  KEY,
  STARTED,
  shipmentRow,
  paymentIntent,
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
    expect(writes(rec)).toEqual(['lease', 'record', 'complete']);
    expect(rec.criticals).toEqual(['OVERDUE_REFUND_REPLAY_PAST_WINDOW']);
  });

  test('an escalated retry whose replay lease another retry holds answers 409 REFUND_IN_PROGRESS without a refund', async () => {
    const leased: string[] = [];
    const { rec, call } = recovering(
      startedOperation({ recovery_escalated_at: '2026-11-11T00:00:00.000Z' }),
      {
        now: () => Date.parse(STARTED) + 3 * REFUND_REPLAY_WINDOW_MS,
        leaseReplay: async (shipmentId) => {
          leased.push(shipmentId);
          return { data: { status: 'busy' }, error: null };
        },
      },
    );
    expect(await call()).toEqual({
      status: 409,
      body: { error: 'REFUND_IN_PROGRESS' },
    });
    expect(leased).toEqual([SHIP]);
    expect(rec.refundRequests).toEqual([]);
    expect(rec.records).toEqual([]);
  });

  test('a replay lease the database refuses answers 500 REFUND_REPLAY_LEASE_FAILED without a refund; the raw text stays in the log', async () => {
    const { rec, call } = recovering(
      startedOperation({ recovery_escalated_at: '2026-11-11T00:00:00.000Z' }),
      {
        now: () => Date.parse(STARTED) + 3 * REFUND_REPLAY_WINDOW_MS,
        leaseReplay: async () => ({
          data: null,
          error: { message: 'OVERDUE_REFUND_NOT_ESCALATED detail' },
        }),
      },
    );
    expect(await call()).toEqual({
      status: 500,
      body: { error: 'REFUND_REPLAY_LEASE_FAILED' },
    });
    expect(rec.refundRequests).toEqual([]);
    expect(rec.logs.join('\n')).toContain(
      'OVERDUE_REFUND_NOT_ESCALATED detail',
    );
  });

  // The recovery read saw a started refund, but the claim granted a new one (the two reads
  // disagree): prepare must not depend on the skipped eligibility checks.
  describe('a new claim after the recovery read saw a started refund', () => {
    const disagreeing = (extra: Partial<RefundOverduePayoutDeps> = {}) =>
      harness({
        loadStartedOperation: async () => startedOperation(),
        ...extra,
      });

    test('loads the order, checks the account live and refunds', async () => {
      const { rec, call } = disagreeing();
      expect(await call()).toEqual({
        status: 200,
        body: {
          status: 'refunded',
          shipment_id: SHIP,
          refund_id: 're_overdue',
          amount_cents: 10600,
        },
      });
      expect(rec.calls).toContain('loadOrder');
      expect(stripeCalls(rec)).toContain('stripe:account');
      expect(rec.refundRequests).toEqual([
        { request: frozenRequest(), idempotencyKey: KEY },
      ]);
    });

    test('a transient Stripe error reading the charge answers 502, and the retry refunds', async () => {
      let reads = 0;
      const { rec, call } = disagreeing({
        retrievePaymentIntent: async () => {
          reads += 1;
          if (reads === 1) throw new Error('stripe connection reset');
          return paymentIntent();
        },
      });
      expect(await call()).toEqual({
        status: 502,
        body: { error: 'STRIPE_REQUEST_FAILED' },
      });
      expect(rec.refundRequests).toEqual([]);
      expect((await call()).status).toBe(200);
      expect(rec.refundRequests).toHaveLength(1);
    });

    test('refuses with 409 SELLER_ACCOUNT_NOT_REJECTED when Stripe no longer rejects the account: nothing started', async () => {
      const { rec, call } = disagreeing({
        retrieveAccount: async () => ({
          id: 'acct_rejected',
          requirements: { disabled_reason: null },
        }),
      });
      expect(await call()).toEqual({
        status: 409,
        body: { error: 'SELLER_ACCOUNT_NOT_REJECTED' },
      });
      expect(writes(rec)).toEqual(['claim']);
      expect(rec.refundRequests).toEqual([]);
    });
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
