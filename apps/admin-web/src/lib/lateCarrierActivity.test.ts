import { describe, expect, it } from 'bun:test';
import {
  EVENT_TYPE_LABELS,
  normalizeAcknowledgementNote,
  parseAcknowledgement,
  parseLateCarrierActivity,
  REFUND_STATUS_LABELS,
  resolveLateCarrierActivityErrorMessage,
  SHIPMENT_STATUS_LABELS,
} from './lateCarrierActivity';

const row = {
  shipment_id: '11111111-aaaa-bbbb-cccc-000000000001',
  order_id: '22222222-aaaa-bbbb-cccc-000000000001',
  seller_id: '33333333-aaaa-bbbb-cccc-000000000001',
  tracking_number: 'TRK123',
  carrier: 'fedex',
  shipment_status: 'cancelled',
  source: 'preparing_timeout',
  refund_status: 'succeeded',
  late_carrier_activity_at: '2026-10-22T10:00:00.000Z',
  late_carrier_activity_event_type: 'delivered',
};
const mapped = {
  shipmentId: row.shipment_id,
  orderId: row.order_id,
  sellerId: row.seller_id,
  trackingNumber: 'TRK123',
  carrier: 'fedex',
  shipmentStatus: 'cancelled',
  source: 'preparing_timeout',
  refundStatus: 'succeeded',
  activityAt: '2026-10-22T10:00:00.000Z',
  eventType: 'delivered',
};

describe('parseLateCarrierActivity', () => {
  it('maps the server contract, including null optional fields', () => {
    const sparse = { ...row, tracking_number: null, carrier: null, refund_status: null };
    expect(parseLateCarrierActivity({ late_carrier_activity: [row, sparse] })).toEqual([
      mapped,
      { ...mapped, trackingNumber: null, carrier: null, refundStatus: null },
    ]);
    expect(parseLateCarrierActivity({ late_carrier_activity: [] })).toEqual([]);
  });

  const malformed: Array<[string, unknown]> = [
    ['null payload', null],
    ['missing key', {}],
    ['not an array', { late_carrier_activity: 'x' }],
    ['a non-object row', { late_carrier_activity: [row, 'x'] }],
    ['unknown event type', { late_carrier_activity: [{ ...row, late_carrier_activity_event_type: 'other' }] }],
    ['null event type', { late_carrier_activity: [{ ...row, late_carrier_activity_event_type: null }] }],
    ['unknown shipment status', { late_carrier_activity: [{ ...row, shipment_status: 'other' }] }],
    ['unknown source', { late_carrier_activity: [{ ...row, source: 'other' }] }],
    ['unknown refund status', { late_carrier_activity: [{ ...row, refund_status: 'other' }] }],
    ['missing shipment id', { late_carrier_activity: [{ ...row, shipment_id: '' }] }],
    ['undefined tracking number', { late_carrier_activity: [{ ...row, tracking_number: undefined }] }],
    ['invalid date', { late_carrier_activity: [{ ...row, late_carrier_activity_at: 'not a date' }] }],
    ['null date', { late_carrier_activity: [{ ...row, late_carrier_activity_at: null }] }],
  ];
  for (const [name, payload] of malformed) {
    it(`fails the whole response on ${name}`, () => {
      expect(() => parseLateCarrierActivity(payload)).toThrow();
    });
  }
});

describe('parseAcknowledgement', () => {
  const ok = {
    acknowledged_at: '2026-10-22T12:00:00.000Z',
    acknowledged_by: 'admin-1',
    acknowledged_note: 'ok',
    already_acknowledged: false,
  };

  it('maps the server contract', () => {
    expect(parseAcknowledgement(ok)).toEqual({
      acknowledgedAt: '2026-10-22T12:00:00.000Z',
      note: 'ok',
      alreadyAcknowledged: false,
    });
    expect(parseAcknowledgement({ ...ok, already_acknowledged: true }).alreadyAcknowledged).toBe(true);
  });

  it('rejects an unusable result', () => {
    for (const payload of [null, 'x', { ...ok, acknowledged_at: 'nope' }, { ...ok, acknowledged_note: 5 }, { ...ok, already_acknowledged: 'yes' }]) {
      expect(() => parseAcknowledgement(payload)).toThrow();
    }
  });
});

describe('normalizeAcknowledgementNote', () => {
  it('trims and accepts 1 to 200 characters', () => {
    expect(normalizeAcknowledgementNote('  revisado  ')).toBe('revisado');
    expect(normalizeAcknowledgementNote('x'.repeat(200))).toBe('x'.repeat(200));
    expect(normalizeAcknowledgementNote(`  ${'x'.repeat(200)}  `)).toBe('x'.repeat(200));
  });

  it('rejects blank and over-long notes', () => {
    expect(normalizeAcknowledgementNote('')).toBeNull();
    expect(normalizeAcknowledgementNote('   ')).toBeNull();
    expect(normalizeAcknowledgementNote('x'.repeat(201))).toBeNull();
  });
});

describe('labels', () => {
  it('has a Spanish label for every carrier event type, shipment status and refund state', () => {
    expect(EVENT_TYPE_LABELS.delivered).toBe('Entregado');
    expect(Object.keys(EVENT_TYPE_LABELS).sort()).toEqual(
      ['created', 'delivered', 'exception', 'in_transit', 'information', 'returned'],
    );
    expect(SHIPMENT_STATUS_LABELS.cancelled).toBe('Cancelado');
    expect(Object.keys(SHIPMENT_STATUS_LABELS)).toHaveLength(9);
    expect(Object.keys(REFUND_STATUS_LABELS).sort()).toEqual(
      ['canceled', 'failed', 'pending', 'requires_action', 'succeeded'],
    );
  });
});

describe('resolveLateCarrierActivityErrorMessage', () => {
  it('maps each stable server code and falls back to a generic message', () => {
    const codes = ['AUTH_REQUIRED', 'ADMIN_ONLY', 'SHIPMENT_NOT_FOUND', 'LATE_CARRIER_ACTIVITY_NOT_FOUND', 'INVALID_ACKNOWLEDGEMENT_NOTE', 'INVALID_SHIPMENT_ID'];
    const messages = codes.map((code) => resolveLateCarrierActivityErrorMessage(code));
    expect(new Set(messages).size).toBe(codes.length);
    const generic = resolveLateCarrierActivityErrorMessage(null);
    expect(resolveLateCarrierActivityErrorMessage('INTERNAL_ERROR')).toBe(generic);
    expect(messages).not.toContain(generic);
    expect(resolveLateCarrierActivityErrorMessage('INVALID_ACKNOWLEDGEMENT_NOTE')).toContain('200');
  });
});
