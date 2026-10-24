import { describe, expect, test } from 'bun:test';
import { confirmPreparingCarrier } from './preparing-carrier-gate.ts';
import type {
  EnviaCancelOutcome,
  FreshTrackingAssessment,
} from './envia-carrier-cancellation.ts';

const shipment = {
  id: 'shipment-a',
  trackingNumber: 'TRK-1',
  carrier: 'estafeta',
};
const claimToken = 'claim-token';
const NOW = '2026-10-23T12:00:00.000Z';
const RUN_ID = '11111111-1111-4111-8111-111111111111';

const noReview = {
  carrier_cancellation_outcome: null,
  review_reason: null,
  review_required_at: null,
  review_resolution: null,
};
const scanned: FreshTrackingAssessment = {
  state: 'scanned',
  observations: [
    {
      trackingNumber: 'TRK-1',
      status: 'Picked up',
      eventAt: '2026-10-22T10:00:00.000Z',
      statusDescription: 'Picked up',
      location: 'CDMX',
      carrierName: 'Estafeta',
    },
  ],
};
const unscanned: FreshTrackingAssessment = {
  state: 'unscanned',
  observations: [{ trackingNumber: 'TRK-1', status: 'created' }],
};
const unknown: FreshTrackingAssessment = { state: 'unknown', observations: [] };
const accepted: EnviaCancelOutcome = {
  outcome: 'accepted',
  balanceReturned: true,
  balanceReturnedAt: '2026-10-23T11:00:00.000Z',
};

type ShipmentInput = {
  id: string;
  trackingNumber: string | null;
  carrier: string | null;
};

