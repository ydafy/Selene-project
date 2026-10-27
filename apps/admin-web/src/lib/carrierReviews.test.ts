import { describe, expect, it } from 'bun:test';
import {
  formatWaiting,
  normalizeReviewNote,
  parseCarrierReviews,
  parseResolveReviewResult,
  REVIEW_REASON_LABELS,
  resolveCarrierReviewErrorMessage,
} from './carrierReviews';

const review = {
  shipment_id: '11111111-aaaa-bbbb-cccc-000000000001',
  order_id: '22222222-aaaa-bbbb-cccc-000000000001',
  seller_id: '33333333-aaaa-bbbb-cccc-000000000001',
  tracking_number: 'TRK123',
  carrier: 'fedex',
  label_provider_cost_cents: 15000,
  review_reason: 'carrier_refused',
  carrier_cancellation_outcome: 'refused',
  review_required_at: '2026-10-22T10:00:00.000Z',
};
const mapped = {
  shipmentId: review.shipment_id,
  orderId: review.order_id,
  sellerId: review.seller_id,
  trackingNumber: 'TRK123',
  carrier: 'fedex',
  labelCostCents: 15000,
  reason: 'carrier_refused',
  carrierOutcome: 'refused',
  requiredAt: '2026-10-22T10:00:00.000Z',
};

describe('parseCarrierReviews', () => {
  it('maps the server contract, including null optional fields', () => {
    const unknown = {
      ...review,
      tracking_number: null,
      carrier: null,
      label_provider_cost_cents: null,
      review_reason: 'tracking_unknown',
      carrier_cancellation_outcome: null,
    };
    expect(parseCarrierReviews({ reviews: [review, unknown] })).toEqual([
      mapped,
      {
        ...mapped,
        trackingNumber: null,
        carrier: null,
        labelCostCents: null,
        reason: 'tracking_unknown',
        carrierOutcome: null,
      },
    ]);
    expect(parseCarrierReviews({ reviews: [] })).toEqual([]);
  });

  const malformed: Array<[string, unknown]> = [
    ['null payload', null],
    ['missing reviews', {}],
    ['reviews not an array', { reviews: 'x' }],
    ['a non-object row', { reviews: [review, 'x'] }],
    ['unknown reason', { reviews: [{ ...review, review_reason: 'other' }] }],
    ['float cost', { reviews: [{ ...review, label_provider_cost_cents: 150.5 }] }],
    ['negative cost', { reviews: [{ ...review, label_provider_cost_cents: -1 }] }],
    ['string cost', { reviews: [{ ...review, label_provider_cost_cents: '15000' }] }],
    ['missing shipment id', { reviews: [{ ...review, shipment_id: '' }] }],
    ['undefined tracking number', { reviews: [{ ...review, tracking_number: undefined }] }],
    ['invalid date', { reviews: [{ ...review, review_required_at: 'not a date' }] }],
  ];
  for (const [name, payload] of malformed) {
    it(`rejects the whole response for ${name}`, () => {
      expect(() => parseCarrierReviews(payload)).toThrow();
    });
  }
});

describe('parseResolveReviewResult', () => {
  const result = {
    review_resolution: 'closed_no_refund',
    review_resolved_at: '2026-10-22T12:00:00.000Z',
    review_resolved_by: 'admin-1',
    review_resolution_note: 'Paquete en tránsito',
    label_cost_loss_cents: null,
  };

  it('maps the server contract', () => {
    expect(parseResolveReviewResult(result)).toEqual({
      resolution: 'closed_no_refund',
      resolvedAt: '2026-10-22T12:00:00.000Z',
      note: 'Paquete en tránsito',
      labelCostLossCents: null,
    });
    expect(
      parseResolveReviewResult({ ...result, review_resolution: 'refund_approved', label_cost_loss_cents: 15000 }),
    ).toMatchObject({ resolution: 'refund_approved', labelCostLossCents: 15000 });
  });

  it('rejects malformed results', () => {
    expect(() => parseResolveReviewResult(null)).toThrow();
    expect(() => parseResolveReviewResult({ ...result, review_resolution: 'other' })).toThrow();
    expect(() => parseResolveReviewResult({ ...result, review_resolution_note: 1 })).toThrow();
    expect(() => parseResolveReviewResult({ ...result, label_cost_loss_cents: 1.5 })).toThrow();
  });
});

