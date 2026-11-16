import { describe, expect, test } from 'bun:test';

import type { OverdueShipment } from './handler.ts';
import {
  SHIP,
  KEY,
  shipmentRow,
  paymentIntent,
  harness,
  stripeCalls,
  writes,
} from './handler.test-support.ts';

describe('refund-overdue-payout: refusals before any money movement', () => {
  test('405 for a method other than POST', async () => {
    const { rec, call } = harness();
    expect(await call(undefined, { method: 'GET' })).toEqual({
      status: 405,
      body: { error: 'METHOD_NOT_ALLOWED' },
    });
    expect(rec.calls).toEqual([]);
  });

  test('401 AUTH_REQUIRED without a token or with a token that is not a user', async () => {
    for (const token of [null, 'not-a-user']) {
      const { rec, call } = harness();
      expect(await call({ shipment_id: SHIP }, { token })).toEqual({
        status: 401,
        body: { error: 'AUTH_REQUIRED' },
      });
      expect(rec.calls).toEqual([]);
    }
  });

  test('403 ADMIN_ONLY for a user who is not an active admin', async () => {
    const { rec, call } = harness({ isAdmin: async () => false });
    expect(await call()).toEqual({
      status: 403,
      body: { error: 'ADMIN_ONLY' },
    });
    expect(rec.calls).toEqual([]);
  });

  test('422 INVALID_SHIPMENT_ID for a missing or malformed id; an amount in the body is never read', async () => {
    for (const body of [{}, { shipment_id: 'nope' }, null, [SHIP]]) {
      const { rec, call } = harness();
      expect(await call(body)).toEqual({
        status: 422,
        body: { error: 'INVALID_SHIPMENT_ID' },
      });
      expect(rec.calls).toEqual([]);
    }
  });

  test('404 SHIPMENT_NOT_FOUND when the shipment does not exist', async () => {
    const { rec, call } = harness({ loadShipment: async () => null });
    expect(await call()).toEqual({
      status: 404,
      body: { error: 'SHIPMENT_NOT_FOUND' },
    });
    expect(stripeCalls(rec)).toEqual([]);
    expect(writes(rec)).toEqual([]);
  });

  const storedRefusals: [string, Partial<OverdueShipment>, string][] = [
    ['not completed', { status: 'delivered' }, 'SHIPMENT_NOT_COMPLETED'],
    ['not overdue', { is_payout_overdue: false }, 'PAYOUT_NOT_OVERDUE'],
    [
      'seller not rejected in the database',
      { stripe_onboarding_status: 'pending' },
      'SELLER_ACCOUNT_NOT_REJECTED',
    ],
    [
      'seller without a Stripe account',
      { stripe_account_id: null },
      'SELLER_ACCOUNT_NOT_REJECTED',
    ],
  ];
  for (const [label, row, code] of storedRefusals) {
    test(`409 ${code} when ${label}: Stripe never called, nothing stored`, async () => {
      const { rec, call } = harness({
        loadShipment: async () => {
          rec.calls.push('loadShipment');
          return shipmentRow(row);
        },
      });
      expect(await call()).toEqual({ status: 409, body: { error: code } });
      expect(stripeCalls(rec)).toEqual([]);
      expect(writes(rec)).toEqual([]);
    });
  }

  for (const disabledReason of [
    null,
    'requirements.past_due',
    'under_review',
    'platform_paused',
    'rejected',
  ]) {
    test(`409 SELLER_ACCOUNT_NOT_REJECTED when Stripe reports disabled_reason ${String(disabledReason)}`, async () => {
      const { rec, call } = harness({
        retrieveAccount: async () => {
          rec.calls.push('stripe:account');
          return {
            id: 'acct_rejected',
            requirements: { disabled_reason: disabledReason },
          };
        },
      });
      expect(await call()).toEqual({
        status: 409,
        body: { error: 'SELLER_ACCOUNT_NOT_REJECTED' },
      });
      expect(stripeCalls(rec)).toEqual(['stripe:account']);
      expect(writes(rec)).toEqual([]);
    });
  }

  for (const disabledReason of [
    'rejected.fraud',
    'rejected.terms_of_service',
    'rejected.other',
  ]) {
    test(`accepts the live Stripe reason ${disabledReason}`, async () => {
      const { call } = harness({
        retrieveAccount: async () => ({
          requirements: { disabled_reason: disabledReason },
        }),
      });
      expect((await call()).status).toBe(200);
    });
  }

  test('502 STRIPE_REQUEST_FAILED when the account lookup fails; the Stripe text stays in the log', async () => {
    const { rec, call } = harness({
      retrieveAccount: async () => {
        throw new Error('No such account: acct_secret_detail');
      },
    });
    const result = await call();
    expect(result).toEqual({
      status: 502,
      body: { error: 'STRIPE_REQUEST_FAILED' },
    });
    expect(JSON.stringify(result.body)).not.toContain('acct_secret_detail');
    expect(rec.logs.join('\n')).toContain('acct_secret_detail');
    expect(writes(rec)).toEqual([]);
  });

  for (const type of ['oxxo', 'customer_balance', 'link']) {
    test(`409 PAYMENT_METHOD_NOT_REFUNDABLE for a ${type} charge: nothing claimed, no refund`, async () => {
      const { rec, call } = harness({
        retrievePaymentIntent: async () => {
          rec.calls.push('stripe:paymentIntent');
          return paymentIntent({ payment_method_details: { type } });
        },
      });
      expect(await call()).toEqual({
        status: 409,
        body: { error: 'PAYMENT_METHOD_NOT_REFUNDABLE' },
      });
      expect(stripeCalls(rec)).toEqual([
        'stripe:account',
        'stripe:paymentIntent',
      ]);
      expect(writes(rec)).toEqual([]);
    });
  }

  const claimRefusals: [string, number, string][] = [
    ['ADMIN_REQUIRED', 403, 'ADMIN_ONLY'],
    ['SHIPMENT_NOT_FOUND', 404, 'SHIPMENT_NOT_FOUND'],
    ['SHIPMENT_NOT_COMPLETED', 409, 'SHIPMENT_NOT_COMPLETED'],
    ['SHIPMENT_FUNDS_ALREADY_RELEASED', 409, 'SHIPMENT_FUNDS_ALREADY_RELEASED'],
    [
      'SHIPMENT_TRANSFER_OPERATION_ACTIVE',
      409,
      'SHIPMENT_TRANSFER_OPERATION_ACTIVE',
    ],
    ['PAYOUT_NOT_OVERDUE', 409, 'PAYOUT_NOT_OVERDUE'],
    ['SELLER_ACCOUNT_NOT_REJECTED', 409, 'SELLER_ACCOUNT_NOT_REJECTED'],
    ['PAYOUT_RUN_NOT_PARKED', 409, 'PAYOUT_RUN_NOT_PARKED'],
    [
      'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
      409,
      'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
    ],
    ['SHIPMENT_ALREADY_REFUNDED', 409, 'SHIPMENT_ALREADY_REFUNDED'],
    ['some unexpected relation "x" does not exist', 500, 'INTERNAL_ERROR'],
  ];
  for (const [sql, status, code] of claimRefusals) {
    test(`claim error ${sql} answers ${status} ${code}; no refund, raw text only in the log`, async () => {
      const { rec, call } = harness({
        claim: async () => {
          rec.calls.push('claim');
          return { data: null, error: { message: sql } };
        },
      });
      expect(await call()).toEqual({ status, body: { error: code } });
      expect(rec.refundRequests).toEqual([]);
      expect(writes(rec)).toEqual(['claim']);
      expect(rec.logs.join('\n')).toContain(sql);
    });
  }

  test('a busy claim answers 409 REFUND_IN_PROGRESS without a refund', async () => {
    const { rec, call } = harness({
      claim: async () => ({
        data: { status: 'busy', operation_key: KEY },
        error: null,
      }),
    });
    expect(await call()).toEqual({
      status: 409,
      body: { error: 'REFUND_IN_PROGRESS' },
    });
    expect(rec.refundRequests).toEqual([]);
    expect(rec.starts).toEqual([]);
  });

  test('a start refused by the database never reaches Stripe', async () => {
    const { rec, call } = harness({
      start: async () => ({
        data: null,
        error: { message: 'SELLER_ACCOUNT_NOT_REJECTED' },
      }),
    });
    expect(await call()).toEqual({
      status: 409,
      body: { error: 'SELLER_ACCOUNT_NOT_REJECTED' },
    });
    expect(rec.refundRequests).toEqual([]);
  });
});