function harness(
  options: {
    stored?: unknown;
    tracking?: FreshTrackingAssessment[];
    cancel?: EnviaCancelOutcome;
    marked?: unknown;
    available?: boolean;
    recordEventError?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const events: Record<string, unknown>[] = [];
  const outcomes: unknown[] = [];
  const marks: unknown[][] = [];
  const cancels: unknown[] = [];
  const trackingReads: string[] = [];
  const criticals: { message: string; data: Record<string, unknown> }[] = [];
  const queue = [...(options.tracking ?? [])];
  const ports = {
    carrierAvailable: options.available ?? true,
    getStoredState: async (shipmentId: string) => {
      calls.push('stored');
      expect(shipmentId).toBe('shipment-a');
      return options.stored === undefined ? noReview : options.stored;
    },
    fetchFreshTracking: async (trackingNumber: string) => {
      calls.push('tracking');
      trackingReads.push(trackingNumber);
      const next = queue.shift();
      if (!next) throw new Error('unexpected tracking read');
      return next;
    },
    recordTrackingEvent: async (
      event: Record<string, unknown>,
      pollingRunId: string,
    ) => {
      calls.push('event');
      if (options.recordEventError) throw new Error('record failed');
      events.push({ ...event, pollingRunId });
    },
    cancelLabel: async (input: unknown) => {
      calls.push('cancel');
      cancels.push(input);
      if (!options.cancel) throw new Error('unexpected cancel');
      return options.cancel;
    },
    recordOutcome: async (...args: unknown[]) => {
      calls.push('outcome');
      outcomes.push(args);
    },
    markReview: async (...args: unknown[]) => {
      calls.push('mark');
      marks.push(args);
      return options.marked === undefined ? { marked: true } : options.marked;
    },
    reportCritical: async (message: string, data: Record<string, unknown>) => {
      calls.push('critical');
      criticals.push({ message, data });
    },
    now: () => NOW,
    newRunId: () => RUN_ID,
  };
  return {
    calls,
    events,
    outcomes,
    marks,
    cancels,
    trackingReads,
    criticals,
    run: (override: Partial<ShipmentInput> = {}) =>
      confirmPreparingCarrier({ ...shipment, ...override }, claimToken, ports),
  };
}

describe('preparing carrier gate (B4.4b, S3/S4/S8)', () => {
  test.each([
    [
      'an admin-approved refund',
      {
        ...noReview,
        review_resolution: 'refund_approved',
        review_reason: 'carrier_refused',
        review_required_at: NOW,
      },
    ],
    [
      'an accepted carrier cancellation',
      { ...noReview, carrier_cancellation_outcome: 'accepted' },
    ],
  ])('%s continues with no Envia call', async (_label, stored) => {
    const subject = harness({ stored });
    expect(await subject.run()).toEqual({ proceed: true });
    expect(subject.calls).toEqual(['stored']);
  });

  test('an accepted outcome with a review that is not approved stops and calls nothing', async () => {
    const subject = harness({
      stored: {
        ...noReview,
        carrier_cancellation_outcome: 'accepted',
        review_reason: 'tracking_unknown',
        review_required_at: NOW,
      },
    });
    expect(await subject.run()).toEqual({
      proceed: false,
      reason: 'under_review',
    });
    expect(subject.calls).toEqual(['stored']);
  });

  test('an unreadable stored state fails closed', async () => {
    const subject = harness({ stored: null });
    await expect(subject.run()).rejects.toThrow('CARRIER_STATE_INVALID');
    expect(subject.calls).toEqual(['stored']);
  });

  test('an unscanned label that the carrier accepts is recorded and the refund continues', async () => {
    const subject = harness({ tracking: [unscanned], cancel: accepted });
    expect(await subject.run()).toEqual({ proceed: true });
    expect(subject.calls).toEqual(['stored', 'tracking', 'cancel', 'outcome']);
    expect(subject.trackingReads).toEqual(['TRK-1']);
    expect(subject.cancels).toEqual([
      { carrier: 'estafeta', trackingNumber: 'TRK-1' },
    ]);
    expect(subject.outcomes).toEqual([
      [
        'shipment-a',
        claimToken,
        {
          outcome: 'accepted',
          balanceReturned: true,
          balanceReturnedAt: '2026-10-23T11:00:00.000Z',
        },
      ],
    ]);
    expect(subject.marks).toEqual([]);
  });

  test('scanned tracking records its events, calls no cancel and stops', async () => {
    const subject = harness({ tracking: [scanned] });
    expect(await subject.run()).toEqual({
      proceed: false,
      reason: 'tracking_advanced',
    });
    expect(subject.calls).toEqual(['stored', 'tracking', 'event']);
    expect(subject.events).toEqual([
      {
        targetId: 'shipment-a',
        trackingNumber: 'TRK-1',
        rawStatus: 'Picked up',
        eventType: 'in_transit',
        transition: 'shipped',
        eventAt: '2026-10-22T10:00:00.000Z',
        statusDescription: 'Picked up',
        location: 'CDMX',
        carrierName: 'Estafeta',
        pollingRunId: RUN_ID,
      },
    ]);
    expect(subject.marks).toEqual([]);
    expect(subject.criticals).toEqual([]);
  });

  test('a failed event write stops the run with the error and no cancel', async () => {
    const subject = harness({ tracking: [scanned], recordEventError: true });
    await expect(subject.run()).rejects.toThrow('record failed');
    expect(subject.calls).toEqual(['stored', 'tracking', 'event']);
  });

  test('unknown tracking marks tracking_unknown, alerts once and never cancels', async () => {
    const subject = harness({ tracking: [unknown] });
    expect(await subject.run()).toEqual({
      proceed: false,
      reason: 'tracking_unknown',
    });
    expect(subject.calls).toEqual(['stored', 'tracking', 'mark', 'critical']);
    expect(subject.marks).toEqual([
      ['shipment-a', claimToken, 'tracking_unknown'],
    ]);
    expect(subject.criticals).toHaveLength(1);
    expect(subject.criticals[0]!.data).toEqual({
      shipmentId: 'shipment-a',
      reason: 'tracking_unknown',
    });
  });

  test('a repeated mark ({ marked: false }) does not alert again', async () => {
    const subject = harness({ tracking: [unknown], marked: { marked: false } });
    expect(await subject.run()).toEqual({
      proceed: false,
      reason: 'tracking_unknown',
    });
    expect(subject.calls).toEqual(['stored', 'tracking', 'mark']);
    expect(subject.criticals).toEqual([]);
  });

  test.each([null, {}, { marked: 'yes' }, 'invalid'])(
    'an invalid mark answer %p fails closed',
    async (marked) => {
      const subject = harness({ tracking: [unknown], marked });
      await expect(subject.run()).rejects.toThrow('CARRIER_REVIEW_MARK_INVALID');
      expect(subject.criticals).toEqual([]);
    },
  );

  test('a refusal followed by scanned tracking records the events and stops without review', async () => {
    const subject = harness({
      tracking: [unscanned, scanned],
      cancel: { outcome: 'refused', errorCode: '1234' },
    });
    expect(await subject.run()).toEqual({
      proceed: false,
      reason: 'tracking_advanced',
    });
    expect(subject.calls).toEqual([
      'stored',
      'tracking',
      'cancel',
      'tracking',
      'event',
    ]);
    expect(subject.marks).toEqual([]);
    expect(subject.outcomes).toEqual([]);
    expect(subject.criticals).toEqual([]);
  });

  test.each([
    ['unscanned', unscanned],
    ['unknown', unknown],
  ])('a refusal with %s tracking marks carrier_refused and alerts once', async (_label, second) => {
    const subject = harness({
      tracking: [unscanned, second],
      cancel: { outcome: 'refused', errorCode: null },
    });
    expect(await subject.run()).toEqual({
      proceed: false,
      reason: 'carrier_refused',
    });
    expect(subject.calls).toEqual([
      'stored',
      'tracking',
      'cancel',
      'tracking',
      'mark',
      'critical',
    ]);
    expect(subject.marks).toEqual([
      ['shipment-a', claimToken, 'carrier_refused'],
    ]);
    expect(subject.outcomes).toEqual([]);
  });

  test('an ambiguous answer marks carrier_ambiguous with no second tracking read', async () => {
    const subject = harness({
      tracking: [unscanned],
      cancel: { outcome: 'ambiguous' },
    });
    expect(await subject.run()).toEqual({
      proceed: false,
      reason: 'carrier_ambiguous',
    });
    expect(subject.calls).toEqual([
      'stored',
      'tracking',
      'cancel',
      'mark',
      'critical',
    ]);
    expect(subject.marks).toEqual([
      ['shipment-a', claimToken, 'carrier_ambiguous'],
    ]);
  });

  test('an unavailable carrier stops without recording or marking anything', async () => {
    const subject = harness({
      tracking: [unscanned],
      cancel: { outcome: 'unavailable' },
    });
    expect(await subject.run()).toEqual({
      proceed: false,
      reason: 'carrier_unavailable',
    });
    expect(subject.calls).toEqual(['stored', 'tracking', 'cancel']);
    expect(subject.criticals).toEqual([]);
  });

  test.each([
    ['a missing tracking number', { trackingNumber: null }],
    ['a blank tracking number', { trackingNumber: '  ' }],
    ['a missing carrier', { carrier: null }],
    ['a blank carrier', { carrier: '' }],
  ])('%s marks tracking_unknown without any Envia call', async (_label, override) => {
    const subject = harness();
    expect(await subject.run(override)).toEqual({
      proceed: false,
      reason: 'tracking_unknown',
    });
    expect(subject.calls).toEqual(['stored', 'mark', 'critical']);
    expect(subject.marks).toEqual([
      ['shipment-a', claimToken, 'tracking_unknown'],
    ]);
  });

  test('missing Envia configuration stops without Envia calls or marks, but still honours a stored acceptance', async () => {
    const stopped = harness({ available: false });
    expect(await stopped.run()).toEqual({
      proceed: false,
      reason: 'carrier_unavailable',
    });
    expect(stopped.calls).toEqual(['stored']);

    const approved = harness({
      available: false,
      stored: { ...noReview, carrier_cancellation_outcome: 'accepted' },
    });
    expect(await approved.run()).toEqual({ proceed: true });
    expect(approved.calls).toEqual(['stored']);
  });
});