describe('normalizeReviewNote', () => {
  it('trims and accepts 1 to 500 characters', () => {
    expect(normalizeReviewNote('  Paquete escaneado  ')).toBe('Paquete escaneado');
    expect(normalizeReviewNote('a'.repeat(500))).toHaveLength(500);
  });

  it('rejects empty, blank and over-limit notes', () => {
    expect(normalizeReviewNote('')).toBeNull();
    expect(normalizeReviewNote('   ')).toBeNull();
    expect(normalizeReviewNote('a'.repeat(501))).toBeNull();
    expect(normalizeReviewNote(`  ${'a'.repeat(500)}  `)).toHaveLength(500);
  });
});

describe('REVIEW_REASON_LABELS', () => {
  it('explains every reason in plain Spanish', () => {
    expect(REVIEW_REASON_LABELS).toEqual({
      tracking_unknown: 'No pudimos confirmar el tracking',
      carrier_refused: 'El carrier rechazó la cancelación',
      carrier_ambiguous: 'El carrier no dio una respuesta clara',
    });
  });
});

describe('resolveCarrierReviewErrorMessage', () => {
  it('maps every stable function code to its own Spanish message', () => {
    const codes = [
      'AUTH_REQUIRED',
      'ADMIN_ONLY',
      'SHIPMENT_NOT_FOUND',
      'CARRIER_REVIEW_NOT_PENDING',
      'CARRIER_REVIEW_ALREADY_RESOLVED',
      'CANCELLATION_EXTERNAL_ALREADY_STARTED',
      'SHIPMENT_NOT_CANCELABLE',
      'INVALID_REVIEW_NOTE',
      'INVALID_REVIEW_RESOLUTION',
      'INVALID_SHIPMENT_ID',
    ];
    const generic = resolveCarrierReviewErrorMessage(null);
    for (const code of codes) {
      expect(resolveCarrierReviewErrorMessage(code)).not.toBe(generic);
    }
    expect(resolveCarrierReviewErrorMessage('INVALID_REVIEW_NOTE')).toContain('500');
  });

  it('falls back to a generic message for unknown codes', () => {
    expect(resolveCarrierReviewErrorMessage('INTERNAL_ERROR')).toBe(resolveCarrierReviewErrorMessage(null));
    expect(resolveCarrierReviewErrorMessage('SOMETHING_ELSE')).toBe(resolveCarrierReviewErrorMessage(null));
  });
});

describe('formatWaiting', () => {
  const since = '2026-10-22T10:00:00.000Z';
  const at = (ms: number) => new Date(Date.parse(since) + ms).getTime();
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  it('formats minutes, hours and days', () => {
    expect(formatWaiting(since, at(30_000))).toBe('menos de 1 min');
    expect(formatWaiting(since, at(5 * MIN))).toBe('5 min');
    expect(formatWaiting(since, at(3 * HOUR + 20 * MIN))).toBe('3 h 20 min');
    expect(formatWaiting(since, at(2 * HOUR))).toBe('2 h');
    expect(formatWaiting(since, at(50 * HOUR))).toBe('2 d 2 h');
    expect(formatWaiting(since, at(48 * HOUR))).toBe('2 d');
  });

  it('never goes negative and tolerates a bad date', () => {
    expect(formatWaiting(since, at(-5 * MIN))).toBe('menos de 1 min');
    expect(formatWaiting('nope', at(0))).toBe('--');
  });
});
