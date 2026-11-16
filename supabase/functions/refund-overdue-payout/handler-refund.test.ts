import { describe, expect, test } from 'bun:test';

import {
  SHIP,
  OTHER_SHIP,
  ORDER,
  KEY,
  orderRow,
  paymentIntent,
  frozenRequest,
  stripeRefund,
  harness,
  writes,
} from './handler.test-support.ts';

describe('refund-overdue-payout: the refund', () => {
  test('200: an uppercase shipment id is read as the stored lowercase id and refunds only its own items', async () => {
    const { rec, call } = harness();
    expect(await call({ shipment_id: SHIP.toUpperCase() })).toEqual({
      status: 200,
      body: {
        status: 'refunded',
        shipment_id: SHIP,
        refund_id: 're_overdue',
        amount_cents: 10600,
      },
    });
    expect(writes(rec)).toEqual(['claim', 'start', 'record', 'complete']);
    expect(rec.refundRequests).toEqual([
      { request: frozenRequest(), idempotencyKey: KEY },
    ]);
    expect(rec.starts[0]?.cancellationLossCents).toBe(390);
  });

  test('200: amount computed on the server, Stripe refund before the record, then completion', async () => {
    const { rec, call } = harness();
    expect(await call({ shipment_id: SHIP, amount_cents: 1 })).toEqual({
      status: 200,
      body: {
        status: 'refunded',
        shipment_id: SHIP,
        refund_id: 're_overdue',
        amount_cents: 10600,
      },
    });
    expect(writes(rec)).toEqual(['claim', 'start', 'record', 'complete']);
    expect(rec.calls.indexOf('stripe:refund')).toBeGreaterThan(
      rec.calls.indexOf('start'),
    );
    expect(rec.calls.indexOf('stripe:refund')).toBeLessThan(
      rec.calls.indexOf('record'),
    );
    expect(rec.refundRequests).toEqual([
      { request: frozenRequest(), idempotencyKey: KEY },
    ]);
    // The fee loss is this shipment's share of the actual Stripe fee: 585 * 10600 / 15900 = 390.
    expect(rec.starts[0]?.cancellationLossCents).toBe(390);
    expect(rec.records).toEqual([
      {
        shipmentId: SHIP,
        refundId: 're_overdue',
        paymentIntentId: 'pi_overdue',
        amountCents: 10600,
        status: 'succeeded',
        failureReason: null,
      },
    ]);
  });

  test('the amount is capped by what the charge still has to refund', async () => {
    // Two 10000 shipments and 101 of Seguro: each share rounds to 51, one cent more than the
    // fee. The other shipment was refunded 10051 first, so 10050 is left and only that
    // rounding cent is forgiven.
    const { rec, call } = harness({
      loadOrder: async () =>
        orderRow({
          actual_stripe_fee_cents: 600,
          items: [
            {
              price_at_purchase_cents: 10000,
              shipping_amount_cents: 0,
              shipment_id: SHIP,
            },
            {
              price_at_purchase_cents: 10000,
              shipping_amount_cents: 0,
              shipment_id: OTHER_SHIP,
            },
          ],
        }),
      retrievePaymentIntent: async () =>
        paymentIntent({ amount: 20101, amount_refunded: 10051 }),
      createRefund: async (request, options) => {
        rec.refundRequests.push({
          request,
          idempotencyKey: options.idempotencyKey,
        });
        return stripeRefund({ amount: 10050 });
      },
      complete: async () => ({
        data: {
          shipment_status: 'refunded',
          refund_id: 're_overdue',
          refund_amount_cents: 10050,
        },
        error: null,
      }),
    });
    const result = await call();
    expect(result.status).toBe(200);
    expect(rec.refundRequests[0]?.request).toEqual(frozenRequest(10050, 50));
    expect(result.body.amount_cents).toBe(10050);
  });

  test('409 REFUND_AMOUNT_EXCEEDS_CAP when the charge cannot cover the shipment; no refund', async () => {
    const { rec, call } = harness({
      retrievePaymentIntent: async () =>
        paymentIntent({ amount_refunded: 9000 }),
    });
    expect(await call()).toEqual({
      status: 409,
      body: { error: 'REFUND_AMOUNT_EXCEEDS_CAP' },
    });
    expect(rec.refundRequests).toEqual([]);
    expect(rec.starts).toEqual([]);
  });

  test('without a reconciled fee it freezes the fee from the charge balance transaction and stores it', async () => {
    const { rec, call } = harness({
      loadOrder: async () => orderRow({ actual_stripe_fee_cents: null }),
    });
    expect((await call()).status).toBe(200);
    expect(rec.starts[0]?.cancellationLossCents).toBe(390);
    expect(rec.fees).toHaveLength(1);
    expect(rec.fees[0]?.slice(0, 2)).toEqual([ORDER, 585]);
  });

  test('202 pending: recorded, not completed; the refund.updated webhook completes it', async () => {
    const { rec, call } = harness({
      createRefund: async () => stripeRefund({ status: 'pending' }),
    });
    expect(await call()).toEqual({
      status: 202,
      body: {
        status: 'pending',
        shipment_id: SHIP,
        refund_id: 're_overdue',
        amount_cents: 10600,
      },
    });
    expect(writes(rec)).toEqual(['claim', 'start', 'record']);
  });

  test('a failed refund is recorded, never completed, and answers 409 REFUND_FAILED', async () => {
    const { rec, call } = harness({
      createRefund: async () =>
        stripeRefund({
          status: 'failed',
          failure_reason: 'expired_or_canceled_card',
        }),
    });
    expect(await call()).toEqual({
      status: 409,
      body: { error: 'REFUND_FAILED' },
    });
    expect(writes(rec)).toEqual(['claim', 'start', 'record']);
    expect(rec.records[0]?.failureReason).toBe('expired_or_canceled_card');
  });

  test('a Stripe error on the refund leaves the started operation for recovery', async () => {
    const { rec, call } = harness({
      createRefund: async () => {
        throw new Error('Stripe: idempotency_error raw');
      },
    });
    const result = await call();
    expect(result).toEqual({
      status: 502,
      body: { error: 'STRIPE_REQUEST_FAILED' },
    });
    expect(writes(rec)).toEqual(['claim', 'start']);
    expect(rec.logs.join('\n')).toContain('idempotency_error raw');
  });

  test('a Stripe error before the start leaves nothing started and the claim to expire', async () => {
    let lookups = 0;
    const { rec, call } = harness({
      retrievePaymentIntent: async () => {
        lookups += 1;
        if (lookups === 1) return paymentIntent();
        throw new Error('Stripe down');
      },
    });
    expect(await call()).toEqual({
      status: 502,
      body: { error: 'STRIPE_REQUEST_FAILED' },
    });
    expect(writes(rec)).toEqual(['claim']);
    expect(rec.refundRequests).toEqual([]);
  });

  test('a completion failure after a succeeded refund alerts and answers 500', async () => {
    const { rec, call } = harness({
      complete: async () => ({
        data: null,
        error: { message: 'deadlock detected' },
      }),
    });
    expect(await call()).toEqual({
      status: 500,
      body: { error: 'REFUND_COMPLETION_FAILED' },
    });
    expect(rec.criticals).toContain('OVERDUE_REFUND_COMPLETION_FAILED');
  });
});
