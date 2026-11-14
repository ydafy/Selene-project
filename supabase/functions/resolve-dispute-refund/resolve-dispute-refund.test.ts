import { describe, expect, test } from 'bun:test';
import {
  disputeRefundAmountCents,
  extractRefundId,
  refundBlockedReason,
  refundIntentBlockedReason,
} from './resolve-dispute-refund';

describe('refundIntentBlockedReason', () => {
  test('a shipment with a payment intent is refundable', () => {
    expect(refundIntentBlockedReason('pi_123')).toBeNull();
  });

  test('a missing shipment or a shipment without a payment intent is refused', () => {
    expect(refundIntentBlockedReason(undefined)).toBe(
      'SHIPMENT_WITHOUT_PAYMENT_INTENT',
    );
    expect(refundIntentBlockedReason(null)).toBe(
      'SHIPMENT_WITHOUT_PAYMENT_INTENT',
    );
    expect(refundIntentBlockedReason('')).toBe(
      'SHIPMENT_WITHOUT_PAYMENT_INTENT',
    );
  });
});

describe('refundBlockedReason', () => {
  test('shipped and delivered shipments are refundable', () => {
    expect(refundBlockedReason('shipped')).toBeNull();
    expect(refundBlockedReason('delivered')).toBeNull();
  });

  test.each(['completed', 'refunded', 'cancelled', 'pending'])(
    'a %s shipment is refused with its status',
    (status) => {
      expect(refundBlockedReason(status)).toBe(
        `SHIPMENT_NOT_REFUNDABLE:${status}`,
      );
    },
  );

  test('a missing shipment is refused', () => {
    expect(refundBlockedReason(null)).toBe('SHIPMENT_NOT_REFUNDABLE:unknown');
    expect(refundBlockedReason(undefined)).toBe(
      'SHIPMENT_NOT_REFUNDABLE:unknown',
    );
  });
});

describe('disputeRefundAmountCents', () => {
  test('adds the item prices and shipping amounts in cents', () => {
    expect(
      disputeRefundAmountCents([
        { price_at_purchase_cents: 325_000, shipping_amount_cents: 90_000 },
        { price_at_purchase_cents: 29, shipping_amount_cents: null },
      ]),
    ).toBe(415_029);
  });

  test('keeps the amount the pesos columns produced for the same data', () => {
    // 7569.59 + 0.01 pesos rounded to cents was 756960.
    expect(
      disputeRefundAmountCents([
        { price_at_purchase_cents: 756_959, shipping_amount_cents: 1 },
      ]),
    ).toBe(756_960);
  });
});

describe('extractRefundId', () => {
  test('returns the id of a created refund', () => {
    expect(extractRefundId({ id: 're_123' })).toBe('re_123');
  });

  test('returns null when there is no refund', () => {
    expect(extractRefundId(null)).toBeNull();
    expect(extractRefundId({})).toBeNull();
  });
});
