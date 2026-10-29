import { describe, expect, test } from 'bun:test';
import {
  extractRefundId,
  refundBlockedReason,
} from './resolve-dispute-refund';

describe('refundBlockedReason', () => {
  test('shipped and delivered shipments are refundable', () => {
    expect(refundBlockedReason('shipped')).toBeNull();
    expect(refundBlockedReason('delivered')).toBeNull();
  });

  test.each(['completed', 'refunded', 'cancelled', 'pending'])(
    'a %s shipment is refused with its status',
    (status) => {
      expect(refundBlockedReason(status)).toBe(`SHIPMENT_NOT_REFUNDABLE:${status}`);
    },
  );

  test('a missing shipment is refused', () => {
    expect(refundBlockedReason(null)).toBe('SHIPMENT_NOT_REFUNDABLE:unknown');
    expect(refundBlockedReason(undefined)).toBe(
      'SHIPMENT_NOT_REFUNDABLE:unknown',
    );
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
