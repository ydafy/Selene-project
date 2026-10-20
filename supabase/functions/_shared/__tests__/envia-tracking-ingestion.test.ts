import { describe, expect, it } from 'bun:test';

import {
  buildPollingTrackingEvents,
  buildWebhookTrackingEvent,
  extractEnviaPollingObservations,
  successfulPollingTargetIds,
  webhookReceipt,
} from '../envia-tracking-ingestion.ts';

describe('webhook tracking ingestion', () => {
  it('acknowledges a claimed delivery and produces a carrier-timed tracking event', () => {
    expect(webhookReceipt(false)).toEqual({
      received: true,
      deduplicated: false,
    });
    expect(
      buildWebhookTrackingEvent({
        type: 'tracking.simple',
        created_at: '2026-08-28T12:30:00.000Z',
        data: {
          tracking_number: 'TRACK-1',
          status: 'Picked Up',
          status_description: 'Accepted by carrier',
          location: 'Mexico City, MX',
          carrier_name: 'Estafeta',
        },
      }),
    ).toEqual({
      trackingNumber: 'TRACK-1',
      rawStatus: 'Picked Up',
      eventType: 'in_transit',
      transition: 'shipped',
      eventAt: '2026-08-28T12:30:00.000Z',
      statusDescription: 'Accepted by carrier',
      location: 'Mexico City, MX',
      carrierName: 'Estafeta',
    });
  });

  it('returns the exact duplicate acknowledgement and rejects unrelated or malformed events', () => {
    expect(webhookReceipt(true)).toEqual({
      received: true,
      deduplicated: true,
    });
    expect(
      buildWebhookTrackingEvent({
        type: 'surcharge',
        created_at: '2026-08-28T12:30:00.000Z',
        data: { tracking_number: 'TRACK-1', status: 'Delivered' },
      }),
    ).toBeNull();
    expect(
      buildWebhookTrackingEvent({
        type: 'tracking.simple',
        created_at: 'not-a-date',
        data: { tracking_number: '', status: 'Delivered' },
      }),
    ).toBeNull();
  });
});

describe('polling tracking reconciliation', () => {
  it('normalizes carrier observations for every matching shipment and retains Envia event time', () => {
    expect(
      buildPollingTrackingEvents(
        [
          { id: 'shipment-1', trackingNumber: 'TRACK-1' },
          { id: 'shipment-2', trackingNumber: 'TRACK-1' },
        ],
        [
          {
            trackingNumber: 'TRACK-1',
            status: 'Delivered',
            statusDescription: 'Delivered to recipient',
            location: 'Guadalajara, MX',
            carrierName: 'DHL',
            eventAt: '2026-08-28T13:00:00.000Z',
          },
        ],
        '2026-08-28T14:00:00.000Z',
      ),
    ).toEqual([
      {
        targetId: 'shipment-1',
        trackingNumber: 'TRACK-1',
        rawStatus: 'Delivered',
        eventType: 'delivered',
        transition: 'delivered',
        eventAt: '2026-08-28T13:00:00.000Z',
        statusDescription: 'Delivered to recipient',
        location: 'Guadalajara, MX',
        carrierName: 'DHL',
      },
      {
        targetId: 'shipment-2',
        trackingNumber: 'TRACK-1',
        rawStatus: 'Delivered',
        eventType: 'delivered',
        transition: 'delivered',
        eventAt: '2026-08-28T13:00:00.000Z',
        statusDescription: 'Delivered to recipient',
        location: 'Guadalajara, MX',
        carrierName: 'DHL',
      },
    ]);
  });

  it('uses the reconciliation time only when Envia omits carrier time and ignores unknown tracking numbers', () => {
    expect(
      buildPollingTrackingEvents(
        [{ id: 'dispute-1', trackingNumber: 'RETURN-1' }],
        [
          { trackingNumber: 'RETURN-1', status: 'Returned' },
          { trackingNumber: 'OTHER', status: 'Delivered' },
        ],
        '2026-08-28T14:00:00.000Z',
      ),
    ).toEqual([
      {
        targetId: 'dispute-1',
        trackingNumber: 'RETURN-1',
        rawStatus: 'Returned',
        eventType: 'returned',
        transition: null,
        eventAt: '2026-08-28T14:00:00.000Z',
        statusDescription: null,
        location: null,
        carrierName: null,
      },
    ]);
  });

  it('backfills Envia history and advances only targets with a valid observation and fully persisted events', () => {
    expect(
      extractEnviaPollingObservations({
        trackingNumber: 'TRACK-1',
        status: 'Delivered',
        history: [
          {
            status: 'Picked Up',
            date: '2026-08-28T12:00:00.000Z',
            location: 'Monterrey, MX',
          },
          {
            status: 'Delivered',
            date: '2026-08-28T13:00:00.000Z',
            location: 'Guadalajara, MX',
          },
        ],
      }),
    ).toEqual([
      {
        trackingNumber: 'TRACK-1',
        status: 'Picked Up',
        eventAt: '2026-08-28T12:00:00.000Z',
        statusDescription: null,
        location: 'Monterrey, MX',
        carrierName: null,
      },
      {
        trackingNumber: 'TRACK-1',
        status: 'Delivered',
        eventAt: '2026-08-28T13:00:00.000Z',
        statusDescription: null,
        location: 'Guadalajara, MX',
        carrierName: null,
      },
    ]);
    expect(
      successfulPollingTargetIds(
        [
          { id: 'shipment-1', trackingNumber: 'TRACK-1' },
          { id: 'shipment-2', trackingNumber: 'TRACK-2' },
        ],
        [{ targetId: 'shipment-1', trackingNumber: 'TRACK-1' }],
        new Set(['shipment-1']),
      ),
    ).toEqual(['shipment-1']);
  });
});
