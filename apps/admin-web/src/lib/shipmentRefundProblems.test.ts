import { describe, expect, it } from 'bun:test';
import {
  normalizeResolutionReference,
  parseRefundProblems,
  parseResolveResult,
  resolveRefundErrorMessage,
} from './shipmentRefundProblems';

const problem = {
  shipmentId: 'ship-1',
  orderId: 'order-1',
  buyerId: 'buyer-1',
  shipmentStatus: 'paid',
  kind: 'refund_failed',
  refundId: 're_123',
  refundFailureReason: 'expired_or_canceled_card',
  amountOwedCents: 11000,
  paymentIntentId: 'pi_123',
  since: '2026-10-22T10:00:00.000Z',
};

describe('parseRefundProblems', () => {
  it('accepts the server contract, including null refund fields', () => {
    const escalated = { ...problem, kind: 'refund_not_found', refundId: null, refundFailureReason: null };
    expect(parseRefundProblems({ problems: [problem, escalated] })).toEqual([problem, escalated]);
    expect(parseRefundProblems({ problems: [] })).toEqual([]);
  });

  const malformed: Array<[string, unknown]> = [
    ['null payload', null],
    ['missing problems', {}],
    ['problems not an array', { problems: 'x' }],
    ['a non-object row', { problems: [problem, 'x'] }],
    ['unknown kind', { problems: [{ ...problem, kind: 'other' }] }],
    ['float amount', { problems: [{ ...problem, amountOwedCents: 110.5 }] }],
    ['string amount', { problems: [{ ...problem, amountOwedCents: '11000' }] }],
    ['zero amount', { problems: [{ ...problem, amountOwedCents: 0 }] }],
    ['missing shipment id', { problems: [{ ...problem, shipmentId: '' }] }],
    ['undefined refund id', { problems: [{ ...problem, refundId: undefined }] }],
    ['invalid date', { problems: [{ ...problem, since: 'not a date' }] }],
  ];
  for (const [name, payload] of malformed) {
    it(`rejects the whole response for ${name}`, () => {
      expect(() => parseRefundProblems(payload)).toThrow();
    });
  }
});

describe('normalizeResolutionReference', () => {
  it('trims and accepts 1 to 200 characters', () => {
    expect(normalizeResolutionReference('  SPEI-123  ')).toBe('SPEI-123');
    expect(normalizeResolutionReference('a'.repeat(200))).toBe('a'.repeat(200));
  });
  it('rejects empty, blank and over-long references', () => {
    expect(normalizeResolutionReference('')).toBeNull();
    expect(normalizeResolutionReference('   ')).toBeNull();
    expect(normalizeResolutionReference('a'.repeat(201))).toBeNull();
  });
});

describe('parseResolveResult', () => {
  it('accepts the server result', () => {
    const result = { resolved: false, shipment_cancelled: true, amount_owed_cents: 11000, reference: 'SPEI-1' };
    expect(parseResolveResult(result)).toEqual({
      resolved: false,
      shipmentCancelled: true,
      amountOwedCents: 11000,
      reference: 'SPEI-1',
    });
  });
  it('rejects a malformed result', () => {
    expect(() => parseResolveResult({ resolved: true })).toThrow();
    expect(() => parseResolveResult(null)).toThrow();
  });
});

describe('resolveRefundErrorMessage', () => {
  it('maps the stable server codes to readable messages', () => {
    for (const code of ['REFUND_NOT_RESOLVABLE', 'SHIPMENT_STATUS_UNEXPECTED', 'INVALID_RESOLUTION_REFERENCE', 'ADMIN_ONLY']) {
      const message = resolveRefundErrorMessage(code);
      expect(message).not.toContain(code);
      expect(message.length).toBeGreaterThan(10);
    }
    const messages = new Set(
      ['REFUND_NOT_RESOLVABLE', 'SHIPMENT_STATUS_UNEXPECTED', 'INVALID_RESOLUTION_REFERENCE', 'ADMIN_ONLY'].map(
        resolveRefundErrorMessage,
      ),
    );
    expect(messages.size).toBe(4);
  });
  it('uses one generic message for any other code', () => {
    expect(resolveRefundErrorMessage('INTERNAL_ERROR')).toBe(resolveRefundErrorMessage('SOMETHING_NEW'));
    expect(resolveRefundErrorMessage(null)).toBe(resolveRefundErrorMessage('SOMETHING_NEW'));
  });
});
