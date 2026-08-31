import type { ShipmentTrackingEvent } from '../index';

// This compile-time contract must remain aligned with the generated
// `shipment_tracking_events` row after `bun db:types` completes.
const trackingEvent = {
  carrier_name: 'Envia',
  dispute_id: null,
  event_at: '2026-08-28T00:00:00.000Z',
  event_type: 'in_transit',
  id: 'event-1',
  location: 'Ciudad de México',
  polling_run_id: null,
  raw_status: 'In Transit',
  received_at: '2026-08-28T00:01:00.000Z',
  shipment_id: 'shipment-1',
  status_description: 'Package is moving',
  webhook_delivery_id: null,
} satisfies ShipmentTrackingEvent;

void trackingEvent;
